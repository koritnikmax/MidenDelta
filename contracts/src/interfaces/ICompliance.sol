// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice ERC-3643-style compliance hook, consulted on every peer-to-peer unit transfer.
interface ICompliance {
    function canTransfer(address from, address to, uint256 units) external view returns (bool);
}
