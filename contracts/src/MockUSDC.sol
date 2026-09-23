// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title MockUSDC — TESTNET ONLY
/// @notice 6-decimals test dollar with a public faucet. The simulated strategy holds MINTER_ROLE
///         so it can credit / debit funding payments that mirror real Hyperliquid funding.
contract MockUSDC is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    uint256 public constant FAUCET_AMOUNT = 10_000e6;

    constructor(address admin) ERC20("Mock USD Coin (MidenDelta testnet)", "USDC") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Anyone can grab 10,000 test USDC.
    function faucet() external {
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    /// @notice Minter burns from its own balance (used for negative funding).
    function burn(uint256 amount) external onlyRole(MINTER_ROLE) {
        _burn(msg.sender, amount);
    }
}
