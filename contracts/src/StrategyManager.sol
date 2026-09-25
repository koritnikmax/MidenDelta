// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IHedgeVenueAdapter} from "./interfaces/IHedgeVenueAdapter.sol";
import {Roles} from "./Roles.sol";

interface IBreakerTarget {
    function pause() external;
}

/**
 * @title  StrategyManager — holds the strategy parameters and is the only path to the hedge venue
 * @notice The keeper executes within bounds set here by the timelocked admin:
 *           - perp leverage: the keeper may run lower than maxPerpLeverageBps, never higher
 *           - liquidity buffer: liquidityBufferBps of strategy value stays as unhedged USDC (margin reserve)
 *           - hedge band, margin floor, per-venue exposure cap, maximum order size, allowed markets (ETH only)
 *         The keeper can deploy, rebalance, top up margin and trip the circuit breaker. It cannot withdraw,
 *         change parameters, add markets or unpause. Assets leave only to the vault or, by the timelocked admin,
 *         to depositary-controlled addresses on the allow-list.
 */
contract StrategyManager is AccessControl, Pausable {
    using SafeERC20 for IERC20;
    using Math for uint256;

    uint256 internal constant BPS = 10_000;
    bytes32 public constant ETH = "ETH";

    IERC20 public immutable usdc;
    address public vault;
    IHedgeVenueAdapter public adapter;

    uint256 public maxPerpLeverageBps = 30_000; // 3x cap
    uint256 public targetLeverageBps = 30_000; // keeper-set, <= cap
    uint256 public liquidityBufferBps = 500; // 5% of strategy value as unhedged USDC
    uint256 public hedgeBandBps = 200; // delta drift before rebalance
    uint256 public minMarginRatioBps = 2_000; // [CONFIRM] margin equity / short notional floor
    uint256 public venueExposureCapBps = 10_000; // [CONFIRM] share of strategy value at one venue (single venue today)
    uint256 public maxOrderSize = 1_000_000e6; // [CONFIRM] USDC per deployment call
    mapping(bytes32 => bool) public allowedMarkets;
    mapping(address => bool) public depositaryAllowlist;

    event VaultSet(address vault);
    event AdapterSet(address adapter);
    event Deployed(uint256 amount, uint256 leverageBps);
    event Released(uint256 requested, uint256 sent);
    event MarginToppedUp(uint256 amount, uint256 marginRatioBps);
    event Rebalanced(uint256 leverageBps, uint256 marginRatioBps);
    event TargetLeverageSet(uint256 bps);
    event ParamsSet(uint256 maxLev, uint256 buffer, uint256 band, uint256 minMargin, uint256 venueCap, uint256 maxOrder);
    event BreakerTripped(address indexed by, string reason);
    event DepositaryAllowlisted(address indexed to, bool allowed);
    event WithdrawnToDepositary(address indexed to, uint256 amount);

    error OnlyVault();
    error LeverageAboveCap();
    error NotAllowlisted();
    error MarketNotAllowed();
    error AdapterInUse();

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    constructor(IERC20 usdc_, address admin) {
        usdc = usdc_;
        allowedMarkets[ETH] = true;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ------------------------------------------------------------------ vault
    /// @notice The vault has sent `amount` USDC; hedge everything above the liquidity buffer.
    function allocate(uint256) external onlyVault whenNotPaused {
        _deployIdle();
    }

    /// @notice Return up to `amount` USDC to the vault: idle USDC first, then unwind the hedge pro-rata.
    function deallocate(uint256 amount) external onlyVault returns (uint256 sent) {
        uint256 idle = usdc.balanceOf(address(this));
        if (idle < amount && address(adapter) != address(0)) adapter.closeHedge(ETH, amount - idle);
        sent = amount.min(usdc.balanceOf(address(this)));
        if (sent > 0) usdc.safeTransfer(vault, sent);
        emit Released(amount, sent);
    }

    // ------------------------------------------------------------------ keeper
    function deployIdle() external onlyRole(Roles.KEEPER) whenNotPaused {
        _deployIdle();
    }

    function rebalanceHedge() external onlyRole(Roles.KEEPER) whenNotPaused returns (bool rebalanced) {
        rebalanced = adapter.adjustHedge(ETH, targetLeverageBps, hedgeBandBps);
        emit Rebalanced(adapter.getLeverage(ETH), adapter.getMarginRatio(ETH));
    }

    /// @notice Move buffer USDC to the venue as extra margin (reduces leverage, adds no exposure).
    function topUpMargin(uint256 amount) external onlyRole(Roles.KEEPER) whenNotPaused {
        amount = amount.min(usdc.balanceOf(address(this)));
        usdc.safeTransfer(address(adapter), amount);
        adapter.addMargin(ETH, amount);
        emit MarginToppedUp(amount, adapter.getMarginRatio(ETH));
    }

    /// @notice The keeper may lower leverage, or raise it back up to the cap, never above.
    function setTargetLeverage(uint256 bps) external onlyRole(Roles.KEEPER) {
        if (bps > maxPerpLeverageBps || bps < BPS) revert LeverageAboveCap();
        targetLeverageBps = bps;
        emit TargetLeverageSet(bps);
    }

    /// @notice Circuit breaker: pauses the strategy and the vault. Only the timelocked admin can resume.
    function tripBreaker(string calldata reason) external {
        if (!hasRole(Roles.KEEPER, msg.sender) && !hasRole(Roles.GUARDIAN, msg.sender)) {
            revert AccessControlUnauthorizedAccount(msg.sender, Roles.KEEPER);
        }
        if (!paused()) _pause();
        if (vault != address(0)) IBreakerTarget(vault).pause();
        emit BreakerTripped(msg.sender, reason);
    }

    // ------------------------------------------------------------------ timelocked admin
    function setVault(address vault_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        vault = vault_;
        emit VaultSet(vault_);
    }

    /// @notice Swap the venue adapter (e.g. to add a second venue later). Only while the old one holds nothing.
    function setAdapter(IHedgeVenueAdapter adapter_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (address(adapter) != address(0) && adapter.totalValue() > 0) revert AdapterInUse();
        adapter = adapter_;
        emit AdapterSet(address(adapter_));
    }

    function setParams(uint256 maxLev, uint256 buffer, uint256 band, uint256 minMargin, uint256 venueCap, uint256 maxOrder)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(maxLev >= BPS && maxLev <= 50_000 && buffer < BPS && band < BPS && venueCap <= BPS, "params");
        maxPerpLeverageBps = maxLev;
        if (targetLeverageBps > maxLev) targetLeverageBps = maxLev;
        liquidityBufferBps = buffer;
        hedgeBandBps = band;
        minMarginRatioBps = minMargin;
        venueExposureCapBps = venueCap;
        maxOrderSize = maxOrder;
        emit ParamsSet(maxLev, buffer, band, minMargin, venueCap, maxOrder);
    }

    function setAllowedMarket(bytes32 market, bool allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        allowedMarkets[market] = allowed;
    }

    function setDepositaryAllowlist(address to, bool allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        depositaryAllowlist[to] = allowed;
        emit DepositaryAllowlisted(to, allowed);
    }

    /// @notice Asset withdrawals leave only to depositary-controlled addresses on the allow-list.
    function withdrawToDepositary(address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!depositaryAllowlist[to]) revert NotAllowlisted();
        uint256 idle = usdc.balanceOf(address(this));
        if (idle < amount) adapter.closeHedge(ETH, amount - idle);
        usdc.safeTransfer(to, amount.min(usdc.balanceOf(address(this))));
        emit WithdrawnToDepositary(to, amount);
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ------------------------------------------------------------------ views
    function totalValue() public view returns (uint256) {
        return usdc.balanceOf(address(this)) + (address(adapter) == address(0) ? 0 : adapter.totalValue());
    }

    /// @notice True when the short's margin ratio is below the floor (the keeper should top up or trip the breaker).
    function marginBelowFloor() external view returns (bool) {
        return address(adapter) != address(0) && adapter.totalValue() > 0 && adapter.getMarginRatio(ETH) < minMarginRatioBps;
    }

    // ------------------------------------------------------------------ internal
    function _deployIdle() internal {
        if (!allowedMarkets[ETH]) revert MarketNotAllowed();
        if (targetLeverageBps > maxPerpLeverageBps) revert LeverageAboveCap();
        uint256 tv = totalValue();
        uint256 idle = usdc.balanceOf(address(this));
        uint256 buffer = tv.mulDiv(liquidityBufferBps, BPS);
        if (idle <= buffer) return;
        uint256 amount = (idle - buffer).min(maxOrderSize);
        uint256 venueRoom = tv.mulDiv(venueExposureCapBps, BPS);
        uint256 atVenue = adapter.totalValue();
        amount = venueRoom > atVenue ? amount.min(venueRoom - atVenue) : 0;
        if (amount == 0) return;
        usdc.safeTransfer(address(adapter), amount);
        adapter.openHedge(ETH, amount, targetLeverageBps);
        emit Deployed(amount, targetLeverageBps);
    }
}
