// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @notice Everything venue-specific sits behind this interface so the hedge venue can change without touching the
 *         vault or the unit register. Today: Hyperliquid (spot leg and perp short). Later: additional venues to
 *         spread idiosyncratic platform risk.
 *         Only the StrategyManager may call the state-changing functions. `leverageBps` is always supplied by the
 *         manager, which enforces the fund's leverage cap.
 */
interface IHedgeVenueAdapter {
    /// @notice USDC has been sent to the adapter: buy spot and open an equal short at `leverageBps` (1e4 = 1x).
    function openHedge(bytes32 market, uint256 usdcAmount, uint256 leverageBps) external;

    /// @notice Re-hedge to `leverageBps` if the spot/short ratio or leverage drifted more than `bandBps`.
    function adjustHedge(bytes32 market, uint256 leverageBps, uint256 bandBps) external returns (bool rebalanced);

    /// @notice USDC has been sent to the adapter to strengthen the short's margin (no new exposure).
    function addMargin(bytes32 market, uint256 usdcAmount) external;

    /// @notice Unwind pro-rata and return up to `usdcAmount` USDC to the manager.
    function closeHedge(bytes32 market, uint256 usdcAmount) external returns (uint256 released);

    function getPosition(bytes32 market) external view returns (uint256 spotSize, uint256 shortSize, uint256 markPrice);

    /// @notice Short-leg margin equity as a share of short notional (bps). 3x leverage ~ 3,333.
    function getMarginRatio(bytes32 market) external view returns (uint256);

    function getLeverage(bytes32 market) external view returns (uint256 leverageBps);

    function getFundingAccrued(bytes32 market) external view returns (int256);

    /// @notice Auto-deleveraging risk indicator (bps, 0 = none). Venue-specific.
    function getAdlRisk(bytes32 market) external view returns (uint256);

    /// @notice Mark-to-market value of everything held at the venue, in USDC (6 decimals).
    function totalValue() external view returns (uint256);
}
