// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Strategy adapter plugged into MidenDeltaVault.
///         Milestone 1: SimulatedStrategy. Milestone 2: CoreWriterStrategy (HyperCore spot + perp).
interface IStrategy {
    /// @notice Mark-to-market value of everything the strategy holds, in USDC (6 decimals).
    function totalValue() external view returns (uint256);

    /// @notice Vault has transferred `amount` USDC to the strategy; deploy it (createOrder / executeOrder).
    function allocate(uint256 amount) external;

    /// @notice Unwind and send up to `amount` USDC back to the vault. Returns the amount actually sent
    ///         (an async strategy may return less and settle later).
    function deallocate(uint256 amount) external returns (uint256 sent);
}
