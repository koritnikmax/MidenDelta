// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IStrategy} from "./interfaces/IStrategy.sol";

interface IMintableUSDC {
    function mint(address to, uint256 amount) external;
    function burn(uint256 amount) external;
}

/**
 * @title  SimulatedStrategy — Milestone 1 cash & carry leg (TESTNET ONLY)
 * @notice Mirrors the MidenDelta position lifecycle without touching HyperCore:
 *           createOrder()     – split capital 90.91% spot ETH long / 9.09% USDC margin for a 10x perp short
 *           executeOrder()    – (simulated) fill; on mainnet this goes through CoreWriter
 *           reinvestFunding() – keeper posts the REAL hourly Hyperliquid ETH funding rate; the payment on the
 *                               short notional is credited in MockUSDC and compounded into the position
 *           adjustPosition()  – rebalance when hedge ratio / margin drifts past the threshold
 *         Because spot long == perp short (delta 0), mark-to-market value equals the USDC it holds.
 *         Milestone 2 replaces this with CoreWriterStrategy behind the same IStrategy interface.
 */
contract SimulatedStrategy is IStrategy, AccessControl {
    using SafeERC20 for IERC20;
    using Math for uint256;

    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");
    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS = 10_000;

    IERC20 public immutable usdc;
    address public immutable vault;

    uint256 public leverage = 10;
    uint256 public spotBps = 9091; // 10 / (10 + 1)
    uint256 public driftThresholdBps = 200; // rebalance if hedge ratio off by > 2%
    int256 public maxRatePerCall = 0.01e18; // guard against fat-finger funding posts (1%)

    // simulated position (ETH amounts in 1e18, price in USDC 6dp per ETH)
    uint256 public ethPrice = 2_500e6;
    uint256 public spotEth;
    uint256 public perpShortEth;
    uint256 public orderNonce;

    // stats
    int256 public cumulativeFunding; // USDC 6dp
    int256 public lastFundingRate; // hourly rate, 1e18 = 100%
    uint256 public lastFundingAt;
    uint256 public fundingEvents;

    event OrderCreated(uint256 indexed nonce, uint256 spotUsdc, uint256 marginUsdc, uint256 shortEth, uint256 price);
    event OrderExecuted(uint256 indexed nonce, uint256 spotEth, uint256 perpShortEth);
    event FundingReinvested(int256 rateWad, uint256 hours_, int256 payment, uint256 notional, uint256 price);
    event PositionAdjusted(uint256 spotEth, uint256 perpShortEth, uint256 hedgeRatioBps, uint256 marginBps);
    /// @notice Full position snapshot on every state change (for the internal ops dashboard).
    /// reason: 0 allocate · 1 deallocate · 2 funding · 3 rebalance · 4 mark-to-market
    event Snapshot(
        uint256 timestamp,
        uint8 indexed reason,
        uint256 ethPrice,
        uint256 spotEth,
        uint256 perpShortEth,
        uint256 totalValue,
        int256 cumulativeFunding,
        uint256 hedgeRatioBps,
        uint256 marginBps
    );

    function _snapshot(uint8 reason) internal {
        (uint256 r, uint256 m) = hedgeStats();
        emit Snapshot(block.timestamp, reason, ethPrice, spotEth, perpShortEth, totalValue(), cumulativeFunding, r, m);
    }

    modifier onlyVault() {
        require(msg.sender == vault, "only vault");
        _;
    }

    constructor(IERC20 usdc_, address vault_, address admin) {
        usdc = usdc_;
        vault = vault_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(KEEPER_ROLE, admin);
    }

    // ------------------------------------------------------------------ IStrategy
    function totalValue() public view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    function allocate(uint256 amount) external onlyVault {
        uint256 n = createOrder(amount);
        executeOrder(n);
        _snapshot(0);
    }

    function deallocate(uint256 amount) external onlyVault returns (uint256 sent) {
        uint256 tv = totalValue();
        sent = amount.min(tv);
        if (sent == 0) return 0;
        // unwind pro-rata
        spotEth -= spotEth.mulDiv(sent, tv);
        perpShortEth -= perpShortEth.mulDiv(sent, tv);
        usdc.safeTransfer(vault, sent);
        emit OrderExecuted(++orderNonce, spotEth, perpShortEth);
        _snapshot(1);
    }

    // ------------------------------------------------------------------ position lifecycle
    function createOrder(uint256 amountUsdc) internal returns (uint256 nonce) {
        uint256 spotUsdc = amountUsdc * spotBps / BPS;
        uint256 marginUsdc = amountUsdc - spotUsdc;
        uint256 ethBought = spotUsdc.mulDiv(WAD, ethPrice);
        uint256 shortEth = (marginUsdc * leverage).mulDiv(WAD, ethPrice);
        spotEth += ethBought;
        perpShortEth += shortEth;
        nonce = ++orderNonce;
        emit OrderCreated(nonce, spotUsdc, marginUsdc, shortEth, ethPrice);
    }

    function executeOrder(uint256 nonce) internal {
        emit OrderExecuted(nonce, spotEth, perpShortEth);
    }

    /// @notice Keeper posts the realised Hyperliquid ETH funding rate (per hour, WAD) for `hours_` hours.
    ///         Positive funding => shorts get paid => MockUSDC minted and compounded.
    function reinvestFunding(int256 hourlyRateWad, uint256 hours_, uint256 newEthPrice)
        external
        onlyRole(KEEPER_ROLE)
        returns (int256 payment)
    {
        require(hours_ > 0 && hours_ <= 24 * 30, "hours");
        int256 total = hourlyRateWad * int256(hours_);
        require(total <= maxRatePerCall && total >= -maxRatePerCall, "rate guard");
        if (newEthPrice > 0) ethPrice = newEthPrice;

        uint256 notional = perpShortEth.mulDiv(ethPrice, WAD);
        if (total >= 0) {
            uint256 pay = notional.mulDiv(uint256(total), WAD);
            if (pay > 0) {
                IMintableUSDC(address(usdc)).mint(address(this), pay);
                uint256 n = createOrder(pay); // compounding
                executeOrder(n);
            }
            payment = int256(pay);
        } else {
            uint256 cost = notional.mulDiv(uint256(-total), WAD).min(totalValue());
            if (cost > 0) {
                IMintableUSDC(address(usdc)).burn(cost);
                uint256 tvBefore = totalValue() + cost;
                spotEth -= spotEth.mulDiv(cost, tvBefore);
                perpShortEth -= perpShortEth.mulDiv(cost, tvBefore);
            }
            payment = -int256(cost);
        }
        cumulativeFunding += payment;
        lastFundingRate = hourlyRateWad;
        lastFundingAt = block.timestamp;
        fundingEvents += hours_;
        emit FundingReinvested(hourlyRateWad, hours_, payment, notional, ethPrice);
        _snapshot(2);
        _adjustIfDrifted();
    }

    /// @notice Keeper rebalance when the hedge ratio or margin share drifts past the threshold.
    function adjustPosition(uint256 newEthPrice) external onlyRole(KEEPER_ROLE) {
        if (newEthPrice > 0) ethPrice = newEthPrice;
        _snapshot(4);
        _adjustIfDrifted();
    }

    function _adjustIfDrifted() internal {
        (uint256 ratioBps, uint256 marginBps) = hedgeStats();
        uint256 targetMargin = BPS - spotBps;
        bool drift = ratioBps > BPS + driftThresholdBps || ratioBps + driftThresholdBps < BPS
            || marginBps > targetMargin * 3 / 2 || marginBps < targetMargin * 2 / 3;
        if (!drift || totalValue() == 0) return;
        uint256 tv = totalValue();
        spotEth = (tv * spotBps / BPS).mulDiv(WAD, ethPrice);
        perpShortEth = ((tv - tv * spotBps / BPS) * leverage).mulDiv(WAD, ethPrice);
        (ratioBps, marginBps) = hedgeStats();
        emit PositionAdjusted(spotEth, perpShortEth, ratioBps, marginBps);
        _snapshot(3);
    }

    /// @return hedgeRatioBps perp short / spot long (10000 = perfectly delta neutral)
    /// @return marginBps     USDC margin as share of strategy value
    function hedgeStats() public view returns (uint256 hedgeRatioBps, uint256 marginBps) {
        if (spotEth == 0) return (BPS, BPS - spotBps);
        hedgeRatioBps = perpShortEth.mulDiv(BPS, spotEth);
        uint256 tv = totalValue();
        uint256 spotVal = spotEth.mulDiv(ethPrice, WAD);
        marginBps = tv > spotVal ? (tv - spotVal).mulDiv(BPS, tv) : 0;
    }

    function setParams(uint256 lev, uint256 spot, uint256 drift) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(lev > 0 && lev <= 20 && spot < BPS && drift < BPS, "bad");
        leverage = lev;
        spotBps = spot;
        driftThresholdBps = drift;
    }
}
