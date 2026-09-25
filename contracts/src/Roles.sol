// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Role identifiers shared by all fund contracts. DEFAULT_ADMIN_ROLE is held by the AIFM's timelock.
library Roles {
    /// @dev Fund administrator / AIFM: investor register, freeze, forced transfer, recovery.
    bytes32 internal constant AGENT = keccak256("AGENT_ROLE");
    /// @dev Fund administrator: publishes the official NAV per epoch.
    bytes32 internal constant NAV_SIGNER = keccak256("NAV_SIGNER_ROLE");
    /// @dev MidenDelta GmbH execution key: epoch flows, rebalancing, breakers. Cannot withdraw or change parameters.
    bytes32 internal constant KEEPER = keccak256("KEEPER_ROLE");
    /// @dev AIFM kill switch: pause instantly. Unpausing always needs the timelocked admin.
    bytes32 internal constant GUARDIAN = keccak256("GUARDIAN_ROLE");
    /// @dev The vault contract: mints / burns units and records subscription dates.
    bytes32 internal constant VAULT = keccak256("VAULT_ROLE");
}
