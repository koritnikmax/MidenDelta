// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IdentityRegistry} from "./IdentityRegistry.sol";
import {NavOracle} from "./NavOracle.sol";
import {ICompliance} from "./interfaces/ICompliance.sol";

/**
 * @title  EligibilityCompliance — transfer rules for peer-to-peer unit transfers
 * @notice Built and tested, but only consulted once the admin connects it to the token and switches peer
 *         transfers on (Phase 2). Balances are aggregated per identity and valued at the administrator's EUR
 *         NAV, never at a trade price.
 *           SameIdentity           transfers between wallets of one identity always pass
 *           MinAcquisitionSemiPro  a semi-professional without a qualifying position must receive at least
 *                                  minSemiProEUR in a single transfer (blocks splitting into small tickets)
 *           MinHoldingSender       the sender keeps either nothing or at least minHoldingEUR
 *         Country, category and KYC expiry are enforced by IdentityRegistry.isVerified on both sides.
 */
contract EligibilityCompliance is ICompliance, AccessControl {
    IdentityRegistry public immutable registry;
    IERC20 public immutable token;
    NavOracle public immutable navOracle;

    uint256 public minSemiProEUR = 200_000e6; // statutory semi-professional minimum, no buffer [CONFIRM]
    uint256 public minHoldingEUR = 200_000e6; // [CONFIRM]

    event MinimumsSet(uint256 minSemiProEUR, uint256 minHoldingEUR);

    constructor(IdentityRegistry registry_, IERC20 token_, NavOracle navOracle_, address admin) {
        registry = registry_;
        token = token_;
        navOracle = navOracle_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function canTransfer(address from, address to, uint256 units) external view returns (bool) {
        address idFrom = registry.identityOf(from);
        address idTo = registry.identityOf(to);
        if (idFrom != address(0) && idFrom == idTo) return true;

        uint256 nav = navOracle.navPerUnitEUR();
        if (nav == 0) return false;
        uint256 valueEUR = units * nav / 1e18;

        if (registry.categoryOf(to) == IdentityRegistry.Category.SEMI_PRO) {
            uint256 heldEUR = balanceOfIdentity(idTo) * nav / 1e18;
            if (heldEUR < minSemiProEUR && valueEUR < minSemiProEUR) return false;
        }

        uint256 fromBal = balanceOfIdentity(idFrom);
        if (units > fromBal) return false;
        uint256 remaining = fromBal - units;
        if (remaining > 0 && remaining * nav / 1e18 < minHoldingEUR) return false;
        return true;
    }

    function balanceOfIdentity(address identity) public view returns (uint256 total) {
        if (identity == address(0)) return 0;
        address[] memory ws = registry.walletsOf(identity);
        for (uint256 i; i < ws.length; i++) total += token.balanceOf(ws[i]);
    }

    function setMinimums(uint256 minSemiProEUR_, uint256 minHoldingEUR_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        minSemiProEUR = minSemiProEUR_;
        minHoldingEUR = minHoldingEUR_;
        emit MinimumsSet(minSemiProEUR_, minHoldingEUR_);
    }
}
