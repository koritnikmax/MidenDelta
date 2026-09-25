// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IdentityRegistry} from "./IdentityRegistry.sol";
import {ICompliance} from "./interfaces/ICompliance.sol";
import {Roles} from "./Roles.sol";

/**
 * @title  MidenShareToken — fund unit of the MidenDelta AIF (ERC-3643-style, ERC-20 compatible)
 * @notice The legal unit register lives here, separate from the vault so strategy contracts can be replaced
 *         without touching it.
 *           - Only the vault mints and burns, and only to verified identities.
 *           - Phase 1: peer-to-peer transfers are OFF. Transfers between investors go through the administrator's
 *             transfer-request workflow and are executed with forcedTransfer.
 *           - When peer transfers are switched on, both sides must be verified and the compliance contract must
 *             approve (identity-level minimums at administrator NAV, see EligibilityCompliance).
 *           - Agent tools: freeze wallets, forced transfer, wallet recovery, pause.
 */
contract MidenShareToken is ERC20, AccessControl, Pausable {
    IdentityRegistry public immutable identityRegistry;
    ICompliance public compliance;
    bool public peerTransfersEnabled;
    mapping(address => bool) public isFrozen;

    bool private _agentOp;

    event ComplianceSet(address compliance);
    event PeerTransfersEnabled(bool enabled);
    event AddressFrozen(address indexed wallet, bool frozen, address indexed agent);
    event RecoverySuccess(address indexed lostWallet, address indexed newWallet, address indexed identity);
    event ForcedTransfer(address indexed from, address indexed to, uint256 units);

    error NotVerified(address wallet);
    error TransfersDisabled();
    error WalletFrozen(address wallet);
    error ComplianceRejected();
    error RecoveryIdentityMismatch();

    constructor(string memory name_, string memory symbol_, IdentityRegistry registry, address admin) ERC20(name_, symbol_) {
        identityRegistry = registry;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ------------------------------------------------------------------ vault
    function mint(address to, uint256 units) external onlyRole(Roles.VAULT) {
        if (!hasRole(Roles.VAULT, to) && !identityRegistry.isVerified(to)) revert NotVerified(to);
        _agentOp = true;
        _mint(to, units);
        _agentOp = false;
    }

    function burn(address from, uint256 units) external onlyRole(Roles.VAULT) {
        _agentOp = true;
        _burn(from, units);
        _agentOp = false;
    }

    /// @notice Vault escrows an investor's units for a redemption request, or releases claimed units to them.
    function vaultTransfer(address from, address to, uint256 units) external onlyRole(Roles.VAULT) whenNotPaused {
        address investor = hasRole(Roles.VAULT, from) ? to : from;
        if (!identityRegistry.isVerified(investor)) revert NotVerified(investor);
        if (isFrozen[investor]) revert WalletFrozen(investor);
        _agentOp = true;
        _transfer(from, to, units);
        _agentOp = false;
    }

    // ------------------------------------------------------------------ agent (administrator / AIFM)
    function forcedTransfer(address from, address to, uint256 units) external onlyRole(Roles.AGENT) {
        if (!identityRegistry.isVerified(to)) revert NotVerified(to);
        _agentOp = true;
        _transfer(from, to, units);
        _agentOp = false;
        emit ForcedTransfer(from, to, units);
    }

    /// @notice Move all units from a lost wallet to a replacement wallet already linked to the same identity.
    function recoveryAddress(address lostWallet, address newWallet, address identity) external onlyRole(Roles.AGENT) {
        if (identityRegistry.identityOf(newWallet) != identity || identityRegistry.identityOf(lostWallet) != identity) {
            revert RecoveryIdentityMismatch();
        }
        uint256 bal = balanceOf(lostWallet);
        _agentOp = true;
        _transfer(lostWallet, newWallet, bal);
        _agentOp = false;
        if (isFrozen[lostWallet]) isFrozen[newWallet] = true;
        emit RecoverySuccess(lostWallet, newWallet, identity);
    }

    function setAddressFrozen(address wallet, bool frozen) external onlyRole(Roles.AGENT) {
        isFrozen[wallet] = frozen;
        emit AddressFrozen(wallet, frozen, msg.sender);
    }

    function pause() external {
        if (!hasRole(Roles.AGENT, msg.sender) && !hasRole(Roles.GUARDIAN, msg.sender)) revert AccessControlUnauthorizedAccount(msg.sender, Roles.GUARDIAN);
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ------------------------------------------------------------------ fund manager (timelocked admin)
    function setCompliance(ICompliance compliance_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        compliance = compliance_;
        emit ComplianceSet(address(compliance_));
    }

    function setPeerTransfersEnabled(bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        peerTransfersEnabled = enabled;
        emit PeerTransfersEnabled(enabled);
    }

    // ------------------------------------------------------------------ transfer rules
    function _update(address from, address to, uint256 value) internal override {
        if (!_agentOp) {
            // a plain transfer() / transferFrom() between investors
            _requireNotPaused();
            if (!peerTransfersEnabled) revert TransfersDisabled();
            if (isFrozen[from]) revert WalletFrozen(from);
            if (isFrozen[to]) revert WalletFrozen(to);
            if (!identityRegistry.isVerified(from)) revert NotVerified(from);
            if (!identityRegistry.isVerified(to)) revert NotVerified(to);
            if (address(compliance) != address(0) && !compliance.canTransfer(from, to, value)) revert ComplianceRejected();
        }
        super._update(from, to, value);
    }
}
