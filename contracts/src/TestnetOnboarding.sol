// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IdentityRegistry} from "./IdentityRegistry.sol";

/**
 * @title  TestnetOnboarding — TESTNET ONLY
 * @notice Lets demo users register themselves as a professional investor so they can try the full dealing flow.
 *         In production the fund administrator registers identities after real KYC; this contract is never
 *         deployed there. Blocked countries (e.g. US = 840) still fail the eligibility check afterwards, which
 *         the demo shows.
 */
contract TestnetOnboarding {
    IdentityRegistry public immutable registry;
    uint64 public constant KYC_VALIDITY = 365 days;

    error AlreadyRegistered();

    event SelfRegistered(address indexed wallet, uint16 country);

    constructor(IdentityRegistry registry_) {
        registry = registry_;
    }

    function registerMe(uint16 country) external {
        if (registry.identityOf(msg.sender) != address(0)) revert AlreadyRegistered();
        registry.registerIdentity(msg.sender, country, IdentityRegistry.Category.PROFESSIONAL, uint64(block.timestamp) + KYC_VALIDITY);
        registry.linkWallet(msg.sender, msg.sender);
        emit SelfRegistered(msg.sender, country);
    }
}
