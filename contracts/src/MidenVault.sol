// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {MidenShareToken} from "./MidenShareToken.sol";
import {IdentityRegistry} from "./IdentityRegistry.sol";
import {NavOracle} from "./NavOracle.sol";
import {LiquidityManager} from "./LiquidityManager.sol";
import {StrategyManager} from "./StrategyManager.sol";
import {Roles} from "./Roles.sol";

/**
 * @title  MidenVault — ERC-7540 asynchronous vault with epoch dealing
 * @notice Dealing works like a regulated fund, with the unit register on-chain:
 *           1. requestDeposit / requestRedeem during an open epoch (USDC or units are escrowed here)
 *           2. the keeper closes the epoch at the cutoff; new requests go to the next epoch
 *           3. the administrator publishes the official NAV for the closed epoch (NavOracle)
 *           4. settleEpoch mints units for subscriptions and fills redemptions at that NAV, applying the
 *              redemption gate and the anti-dilution levy (LiquidityManager)
 *           5. investors claim: deposit()/mint() for units, redeem()/withdraw() for USDC
 *         Synchronous ERC-4626 previews revert, as ERC-7540 requires. Units live in a separate MidenShareToken.
 *
 *         Redemptions filled pro-rata by the gate keep their remainder in the queue with no seniority: every
 *         open request is filled by the same percentage each epoch. This is tracked in O(1) with a cumulative
 *         index (poolP = remaining fraction, poolA = USDC paid per original unit), reset whenever the queue empties.
 */
contract MidenVault is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;

    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS = 10_000;

    IERC20 internal immutable _asset;
    MidenShareToken public immutable shareToken;
    NavOracle public immutable navOracle;
    IdentityRegistry public immutable registry;
    LiquidityManager public liquidity;
    StrategyManager public strategy;

    // ------------------------------------------------------------------ parameters (timelocked admin)
    uint256 public epochDuration; // [CONFIRM] daily dealing in production (1 days)
    uint256 public subscriptionCap = 10_000_000e6; // proof-of-concept hard cap (USDC)
    uint256 public minFirstSubscriptionSemiProEUR = 200_000e6; // statutory semi-professional minimum [CONFIRM]

    // ------------------------------------------------------------------ epochs
    struct EpochInfo {
        uint256 depositAssets;
        uint256 newRedeemShares;
        uint256 navUsd;
        uint256 fillWad;
        uint256 levyBps;
        uint256 pMerge;
        uint256 aMerge;
        uint256 genMerge;
        bool settled;
    }

    mapping(uint256 => EpochInfo) public epochs;
    uint256 public currentEpoch = 1;
    uint256 public epochOpenedAt;
    uint256 public lastSettledEpoch;

    // redemption queue (cumulative index, see contract notice)
    uint256 public queuedShares;
    uint256 public queueGen;
    uint256 public poolP = WAD;
    uint256 public poolA;
    mapping(uint256 => uint256) public genFinalA;

    // ------------------------------------------------------------------ requests & claims
    struct DepositRequest_ {
        uint256 epoch;
        uint256 assets;
    }

    struct RedeemRequest_ {
        uint256 shares;
        uint256 epoch;
        uint256 pBase;
        uint256 aBase;
        uint256 gen;
        bool merged;
    }

    mapping(address => DepositRequest_) internal _depositReq;
    mapping(address => RedeemRequest_) internal _redeemReq;
    mapping(address => uint256) internal _claimableDepositAssets;
    mapping(address => uint256) internal _claimableShares;
    mapping(address => uint256) internal _claimableRedeemShares;
    mapping(address => uint256) internal _claimableAssets;
    mapping(address => mapping(address => bool)) public isOperator;

    uint256 public pendingDepositAssets; // escrowed subscriptions not yet settled
    uint256 public reservedAssets; // USDC owed to redeemers, awaiting claim
    uint256 public totalLevies; // anti-dilution levies retained in the fund
    uint256 public totalEarlyRedemptionFeeShares;

    // ------------------------------------------------------------------ events (ERC-7540 / ERC-4626)
    event DepositRequest(address indexed controller, address indexed owner, uint256 indexed requestId, address sender, uint256 assets);
    event RedeemRequest(address indexed controller, address indexed owner, uint256 indexed requestId, address sender, uint256 shares);
    event OperatorSet(address indexed controller, address indexed operator, bool approved);
    event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);
    event EpochClosed(uint256 indexed epoch, uint256 depositAssets, uint256 redeemShares);
    event EpochSettled(
        uint256 indexed epoch, uint256 navUsd, uint256 depositAssets, uint256 sharesMinted, uint256 sharesRedeemed, uint256 assetsOut, uint256 fillWad, uint256 levyBps
    );
    event EarlyRedemptionFee(address indexed owner, uint256 shares, uint256 feeBps);
    event StrategyFlow(bool toStrategy, uint256 requested, uint256 moved);
    event ParamsSet(uint256 epochDuration, uint256 subscriptionCap, uint256 minFirstSubscriptionSemiProEUR);

    error Unauthorized();
    error NotVerified(address wallet);
    error IdentityMismatch();
    error ZeroAmount();
    error CapExceeded();
    error BelowSemiProMinimum();
    error RequestPending();
    error EpochNotOver();
    error PreviousEpochUnsettled();
    error NothingToSettle();
    error NavMissing();
    error InsufficientLiquidity();
    error ExceedsClaimable();
    error AsyncOnly();

    constructor(
        IERC20 asset_,
        MidenShareToken shareToken_,
        NavOracle navOracle_,
        IdentityRegistry registry_,
        LiquidityManager liquidity_,
        StrategyManager strategy_,
        uint256 epochDuration_,
        address admin
    ) {
        _asset = asset_;
        shareToken = shareToken_;
        navOracle = navOracle_;
        registry = registry_;
        liquidity = liquidity_;
        strategy = strategy_;
        epochDuration = epochDuration_;
        epochOpenedAt = block.timestamp;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ================================================================== ERC-7540 requests
    function requestDeposit(uint256 assets, address controller, address owner) external nonReentrant whenNotPaused returns (uint256 requestId) {
        _authorize(owner);
        if (assets == 0) revert ZeroAmount();
        _checkInvestor(owner, controller);
        if (totalAssets() + pendingDepositAssets + assets > subscriptionCap) revert CapExceeded();
        _syncDeposit(controller);

        DepositRequest_ storage r = _depositReq[controller];
        if (r.assets > 0 && r.epoch != currentEpoch) revert RequestPending();
        if (r.assets == 0 && _isFirstSemiProSubscription(controller)) {
            if (_toEUR(r.assets + assets) < minFirstSubscriptionSemiProEUR) revert BelowSemiProMinimum();
        }

        _asset.safeTransferFrom(owner, address(this), assets);
        r.epoch = currentEpoch;
        r.assets += assets;
        epochs[currentEpoch].depositAssets += assets;
        pendingDepositAssets += assets;
        requestId = currentEpoch;
        emit DepositRequest(controller, owner, requestId, msg.sender, assets);
    }

    function requestRedeem(uint256 shares, address controller, address owner) external nonReentrant whenNotPaused returns (uint256 requestId) {
        _authorize(owner);
        if (shares == 0) revert ZeroAmount();
        _checkInvestor(owner, controller);
        _syncRedeem(controller);

        RedeemRequest_ storage r = _redeemReq[controller];
        if (r.shares > 0 && (r.merged || r.epoch != currentEpoch)) revert RequestPending();

        uint256 feeBps = liquidity.earlyRedemptionFee(registry.getIdentity(registry.identityOf(owner)).subscriptionDate);
        uint256 feeShares = shares.mulDiv(feeBps, BPS);
        if (feeShares > 0) {
            shareToken.burn(owner, feeShares); // accrues to the remaining holders
            totalEarlyRedemptionFeeShares += feeShares;
            emit EarlyRedemptionFee(owner, feeShares, feeBps);
        }
        uint256 net = shares - feeShares;
        shareToken.vaultTransfer(owner, address(this), net);

        r.shares += net;
        r.epoch = currentEpoch;
        r.merged = false;
        epochs[currentEpoch].newRedeemShares += net;
        requestId = currentEpoch;
        emit RedeemRequest(controller, owner, requestId, msg.sender, shares);
    }

    function setOperator(address operator, bool approved) external returns (bool) {
        isOperator[msg.sender][operator] = approved;
        emit OperatorSet(msg.sender, operator, approved);
        return true;
    }

    // ================================================================== ERC-7540 claims
    /// @notice Claim units for settled subscriptions.
    function deposit(uint256 assets, address receiver, address controller) public nonReentrant returns (uint256 shares) {
        _authorize(controller);
        _syncDeposit(controller);
        uint256 ca = _claimableDepositAssets[controller];
        if (assets == 0 || assets > ca) revert ExceedsClaimable();
        shares = _claimableShares[controller].mulDiv(assets, ca);
        _releaseShares(controller, receiver, assets, shares);
    }

    function deposit(uint256 assets, address receiver) external returns (uint256) {
        return deposit(assets, receiver, msg.sender);
    }

    function mint(uint256 shares, address receiver, address controller) public nonReentrant returns (uint256 assets) {
        _authorize(controller);
        _syncDeposit(controller);
        uint256 cs = _claimableShares[controller];
        if (shares == 0 || shares > cs) revert ExceedsClaimable();
        assets = _claimableDepositAssets[controller].mulDiv(shares, cs);
        _releaseShares(controller, receiver, assets, shares);
    }

    function mint(uint256 shares, address receiver) external returns (uint256) {
        return mint(shares, receiver, msg.sender);
    }

    /// @notice Claim USDC for filled redemptions.
    function redeem(uint256 shares, address receiver, address controller) external nonReentrant returns (uint256 assets) {
        _authorize(controller);
        _syncRedeem(controller);
        uint256 cs = _claimableRedeemShares[controller];
        if (shares == 0 || shares > cs) revert ExceedsClaimable();
        assets = _claimableAssets[controller].mulDiv(shares, cs);
        _payAssets(controller, receiver, assets, shares);
    }

    function withdraw(uint256 assets, address receiver, address controller) external nonReentrant returns (uint256 shares) {
        _authorize(controller);
        _syncRedeem(controller);
        uint256 ca = _claimableAssets[controller];
        if (assets == 0 || assets > ca) revert ExceedsClaimable();
        shares = _claimableRedeemShares[controller].mulDiv(assets, ca, Math.Rounding.Ceil);
        _payAssets(controller, receiver, assets, shares);
    }

    // ================================================================== epoch lifecycle (keeper)
    function closeEpoch() external onlyRole(Roles.KEEPER) whenNotPaused {
        if (block.timestamp < epochOpenedAt + epochDuration) revert EpochNotOver();
        if (lastSettledEpoch != currentEpoch - 1) revert PreviousEpochUnsettled();
        EpochInfo storage ep = epochs[currentEpoch];
        emit EpochClosed(currentEpoch, ep.depositAssets, ep.newRedeemShares);
        currentEpoch++;
        epochOpenedAt = block.timestamp;
    }

    /// @notice Settle the closed epoch at the administrator's NAV. The keeper recalls enough liquidity first.
    function settleEpoch() external onlyRole(Roles.KEEPER) whenNotPaused nonReentrant {
        uint256 e = lastSettledEpoch + 1;
        if (e >= currentEpoch) revert NothingToSettle();
        uint256 nav = navOracle.navOf(e).usd;
        if (nav == 0) revert NavMissing();

        EpochInfo storage ep = epochs[e];
        ep.pMerge = poolP;
        ep.aMerge = poolA;
        ep.genMerge = queueGen;
        queuedShares += ep.newRedeemShares;

        uint256 fundNav = shareToken.totalSupply().mulDiv(nav, WAD);
        (uint256 fill, uint256 levy) = liquidity.quote(queuedShares.mulDiv(nav, WAD), ep.depositAssets, fundNav);
        uint256 filled = queuedShares.mulDiv(fill, WAD);
        uint256 payPerUnit = nav.mulDiv(BPS - levy, BPS);
        uint256 assetsOut = filled.mulDiv(payPerUnit, WAD);

        // subscriptions: settled units are held here until claimed
        uint256 minted = ep.depositAssets.mulDiv(WAD, nav);
        pendingDepositAssets -= ep.depositAssets;
        if (minted > 0) shareToken.mint(address(this), minted);

        // redemptions: the settling epoch's subscriptions are available as cash, the rest must be recalled first
        if (assetsOut > freeCash()) revert InsufficientLiquidity();
        reservedAssets += assetsOut;
        totalLevies += filled.mulDiv(nav, WAD) - assetsOut;
        if (filled > 0) shareToken.burn(address(this), filled);

        if (queuedShares > 0) {
            poolA += poolP.mulDiv(fill, WAD).mulDiv(payPerUnit, 1);
            poolP = poolP.mulDiv(WAD - fill, WAD);
            queuedShares -= filled;
            if (fill == WAD || queuedShares == 0) {
                genFinalA[queueGen] = poolA;
                queueGen++;
                poolP = WAD;
                poolA = 0;
                queuedShares = 0;
            }
        }

        ep.navUsd = nav;
        ep.fillWad = fill;
        ep.levyBps = levy;
        ep.settled = true;
        lastSettledEpoch = e;
        emit EpochSettled(e, nav, ep.depositAssets, minted, filled, assetsOut, fill, levy);
    }

    /// @notice Send free cash to the strategy (which hedges everything above its buffer).
    function deployToStrategy(uint256 amount) external onlyRole(Roles.KEEPER) whenNotPaused nonReentrant {
        uint256 moved = amount.min(freeCash());
        if (moved == 0) return;
        _asset.safeTransfer(address(strategy), moved);
        strategy.allocate(moved);
        emit StrategyFlow(true, amount, moved);
    }

    /// @notice Pull USDC back from the strategy, e.g. before settling redemptions.
    function recallFromStrategy(uint256 amount) external onlyRole(Roles.KEEPER) nonReentrant {
        uint256 moved = strategy.deallocate(amount);
        emit StrategyFlow(false, amount, moved);
    }

    // ================================================================== guardian / admin
    function pause() external {
        if (!hasRole(Roles.GUARDIAN, msg.sender) && !hasRole(Roles.KEEPER, msg.sender)) revert Unauthorized();
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function setParams(uint256 epochDuration_, uint256 subscriptionCap_, uint256 minSemiProEUR_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        epochDuration = epochDuration_;
        subscriptionCap = subscriptionCap_;
        minFirstSubscriptionSemiProEUR = minSemiProEUR_;
        emit ParamsSet(epochDuration_, subscriptionCap_, minSemiProEUR_);
    }

    function setLiquidityManager(LiquidityManager liquidity_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        liquidity = liquidity_;
    }

    // ================================================================== views
    function asset() external view returns (address) {
        return address(_asset);
    }

    /// @notice ERC-7575: the unit token is a separate contract.
    function share() external view returns (address) {
        return address(shareToken);
    }

    /// @notice USDC in the vault not owed to anyone and not escrowed for unsettled subscriptions.
    function freeCash() public view returns (uint256) {
        uint256 bal = _asset.balanceOf(address(this));
        uint256 owed = reservedAssets + pendingDepositAssets;
        return bal > owed ? bal - owed : 0;
    }

    /// @notice Gross fund assets (indicative). The official NAV is the administrator's, per epoch.
    function totalAssets() public view returns (uint256) {
        return freeCash() + strategy.totalValue();
    }

    function convertToShares(uint256 assets) external view returns (uint256) {
        uint256 nav = navOracle.navPerUnitUSD();
        return nav == 0 ? 0 : assets.mulDiv(WAD, nav);
    }

    function convertToAssets(uint256 shares) external view returns (uint256) {
        return shares.mulDiv(navOracle.navPerUnitUSD(), WAD);
    }

    function pendingDepositRequest(uint256, address controller) external view returns (uint256 assets) {
        DepositRequest_ memory r = _depositReq[controller];
        return r.epoch > lastSettledEpoch ? r.assets : 0;
    }

    function claimableDepositRequest(uint256, address controller) public view returns (uint256 assets) {
        (assets, ) = _previewDepositClaim(controller);
    }

    function pendingRedeemRequest(uint256, address controller) external view returns (uint256 shares) {
        (, , shares) = _previewRedeemClaim(controller);
    }

    function claimableRedeemRequest(uint256, address controller) public view returns (uint256 shares) {
        (shares, , ) = _previewRedeemClaim(controller);
    }

    function maxDeposit(address controller) external view returns (uint256 assets) {
        (assets, ) = _previewDepositClaim(controller);
    }

    function maxMint(address controller) external view returns (uint256 shares) {
        (, shares) = _previewDepositClaim(controller);
    }

    function maxRedeem(address controller) external view returns (uint256 shares) {
        (shares, , ) = _previewRedeemClaim(controller);
    }

    function maxWithdraw(address controller) external view returns (uint256 assets) {
        (, assets, ) = _previewRedeemClaim(controller);
    }

    /// @notice One call for the investor portal.
    function positionOf(address controller)
        external
        view
        returns (uint256 pendingDepositAssets_, uint256 claimableShares_, uint256 pendingRedeemShares_, uint256 claimableAssets_, uint256 units)
    {
        DepositRequest_ memory d = _depositReq[controller];
        pendingDepositAssets_ = d.epoch > lastSettledEpoch ? d.assets : 0;
        (, claimableShares_) = _previewDepositClaim(controller);
        (, claimableAssets_, pendingRedeemShares_) = _previewRedeemClaim(controller);
        units = shareToken.balanceOf(controller);
    }

    function previewDeposit(uint256) external pure returns (uint256) {
        revert AsyncOnly();
    }

    function previewMint(uint256) external pure returns (uint256) {
        revert AsyncOnly();
    }

    function previewRedeem(uint256) external pure returns (uint256) {
        revert AsyncOnly();
    }

    function previewWithdraw(uint256) external pure returns (uint256) {
        revert AsyncOnly();
    }

    function supportsInterface(bytes4 id) public view override returns (bool) {
        return id == 0xe3bc4e65 // ERC-7540 operator
            || id == 0xce3bbe50 // ERC-7540 async deposit
            || id == 0x620ee8e4 // ERC-7540 async redeem
            || id == 0x2f0a18c5 // ERC-7575
            || super.supportsInterface(id);
    }

    // ================================================================== internal
    function _authorize(address owner) internal view {
        if (msg.sender != owner && !isOperator[owner][msg.sender]) revert Unauthorized();
    }

    /// @dev Payer and beneficiary must be verified wallets of the same identity (no third-party subscriptions).
    function _checkInvestor(address owner, address controller) internal view {
        if (!registry.isVerified(owner)) revert NotVerified(owner);
        if (!registry.isVerified(controller)) revert NotVerified(controller);
        if (registry.identityOf(owner) != registry.identityOf(controller)) revert IdentityMismatch();
    }

    function _isFirstSemiProSubscription(address controller) internal view returns (bool) {
        if (registry.categoryOf(controller) != IdentityRegistry.Category.SEMI_PRO) return false;
        return registry.getIdentity(registry.identityOf(controller)).subscriptionDate == 0 && _claimableShares[controller] == 0;
    }

    /// @dev USDC -> EUR at the administrator's rate implied by the latest NAV (usd / eur per unit).
    function _toEUR(uint256 usdc) internal view returns (uint256) {
        uint256 usd = navOracle.navPerUnitUSD();
        uint256 eur = navOracle.navPerUnitEUR();
        return usd == 0 ? usdc : usdc.mulDiv(eur, usd);
    }

    function _releaseShares(address controller, address receiver, uint256 assets, uint256 shares) internal {
        if (registry.identityOf(receiver) != registry.identityOf(controller)) revert IdentityMismatch();
        _claimableDepositAssets[controller] -= assets;
        _claimableShares[controller] -= shares;
        shareToken.vaultTransfer(address(this), receiver, shares);
        registry.setSubscriptionDate(registry.identityOf(receiver), uint64(block.timestamp));
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function _payAssets(address controller, address receiver, uint256 assets, uint256 shares) internal {
        if (registry.identityOf(receiver) != registry.identityOf(controller)) revert IdentityMismatch();
        _claimableAssets[controller] -= assets;
        _claimableRedeemShares[controller] -= shares.min(_claimableRedeemShares[controller]);
        reservedAssets -= assets.min(reservedAssets); // per-investor rounding can differ from the epoch total by dust
        _asset.safeTransfer(receiver, assets);
        emit Withdraw(msg.sender, receiver, controller, assets, shares);
    }

    function _syncDeposit(address controller) internal {
        (uint256 a, uint256 s, bool settled) = _settledDeposit(controller);
        if (!settled) return;
        _claimableDepositAssets[controller] += a;
        _claimableShares[controller] += s;
        delete _depositReq[controller];
    }

    function _settledDeposit(address controller) internal view returns (uint256 assets, uint256 shares, bool settled) {
        DepositRequest_ memory r = _depositReq[controller];
        if (r.assets == 0 || r.epoch > lastSettledEpoch) return (0, 0, false);
        return (r.assets, r.assets.mulDiv(WAD, epochs[r.epoch].navUsd), true);
    }

    function _previewDepositClaim(address controller) internal view returns (uint256 assets, uint256 shares) {
        (uint256 a, uint256 s, ) = _settledDeposit(controller);
        return (_claimableDepositAssets[controller] + a, _claimableShares[controller] + s);
    }

    function _syncRedeem(address controller) internal {
        RedeemRequest_ storage r = _redeemReq[controller];
        if (r.shares == 0) return;
        if (!r.merged) {
            if (r.epoch > lastSettledEpoch) return;
            EpochInfo storage ep = epochs[r.epoch];
            r.pBase = ep.pMerge;
            r.aBase = ep.aMerge;
            r.gen = ep.genMerge;
            r.merged = true;
        }
        (uint256 remaining, uint256 assets) = _redeemProgress(r.shares, r.pBase, r.aBase, r.gen);
        _claimableRedeemShares[controller] += r.shares - remaining;
        _claimableAssets[controller] += assets;
        if (remaining == 0) {
            delete _redeemReq[controller];
        } else {
            r.shares = remaining;
            r.pBase = poolP;
            r.aBase = poolA;
        }
    }

    function _redeemProgress(uint256 shares, uint256 pBase, uint256 aBase, uint256 gen)
        internal
        view
        returns (uint256 remaining, uint256 assets)
    {
        if (gen < queueGen) return (0, shares.mulDiv(genFinalA[gen] - aBase, pBase) / WAD);
        remaining = shares.mulDiv(poolP, pBase);
        assets = shares.mulDiv(poolA - aBase, pBase) / WAD;
    }

    function _previewRedeemClaim(address controller) internal view returns (uint256 claimShares, uint256 claimAssets, uint256 pendingShares) {
        claimShares = _claimableRedeemShares[controller];
        claimAssets = _claimableAssets[controller];
        RedeemRequest_ memory r = _redeemReq[controller];
        if (r.shares == 0) return (claimShares, claimAssets, 0);
        if (!r.merged) {
            if (r.epoch > lastSettledEpoch) return (claimShares, claimAssets, r.shares);
            EpochInfo storage ep = epochs[r.epoch];
            (r.pBase, r.aBase, r.gen) = (ep.pMerge, ep.aMerge, ep.genMerge);
        }
        (uint256 remaining, uint256 assets) = _redeemProgress(r.shares, r.pBase, r.aBase, r.gen);
        return (claimShares + r.shares - remaining, claimAssets + assets, remaining);
    }
}
