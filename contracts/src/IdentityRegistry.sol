// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Roles} from "./Roles.sol";

/**
 * @title  IdentityRegistry — ERC-3643-style investor register
 * @notice Maps wallets to identities (an ONCHAINID contract in production, any unique address on testnet) and
 *         stores the claims the fund administrator has verified for each identity:
 *           country           ISO 3166-1 numeric code (e.g. 276 Germany, 840 United States)
 *           category          PROFESSIONAL or SEMI_PRO (no retail category exists)
 *           kycExpiry         KYC is valid until this timestamp
 *           subscriptionDate  first subscription into the fund (set by the vault; drives the optional lock-up)
 *         A wallet is "verified" only if its identity has a category, unexpired KYC and a non-blocked country.
 *         Several wallets can belong to one identity; balances are aggregated per identity by the compliance rules.
 */
contract IdentityRegistry is AccessControl {
    enum Category {
        NONE,
        PROFESSIONAL,
        SEMI_PRO
    }

    struct Identity {
        bool exists;
        uint16 country;
        Category category;
        uint64 kycExpiry;
        uint64 subscriptionDate;
    }

    mapping(address wallet => address identity) public identityOf;
    mapping(address identity => Identity) internal _identities;
    mapping(address identity => address[]) internal _wallets;
    mapping(uint16 country => bool) public countryBlocked;

    event IdentityRegistered(address indexed identity, uint16 country, Category category, uint64 kycExpiry);
    event ClaimsUpdated(address indexed identity, uint16 country, Category category, uint64 kycExpiry);
    event SubscriptionDateSet(address indexed identity, uint64 date);
    event WalletLinked(address indexed wallet, address indexed identity);
    event WalletUnlinked(address indexed wallet, address indexed identity);
    event CountryBlocked(uint16 indexed country, bool blocked);

    error UnknownIdentity();
    error WalletAlreadyLinked();
    error InvalidCategory();

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ------------------------------------------------------------------ administrator (AGENT)
    function registerIdentity(address identity, uint16 country, Category category, uint64 kycExpiry) external onlyRole(Roles.AGENT) {
        if (category == Category.NONE) revert InvalidCategory();
        Identity storage id = _identities[identity];
        id.exists = true;
        id.country = country;
        id.category = category;
        id.kycExpiry = kycExpiry;
        emit IdentityRegistered(identity, country, category, kycExpiry);
    }

    function updateClaims(address identity, uint16 country, Category category, uint64 kycExpiry) external onlyRole(Roles.AGENT) {
        Identity storage id = _identities[identity];
        if (!id.exists) revert UnknownIdentity();
        id.country = country;
        id.category = category;
        id.kycExpiry = kycExpiry;
        emit ClaimsUpdated(identity, country, category, kycExpiry);
    }

    function linkWallet(address wallet, address identity) external onlyRole(Roles.AGENT) {
        if (!_identities[identity].exists) revert UnknownIdentity();
        if (identityOf[wallet] != address(0)) revert WalletAlreadyLinked();
        identityOf[wallet] = identity;
        _wallets[identity].push(wallet);
        emit WalletLinked(wallet, identity);
    }

    function unlinkWallet(address wallet) external onlyRole(Roles.AGENT) {
        address identity = identityOf[wallet];
        if (identity == address(0)) revert UnknownIdentity();
        delete identityOf[wallet];
        address[] storage ws = _wallets[identity];
        for (uint256 i; i < ws.length; i++) {
            if (ws[i] == wallet) {
                ws[i] = ws[ws.length - 1];
                ws.pop();
                break;
            }
        }
        emit WalletUnlinked(wallet, identity);
    }

    /// @notice Recorded by the vault on an identity's first subscription (drives the optional soft lock-up).
    function setSubscriptionDate(address identity, uint64 date) external onlyRole(Roles.VAULT) {
        Identity storage id = _identities[identity];
        if (!id.exists) revert UnknownIdentity();
        if (id.subscriptionDate == 0) {
            id.subscriptionDate = date;
            emit SubscriptionDateSet(identity, date);
        }
    }

    // ------------------------------------------------------------------ fund manager (timelocked admin)
    function setCountryBlocked(uint16 country, bool blocked) external onlyRole(DEFAULT_ADMIN_ROLE) {
        countryBlocked[country] = blocked;
        emit CountryBlocked(country, blocked);
    }

    // ------------------------------------------------------------------ views
    function isVerified(address wallet) public view returns (bool) {
        address identity = identityOf[wallet];
        if (identity == address(0)) return false;
        Identity storage id = _identities[identity];
        return id.exists && id.category != Category.NONE && id.kycExpiry >= block.timestamp && !countryBlocked[id.country];
    }

    function getIdentity(address identity_) external view returns (Identity memory) {
        return _identities[identity_];
    }

    function categoryOf(address wallet) external view returns (Category) {
        return _identities[identityOf[wallet]].category;
    }

    function walletsOf(address identity_) external view returns (address[] memory) {
        return _wallets[identity_];
    }
}
