// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IHedgeVenueAdapter} from "./interfaces/IHedgeVenueAdapter.sol";
import {Roles} from "./Roles.sol";

interface IMintableUSDC {
    function mint(address to, uint256 amount) external;
    function burn(uint256 amount) external;
}

/**
 * @title  SimulatedHyperliquidAdapter — TESTNET ONLY
 * @notice Simulates the Hyperliquid spot leg and ETH perp short without touching HyperCore, so the full fund flow
 *         can be demonstrated on testnet. The keeper feeds it the real ETH mark price and the real hourly
 *         Hyperliquid funding rates; funding is credited in MockUSDC and compounded at the manager's leverage.
 *         The production adapter implements the same interface with CoreWriter actions and read precompiles, and
 *         verifies every action's resulting state before marking it done.
 *
 *         Capital split at leverage L: spot = C * L / (L + 1), short margin = C / (L + 1), short notional = spot.
 */
contract SimulatedHyperliquidAdapter is IHedgeVenueAdapter, AccessControl {
    using SafeERC20 for IERC20;
    using Math for uint256;

    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS = 10_000;
    bytes32 public constant ETH = "ETH";

    IERC20 public immutable usdc;
    address public immutable manager;

    uint256 public ethPrice = 2_500e6; // USDC (6dp) per ETH
    uint256 public spotEth; // 1e18
    uint256 public perpShortEth; // 1e18
    uint256 public leverageBps = 30_000; // last leverage set by the manager

    int256 public cumulativeFunding; // USDC 6dp
    int256 public lastFundingRate; // hourly, 1e18 = 100%
    uint256 public lastFundingAt;
    uint256 public fundingHours;
    int256 public maxRatePerCall = 0.01e18; // guard against a fat-fingered funding post (1%)

    /// reason: 0 open · 1 close · 2 funding · 3 rebalance · 4 mark · 5 margin top-up
    event Snapshot(
        uint256 timestamp,
        uint8 indexed reason,
        uint256 ethPrice,
        uint256 spotEth,
        uint256 perpShortEth,
        uint256 totalValue,
        int256 cumulativeFunding,
        uint256 hedgeRatioBps,
        uint256 marginRatioBps
    );
    event FundingAccrued(int256 hourlyRateWad, uint256 hours_, int256 payment, uint256 notional, uint256 price);

    error OnlyManager();
    error UnknownMarket();

    modifier onlyManager() {
        if (msg.sender != manager) revert OnlyManager();
        _;
    }

    modifier market(bytes32 m) {
        if (m != ETH) revert UnknownMarket();
        _;
    }

    constructor(IERC20 usdc_, address manager_, address admin) {
        usdc = usdc_;
        manager = manager_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ------------------------------------------------------------------ manager
    function openHedge(bytes32 m, uint256 usdcAmount, uint256 lev) external onlyManager market(m) {
        leverageBps = lev;
        uint256 spotUsdc = usdcAmount.mulDiv(lev, lev + BPS);
        uint256 bought = spotUsdc.mulDiv(WAD, ethPrice);
        spotEth += bought;
        perpShortEth += bought;
        _snapshot(0);
    }

    function adjustHedge(bytes32 m, uint256 lev, uint256 bandBps) external onlyManager market(m) returns (bool rebalanced) {
        (uint256 ratio, ) = hedgeStats();
        uint256 curLev = getLeverage(m);
        bool drift = ratio > BPS + bandBps || ratio + bandBps < BPS || curLev > lev.mulDiv(BPS + bandBps, BPS)
            || curLev + lev.mulDiv(bandBps, BPS) < lev;
        leverageBps = lev;
        if (drift && totalValue() > 0) {
            _reset(lev);
            _snapshot(3);
            return true;
        }
    }

    function addMargin(bytes32 m, uint256) external onlyManager market(m) {
        _snapshot(5); // extra USDC is now held as margin: leverage falls, exposure unchanged
    }

    function closeHedge(bytes32 m, uint256 usdcAmount) external onlyManager market(m) returns (uint256 released) {
        uint256 tv = totalValue();
        released = usdcAmount.min(tv);
        if (released == 0) return 0;
        spotEth -= spotEth.mulDiv(released, tv);
        perpShortEth -= perpShortEth.mulDiv(released, tv);
        usdc.safeTransfer(manager, released);
        _snapshot(1);
    }

    // ------------------------------------------------------------------ keeper feeds (simulation only)
    /// @notice Credit `hours_` hours of the real Hyperliquid hourly funding rate on the short notional.
    function accrueFunding(int256 hourlyRateWad, uint256 hours_, uint256 newEthPrice) external onlyRole(Roles.KEEPER) returns (int256 payment) {
        require(hours_ > 0 && hours_ <= 24 * 30, "hours");
        int256 total = hourlyRateWad * int256(hours_);
        require(total <= maxRatePerCall && total >= -maxRatePerCall, "rate guard");
        if (newEthPrice > 0) ethPrice = newEthPrice;
        uint256 notional = perpShortEth.mulDiv(ethPrice, WAD);
        if (total >= 0) {
            uint256 pay = notional.mulDiv(uint256(total), WAD);
            if (pay > 0) {
                IMintableUSDC(address(usdc)).mint(address(this), pay);
                _reset(leverageBps); // compound at the manager's leverage
            }
            payment = int256(pay);
        } else {
            uint256 cost = notional.mulDiv(uint256(-total), WAD).min(totalValue());
            if (cost > 0) {
                IMintableUSDC(address(usdc)).burn(cost);
                _reset(leverageBps);
            }
            payment = -int256(cost);
        }
        cumulativeFunding += payment;
        lastFundingRate = hourlyRateWad;
        lastFundingAt = block.timestamp;
        fundingHours += hours_;
        emit FundingAccrued(hourlyRateWad, hours_, payment, notional, ethPrice);
        _snapshot(2);
    }

    function markPrice(uint256 newEthPrice) external onlyRole(Roles.KEEPER) {
        require(newEthPrice > 0, "price");
        ethPrice = newEthPrice;
        _snapshot(4);
    }

    // ------------------------------------------------------------------ views
    function totalValue() public view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    function getPosition(bytes32 m) external view market(m) returns (uint256, uint256, uint256) {
        return (spotEth, perpShortEth, ethPrice);
    }

    function marginEquity() public view returns (uint256) {
        uint256 tv = totalValue();
        uint256 spotVal = spotEth.mulDiv(ethPrice, WAD);
        return tv > spotVal ? tv - spotVal : 0;
    }

    function getMarginRatio(bytes32 m) public view market(m) returns (uint256) {
        uint256 notional = perpShortEth.mulDiv(ethPrice, WAD);
        return notional == 0 ? BPS : marginEquity().mulDiv(BPS, notional);
    }

    function getLeverage(bytes32 m) public view market(m) returns (uint256) {
        uint256 eq = marginEquity();
        uint256 notional = perpShortEth.mulDiv(ethPrice, WAD);
        if (notional == 0) return 0;
        return eq == 0 ? type(uint256).max : notional.mulDiv(BPS, eq);
    }

    function getFundingAccrued(bytes32 m) external view market(m) returns (int256) {
        return cumulativeFunding;
    }

    function getAdlRisk(bytes32 m) external view market(m) returns (uint256) {
        return 0; // not modelled in the simulation
    }

    /// @return hedgeRatioBps short / spot (1e4 = delta neutral)
    /// @return marginRatioBps margin equity / short notional
    function hedgeStats() public view returns (uint256 hedgeRatioBps, uint256 marginRatioBps) {
        hedgeRatioBps = spotEth == 0 ? BPS : perpShortEth.mulDiv(BPS, spotEth);
        marginRatioBps = getMarginRatio(ETH);
    }

    // ------------------------------------------------------------------ internal
    function _reset(uint256 lev) internal {
        uint256 tv = totalValue();
        spotEth = tv.mulDiv(lev, lev + BPS).mulDiv(WAD, ethPrice);
        perpShortEth = spotEth;
    }

    function _snapshot(uint8 reason) internal {
        (uint256 r, uint256 mr) = hedgeStats();
        emit Snapshot(block.timestamp, reason, ethPrice, spotEth, perpShortEth, totalValue(), cumulativeFunding, r, mr);
    }
}
