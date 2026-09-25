// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/**
 * @title  FundTimelock — holds DEFAULT_ADMIN_ROLE on every fund contract
 * @notice Proposers and executors are the AIFM multisig in production (delay e.g. 48h [CONFIRM]); founders hold
 *         no admin keys. On testnet the deployer stands in for the multisig with a short delay.
 */
contract FundTimelock is TimelockController {
    constructor(uint256 minDelay, address[] memory proposers, address[] memory executors)
        TimelockController(minDelay, proposers, executors, address(0))
    {}
}
