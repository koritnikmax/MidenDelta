// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Roles} from "./Roles.sol";

/**
 * @title  NavOracle — the fund administrator's official NAV per unit, one entry per dealing epoch
 * @notice Values are "per 1e18 units" in 6 decimals (1e6 = 1.00 USD / EUR). Only a NAV_SIGNER can publish,
 *         each epoch exactly once, and a move larger than maxChangeBps versus the previous NAV is rejected so a
 *         fat-fingered or compromised signer cannot strike an absurd price. A genuine large move needs the
 *         timelocked admin to widen the bound first.
 *         All EUR thresholds in compliance (e.g. the EUR 200k semi-professional minimum) use this NAV, never a
 *         trade price.
 */
contract NavOracle is AccessControl {
    struct Nav {
        uint256 usd;
        uint256 eur;
        uint64 timestamp;
    }

    uint256 internal constant BPS = 10_000;

    mapping(uint256 epoch => Nav) internal _navs;
    uint256 public latestEpoch;
    uint256 public maxChangeBps = 1_000; // [CONFIRM] 10% per epoch

    event NavPublished(uint256 indexed epoch, uint256 usd, uint256 eur, address indexed signer);
    event MaxChangeSet(uint256 bps);

    error AlreadyPublished();
    error ZeroNav();
    error ChangeTooLarge();

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function publish(uint256 epoch, uint256 usd, uint256 eur) external onlyRole(Roles.NAV_SIGNER) {
        if (_navs[epoch].timestamp != 0) revert AlreadyPublished();
        if (usd == 0 || eur == 0) revert ZeroNav();
        if (_navs[latestEpoch].timestamp != 0) {
            uint256 prev = _navs[latestEpoch].usd;
            uint256 diff = usd > prev ? usd - prev : prev - usd;
            if (diff * BPS > prev * maxChangeBps) revert ChangeTooLarge();
        }
        _navs[epoch] = Nav(usd, eur, uint64(block.timestamp));
        if (epoch > latestEpoch) latestEpoch = epoch;
        emit NavPublished(epoch, usd, eur, msg.sender);
    }

    function setMaxChangeBps(uint256 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        maxChangeBps = bps;
        emit MaxChangeSet(bps);
    }

    function navOf(uint256 epoch) external view returns (Nav memory) {
        return _navs[epoch];
    }

    function navPerUnitUSD() external view returns (uint256) {
        return _navs[latestEpoch].usd;
    }

    function navPerUnitEUR() external view returns (uint256) {
        return _navs[latestEpoch].eur;
    }
}
