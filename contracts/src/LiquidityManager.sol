// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title  LiquidityManager — the fund's liquidity management tools (AIFMD II asks for at least two)
 * @notice 1. Redemption gate: if net redemptions exceed gateThresholdBps of NAV in an epoch, every redemption
 *            request is filled by the same percentage and the rest rolls to the next epoch with no seniority.
 *         2. Anti-dilution levy: charged on net outflow only, rising convexly with its size, kept in the fund.
 *         3. Optional early-redemption fee inside a soft lock-up after the first subscription (off by default).
 *         All parameters are [CONFIRM] values and settable only by the timelocked admin.
 */
contract LiquidityManager is AccessControl {
    using Math for uint256;

    uint256 internal constant BPS = 10_000;
    uint256 internal constant WAD = 1e18;

    uint256 public gateThresholdBps = 1_500; // [CONFIRM] 10–20% of NAV per epoch
    uint256 public maxLevyBps = 200; // [CONFIRM] levy at or beyond levyKneeBps of net outflow
    uint256 public levyKneeBps = 2_000; // net outflow (share of NAV) at which the levy reaches its maximum
    uint256 public earlyRedemptionFeeBps; // [CONFIRM] e.g. 100–200; 0 = off
    uint256 public lockupPeriod = 180 days; // [CONFIRM]

    event GateSet(uint256 bps);
    event LevySet(uint256 maxBps, uint256 kneeBps);
    event EarlyRedemptionSet(uint256 feeBps, uint256 period);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /**
     * @param redeemAssets value of all queued redemptions at this epoch's NAV (USDC, 6dp)
     * @param depositAssets new subscriptions settling in the same epoch (USDC, 6dp)
     * @param nav fund NAV before flows (USDC, 6dp)
     * @return fillWad share of every redemption request filled this epoch (1e18 = 100%)
     * @return levyBps levy on each filled redemption, i.e. the net-outflow levy spread over all filled redemptions
     */
    function quote(uint256 redeemAssets, uint256 depositAssets, uint256 nav) external view returns (uint256 fillWad, uint256 levyBps) {
        if (redeemAssets == 0) return (WAD, 0);
        if (redeemAssets <= depositAssets || nav == 0) return (WAD, 0);
        uint256 net = redeemAssets - depositAssets;
        uint256 allowed = nav.mulDiv(gateThresholdBps, BPS);
        uint256 filledRedeem = redeemAssets;
        if (net > allowed) {
            filledRedeem = depositAssets + allowed;
            fillWad = filledRedeem.mulDiv(WAD, redeemAssets);
            net = allowed;
        } else {
            fillWad = WAD;
        }
        // convex levy on the net outflow that actually leaves: max * min(1, net / knee)^2
        uint256 depth = net.mulDiv(BPS, nav).min(levyKneeBps);
        uint256 netLevyBps = maxLevyBps.mulDiv(depth * depth, levyKneeBps * levyKneeBps);
        // spread over all filled redemptions so only the net outflow is charged
        levyBps = filledRedeem == 0 ? 0 : netLevyBps.mulDiv(net, filledRedeem);
    }

    /// @notice Early-redemption fee for an identity that first subscribed at `subscriptionDate`.
    function earlyRedemptionFee(uint64 subscriptionDate) external view returns (uint256) {
        if (earlyRedemptionFeeBps == 0 || subscriptionDate == 0) return 0;
        return block.timestamp < subscriptionDate + lockupPeriod ? earlyRedemptionFeeBps : 0;
    }

    // ------------------------------------------------------------------ timelocked admin
    function setGate(uint256 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(bps > 0 && bps <= BPS, "gate");
        gateThresholdBps = bps;
        emit GateSet(bps);
    }

    function setLevy(uint256 maxBps, uint256 kneeBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(maxBps <= 1_000 && kneeBps > 0 && kneeBps <= BPS, "levy");
        maxLevyBps = maxBps;
        levyKneeBps = kneeBps;
        emit LevySet(maxBps, kneeBps);
    }

    function setEarlyRedemption(uint256 feeBps, uint256 period) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(feeBps <= 500, "fee");
        earlyRedemptionFeeBps = feeBps;
        lockupPeriod = period;
        emit EarlyRedemptionSet(feeBps, period);
    }
}
