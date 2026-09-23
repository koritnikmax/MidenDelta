// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IStrategy} from "./interfaces/IStrategy.sol";

/**
 * @title  MidenDeltaVault — Cash & Carry (Delta-0) vault token
 * @notice ERC-20 + ERC-4626-style USDC vault with ERC-8113 "Series Accounting for Incentivized Vaults".
 *
 *  Series model (ERC-8113)
 *  -----------------------
 *  - Series 0 is the LEAD series. Its shares ARE the transferable ERC-20 token (MDELTA).
 *  - If a deposit arrives while lead price-per-share (PPS) is below its high-water mark (HWM), the
 *    deposit is settled in an OUTSTANDING series (id >= 1) that starts at the current lead PPS. Those
 *    shares are non-transferable and tracked inside the vault.
 *  - Every series has its own HWM; the 19.5% performance fee is charged only on gains above it.
 *    New depositors therefore never free-ride on the lead series' loss recovery, and existing holders
 *    are never charged for recovering their own losses.
 *  - When the lead series reaches a new high, every outstanding series is at its own HWM too
 *    (same gross return, fees paid) and is CONSOLIDATED into lead shares at the prevailing rates.
 *    Consolidation is O(#series); per-user conversion happens lazily on the user's next interaction
 *    (balanceOf already reflects it).
 *  - Redemptions are asset-denominated (ERC-8113) and consume slices FIFO: lead first, then the
 *    outstanding series with the lowest id.
 *
 *  Liquidity (pitch deck "Security Measures")
 *  ------------------------------------------
 *  - Liquidity buffer: ~5% of NAV stays as idle USDC for same-block redemptions.
 *  - Dynamic exit fee: only net outflow (redemptions not offset by inflows in the same epoch) pays,
 *    at a rate rising convexly with queue depth. The fee stays in the vault (accrues to NAV).
 *  - Pro-rata partial fills: redemptions beyond available liquidity go to a queue; each processing
 *    round fills every open request by the same percentage (O(1) via a cumulative index).
 */
contract MidenDeltaVault is ERC20, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;

    // ---------------------------------------------------------------- roles & constants
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant KYC_ROLE = keccak256("KYC_ROLE");

    uint256 internal constant WAD = 1e18;
    /// @dev PPS is WAD-scaled "USDC per share": pps = assets(6dp) * 1e30 / shares(18dp). 1e18 == 1.00 USDC.
    uint256 internal constant PPS_SCALE = 1e30;
    uint256 internal constant BPS = 10_000;
    uint256 public constant LEAD = 0;
    uint256 public constant MAX_OUTSTANDING = 16;
    uint256 public constant EPOCH = 1 hours;

    IERC20 public immutable usdc;

    // ---------------------------------------------------------------- parameters
    IStrategy public strategy;
    address public treasury;
    uint256 public performanceFeeBps = 1950; // 19.5 %
    uint256 public bufferBps = 500; // 5 % liquidity buffer
    uint256 public maxExitFeeBps = 300; // 3 % max dynamic exit fee
    uint256 public exitFeeKneeWad = 0.2e18; // queue depth (as share of NAV) at which fee maxes out
    uint256 public minDeposit = 1_000e6; // $1,000 minimum investment
    uint256 public depositCap = 10_000_000e6; // guarded $10M vault
    bool public whitelistEnabled;
    mapping(address => bool) public isWhitelisted;

    // ---------------------------------------------------------------- series (ERC-8113)
    struct Series {
        uint256 assets; // USDC attributed to the series
        uint256 shares; // outstanding series only (lead uses totalSupply())
        uint256 hwm; // high-water mark PPS (WAD)
        uint256 mergeRate; // lead shares per series share (WAD), set on consolidation
        bool merged;
        uint64 createdAt;
    }

    mapping(uint256 => Series) internal _series;
    uint256 public nextSeriesId = 1;
    uint256[] internal _outstanding; // ascending ids => FIFO
    mapping(uint256 => mapping(address => uint256)) public seriesSharesOf;
    mapping(address => uint256[]) internal _userSeries;

    // ---------------------------------------------------------------- redemption queue
    struct Request {
        address owner;
        address receiver;
        uint256 amount; // USDC owed, net of exit fee
        uint256 era;
        uint256 pStart;
        uint256 claimed;
        uint64 createdAt;
    }

    Request[] internal _requests;
    mapping(address => uint256[]) internal _userRequests;
    uint256 public totalQueued; // unfilled USDC owed to the queue
    uint256 public reservedClaimable; // filled but not yet claimed USDC
    uint256 public queueIndex = WAD; // cumulative product of (1 - fillRatio) in the current era
    uint256 public queueEra;

    // epoch netting for "only net outflow pays"
    uint256 public currentEpoch;
    uint256 public epochInflow;

    // stats
    uint256 public lastAccrual;
    uint256 public totalFeesCollected; // performance fees (USDC)
    uint256 public totalExitFees; // exit fees retained in NAV (USDC)
    bool private _systemOp;

    // ---------------------------------------------------------------- events
    event SeriesCreated(uint256 indexed seriesId, uint256 pps);
    event SeriesDeposit(uint256 indexed seriesId, address indexed owner, uint256 assets, uint256 shares);
    event SeriesConsolidated(uint256 indexed seriesId, uint256 assets, uint256 leadSharesMinted, uint256 mergeRate);
    event RedeemSlice(uint256 indexed seriesId, address indexed owner, uint256 assets, uint256 shares);
    event PerformanceFee(uint256 indexed seriesId, uint256 feeAssets, uint256 feeShares, uint256 newHwm);
    event Accrued(int256 pnl, uint256 totalAssets, uint256 leadPps);
    event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);
    event ExitFee(address indexed owner, uint256 gross, uint256 fee, uint256 feeBps);
    event RedeemQueued(uint256 indexed requestId, address indexed owner, uint256 amount);
    event QueueProcessed(uint256 filled, uint256 fillRatioWad, uint256 remaining);
    event Claimed(uint256 indexed requestId, address indexed receiver, uint256 amount);
    event Rebalanced(uint256 allocated, uint256 deallocated, uint256 idle);
    event ParamsUpdated();

    error BelowMinimum();
    error CapExceeded();
    error NotWhitelisted(address account);
    error InsufficientBalance();
    error NonTransferableSeries();
    error TooManySeries();
    error ZeroAmount();

    constructor(IERC20 usdc_, address admin, address treasury_)
        ERC20("MidenDelta Cash & Carry", "MDELTA")
    {
        usdc = usdc_;
        treasury = treasury_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(KEEPER_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(KYC_ROLE, admin);
        _series[LEAD].hwm = WAD;
        _series[LEAD].createdAt = uint64(block.timestamp);
        lastAccrual = block.timestamp;
    }

    // ================================================================ ERC-4626-style views
    function asset() external view returns (address) {
        return address(usdc);
    }

    /// @notice Total USDC managed on behalf of all series (excludes queue liabilities).
    function totalAssets() public view returns (uint256 t) {
        t = _series[LEAD].assets;
        for (uint256 i; i < _outstanding.length; ++i) t += _series[_outstanding[i]].assets;
    }

    /// @notice ERC-8113: per-series total assets.
    function totalAssets(uint256 seriesId) external view returns (uint256) {
        return _series[seriesId].assets;
    }

    function totalShares(uint256 seriesId) public view returns (uint256) {
        return seriesId == LEAD ? totalSupply() : _series[seriesId].shares;
    }

    /// @notice ERC-8113: convertToShares(assets, seriesId).
    function convertToShares(uint256 assets, uint256 seriesId) public view returns (uint256) {
        return assets.mulDiv(PPS_SCALE, _pricePerShare(seriesId));
    }

    /// @notice ERC-8113: convertToAssets(shares, seriesId).
    function convertToAssets(uint256 shares, uint256 seriesId) public view returns (uint256) {
        uint256 sh = totalShares(seriesId);
        if (sh == 0) return shares.mulDiv(_series[seriesId].hwm, PPS_SCALE);
        return shares.mulDiv(_series[seriesId].assets, sh);
    }

    /// @notice Lead series price per share (WAD, 1e18 = 1 USDC). This is the MDELTA token NAV.
    function pricePerShare() external view returns (uint256) {
        return _pricePerShare(LEAD);
    }

    function pricePerShare(uint256 seriesId) external view returns (uint256) {
        return _pricePerShare(seriesId);
    }

    function seriesInfo(uint256 id)
        external
        view
        returns (uint256 assets, uint256 shares, uint256 pps, uint256 hwm, bool merged, uint64 createdAt)
    {
        Series storage s = _series[id];
        return (s.assets, totalShares(id), _pricePerShare(id), s.hwm, s.merged, s.createdAt);
    }

    function outstandingSeries() external view returns (uint256[] memory) {
        return _outstanding;
    }

    /// @notice Which series a new deposit would land in right now (0 = lead / tradable token).
    function depositSeries() public view returns (uint256) {
        if (_leadAtHwm()) return LEAD;
        uint256 n = _outstanding.length;
        if (n > 0) {
            uint256 last = _outstanding[n - 1];
            if (_pricePerShare(last) >= _series[last].hwm) return last;
        }
        return nextSeriesId; // would be created
    }

    function previewDeposit(uint256 assets) external view returns (uint256 seriesId, uint256 shares) {
        seriesId = depositSeries();
        uint256 pps = seriesId == nextSeriesId ? _pricePerShare(LEAD) : _pricePerShare(seriesId);
        shares = assets.mulDiv(PPS_SCALE, pps);
    }

    function maxDeposit(address) external view returns (uint256) {
        if (paused()) return 0;
        uint256 t = totalAssets();
        return t >= depositCap ? 0 : depositCap - t;
    }

    /// @notice Full position across all series. Merged series are shown converted into lead shares.
    function positionOf(address user)
        external
        view
        returns (
            uint256 leadShares,
            uint256 leadValue,
            uint256[] memory ids,
            uint256[] memory shares,
            uint256[] memory values,
            uint256 totalValue
        )
    {
        leadShares = balanceOf(user);
        leadValue = convertToAssets(leadShares, LEAD);
        totalValue = leadValue;
        uint256[] storage us = _userSeries[user];
        uint256 n;
        for (uint256 i; i < us.length; ++i) {
            if (!_series[us[i]].merged && seriesSharesOf[us[i]][user] > 0) ++n;
        }
        ids = new uint256[](n);
        shares = new uint256[](n);
        values = new uint256[](n);
        uint256 k;
        for (uint256 i; i < us.length; ++i) {
            uint256 id = us[i];
            uint256 sh = seriesSharesOf[id][user];
            if (_series[id].merged || sh == 0) continue;
            ids[k] = id;
            shares[k] = sh;
            values[k] = convertToAssets(sh, id);
            totalValue += values[k];
            ++k;
        }
    }

    /// @notice ERC-20 balance = settled lead shares + lead shares owed from consolidated series.
    function balanceOf(address account) public view override returns (uint256) {
        return super.balanceOf(account) + _pendingMerged(account);
    }

    /// @notice Current dynamic exit-fee rate (bps) for a redemption of `assets`.
    function previewExitFee(uint256 assets) external view returns (uint256 feeBps, uint256 fee) {
        uint256 covered = _currentEpochInflow().min(assets);
        uint256 feeable = assets - covered;
        uint256 rate = _exitFeeRate(feeable, totalAssets());
        feeBps = rate * BPS / WAD;
        fee = feeable.mulDiv(rate, WAD);
    }

    /// @notice USDC that can be paid out in the same block right now.
    function instantLiquidity() public view returns (uint256) {
        if (totalQueued > 0) return 0;
        return _freeIdle();
    }

    // ================================================================ deposit
    /// @notice Mint vault shares against USDC at the live NAV.
    /// @return shares shares minted in `seriesId` (0 = tradable MDELTA)
    function deposit(uint256 assets, address receiver)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 shares)
    {
        if (assets < minDeposit) revert BelowMinimum();
        _checkKyc(receiver);
        _accrue();
        if (totalAssets() + assets > depositCap) revert CapExceeded();

        usdc.safeTransferFrom(msg.sender, address(this), assets);
        _settle(receiver);

        uint256 sid = depositSeries();
        if (sid == LEAD) {
            shares = assets.mulDiv(PPS_SCALE, _pricePerShare(LEAD));
            _series[LEAD].assets += assets;
            _systemMint(receiver, shares);
        } else {
            if (sid == nextSeriesId) sid = _createSeries();
            Series storage s = _series[sid];
            shares = assets.mulDiv(PPS_SCALE, _pricePerShare(sid));
            s.assets += assets;
            s.shares += shares;
            if (seriesSharesOf[sid][receiver] == 0) _userSeries[receiver].push(sid);
            seriesSharesOf[sid][receiver] += shares;
        }

        _rollEpoch();
        epochInflow += assets;
        emit SeriesDeposit(sid, receiver, assets, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    // ================================================================ redeem (ERC-8113: by assets)
    /// @notice Burn shares worth `assets` USDC (FIFO over series) and pay out: instantly from the
    ///         buffer if possible, otherwise via the pro-rata queue.
    /// @return paidNow USDC transferred immediately
    /// @return requestId queue request id (type(uint256).max if nothing queued)
    function redeem(uint256 assets, address receiver)
        public
        nonReentrant
        whenNotPaused
        returns (uint256 paidNow, uint256 requestId)
    {
        if (assets == 0) revert ZeroAmount();
        _accrue();
        _settle(msg.sender);
        _burnSlices(msg.sender, assets);
        emit Withdraw(msg.sender, receiver, msg.sender, assets, 0);
        return _payout(msg.sender, receiver, assets);
    }

    /// @notice Redeem the caller's entire position across all series.
    function redeemAll(address receiver) external returns (uint256 paidNow, uint256 requestId) {
        _accrue();
        _settle(msg.sender);
        uint256 v = convertToAssets(super.balanceOf(msg.sender), LEAD);
        uint256[] storage us = _userSeries[msg.sender];
        for (uint256 i; i < us.length; ++i) v += convertToAssets(seriesSharesOf[us[i]][msg.sender], us[i]);
        return redeem(v, receiver);
    }

    /// @notice Claim the filled part of a queued redemption.
    function claim(uint256 requestId) public nonReentrant returns (uint256 amount) {
        Request storage r = _requests[requestId];
        amount = claimable(requestId);
        if (amount == 0) return 0;
        amount = amount.min(reservedClaimable);
        r.claimed += amount;
        reservedClaimable -= amount;
        usdc.safeTransfer(r.receiver, amount);
        emit Claimed(requestId, r.receiver, amount);
    }

    function claimable(uint256 requestId) public view returns (uint256) {
        Request storage r = _requests[requestId];
        uint256 filled = r.amount - _remaining(r);
        return filled > r.claimed ? filled - r.claimed : 0;
    }

    function requestInfo(uint256 requestId)
        external
        view
        returns (address owner, address receiver, uint256 amount, uint256 remaining, uint256 claimableNow, uint256 claimed, uint64 createdAt)
    {
        Request storage r = _requests[requestId];
        return (r.owner, r.receiver, r.amount, _remaining(r), claimable(requestId), r.claimed, r.createdAt);
    }

    function requestsOf(address user) external view returns (uint256[] memory) {
        return _userRequests[user];
    }

    function requestCount() external view returns (uint256) {
        return _requests.length;
    }

    // ================================================================ keeper
    /// @notice Mark to market, charge performance fees, consolidate series.
    function accrue() external {
        _accrue();
    }

    /// @notice Keep ~bufferBps of NAV idle (plus what the queue needs), deploy the rest, then fill the queue.
    function rebalance() external onlyRole(KEEPER_ROLE) nonReentrant {
        _accrue();
        uint256 target = totalAssets() * bufferBps / BPS + totalQueued;
        uint256 free = _freeIdle();
        uint256 allocated;
        uint256 deallocated;
        if (address(strategy) != address(0)) {
            if (free > target) {
                allocated = free - target;
                usdc.safeTransfer(address(strategy), allocated);
                strategy.allocate(allocated);
            } else if (free < target) {
                uint256 want = (target - free).min(strategy.totalValue());
                if (want > 0) deallocated = strategy.deallocate(want);
            }
        }
        _processQueue();
        emit Rebalanced(allocated, deallocated, usdc.balanceOf(address(this)));
    }

    /// @notice Fill queued redemptions pro-rata from free idle USDC. Permissionless.
    function processQueue() external nonReentrant {
        _processQueue();
    }

    // ================================================================ admin
    function setStrategy(IStrategy s) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _accrue();
        if (address(strategy) != address(0)) require(strategy.totalValue() == 0, "strategy not empty");
        strategy = s;
        emit ParamsUpdated();
    }

    function setParams(
        uint256 perfFeeBps_,
        uint256 bufferBps_,
        uint256 maxExitFeeBps_,
        uint256 kneeWad_,
        uint256 minDeposit_,
        uint256 cap_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(perfFeeBps_ <= 3000 && bufferBps_ <= BPS && maxExitFeeBps_ <= 1000 && kneeWad_ > 0, "bad params");
        _accrue();
        performanceFeeBps = perfFeeBps_;
        bufferBps = bufferBps_;
        maxExitFeeBps = maxExitFeeBps_;
        exitFeeKneeWad = kneeWad_;
        minDeposit = minDeposit_;
        depositCap = cap_;
        emit ParamsUpdated();
    }

    function setTreasury(address t) external onlyRole(DEFAULT_ADMIN_ROLE) {
        treasury = t;
    }

    function setWhitelistEnabled(bool on) external onlyRole(KYC_ROLE) {
        whitelistEnabled = on;
    }

    function setWhitelisted(address[] calldata accounts, bool ok) external onlyRole(KYC_ROLE) {
        for (uint256 i; i < accounts.length; ++i) isWhitelisted[accounts[i]] = ok;
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ================================================================ internal: accounting
    function _pricePerShare(uint256 id) internal view returns (uint256) {
        uint256 sh = totalShares(id);
        if (sh == 0) return id == LEAD ? _series[LEAD].hwm : _series[id].hwm;
        return _series[id].assets.mulDiv(PPS_SCALE, sh);
    }

    function _leadAtHwm() internal view returns (bool) {
        return totalSupply() == 0 || _pricePerShare(LEAD) >= _series[LEAD].hwm;
    }

    function _freeIdle() internal view returns (uint256) {
        uint256 bal = usdc.balanceOf(address(this));
        return bal > reservedClaimable ? bal - reservedClaimable : 0;
    }

    /// @dev Value of everything the vault controls minus queue liabilities.
    function _liveAssets() internal view returns (uint256) {
        uint256 gross = usdc.balanceOf(address(this));
        if (address(strategy) != address(0)) gross += strategy.totalValue();
        uint256 liab = reservedClaimable + totalQueued;
        return gross > liab ? gross - liab : 0;
    }

    function _accrue() internal {
        uint256 live = _liveAssets();
        uint256 acct = totalAssets();
        int256 pnl;
        if (acct > 0 && live != acct) {
            pnl = int256(live) - int256(acct);
            _distribute(live, acct, false);
        }
        _crystallizeFees();
        _consolidate();
        lastAccrual = block.timestamp;
        emit Accrued(pnl, totalAssets(), _pricePerShare(LEAD));
    }

    /// @dev Scale every series' assets from `oldTotal` to `newTotal` pro-rata.
    ///      If `bumpHwm`, HWMs scale too (exit-fee income is not a performance-fee event).
    function _distribute(uint256 newTotal, uint256 oldTotal, bool bumpHwm) internal {
        uint256 n = _outstanding.length;
        uint256 assigned;
        for (uint256 i; i < n; ++i) {
            Series storage s = _series[_outstanding[i]];
            uint256 na = s.assets.mulDiv(newTotal, oldTotal);
            if (bumpHwm && s.assets > 0) s.hwm = s.hwm.mulDiv(na, s.assets);
            s.assets = na;
            assigned += na;
        }
        Series storage l = _series[LEAD];
        uint256 la = newTotal - assigned; // lead absorbs rounding
        if (bumpHwm && l.assets > 0) l.hwm = l.hwm.mulDiv(la, l.assets);
        l.assets = la;
    }

    function _crystallizeFees() internal {
        uint256 feeBps = performanceFeeBps;
        Series storage l = _series[LEAD];
        // lead series: fee paid by minting lead shares to treasury (dilution)
        uint256 supply = totalSupply();
        if (supply > 0) {
            uint256 pps = _pricePerShare(LEAD);
            if (pps > l.hwm) {
                uint256 fee = (pps - l.hwm).mulDiv(supply, PPS_SCALE) * feeBps / BPS;
                uint256 feeShares;
                if (fee > 0 && fee < l.assets) {
                    feeShares = fee.mulDiv(supply, l.assets - fee);
                    _systemMint(treasury, feeShares);
                    totalFeesCollected += fee;
                }
                l.hwm = _pricePerShare(LEAD);
                emit PerformanceFee(LEAD, fee, feeShares, l.hwm);
            }
        }
        // outstanding series: fee assets move into the lead series as treasury shares
        for (uint256 i; i < _outstanding.length; ++i) {
            uint256 id = _outstanding[i];
            Series storage s = _series[id];
            if (s.shares == 0) continue;
            uint256 pps = _pricePerShare(id);
            if (pps <= s.hwm) continue;
            uint256 fee = (pps - s.hwm).mulDiv(s.shares, PPS_SCALE) * feeBps / BPS;
            uint256 feeShares;
            if (fee > 0) {
                uint256 leadPps = _pricePerShare(LEAD);
                feeShares = fee.mulDiv(PPS_SCALE, leadPps);
                s.assets -= fee;
                l.assets += fee;
                _systemMint(treasury, feeShares);
                totalFeesCollected += fee;
            }
            s.hwm = _pricePerShare(id);
            emit PerformanceFee(id, fee, feeShares, s.hwm);
        }
    }

    function _consolidate() internal {
        if (_outstanding.length == 0 || !_leadAtHwm()) return;
        uint256 i;
        while (i < _outstanding.length) {
            uint256 id = _outstanding[i];
            Series storage s = _series[id];
            if (s.shares > 0 && _pricePerShare(id) < s.hwm) {
                ++i;
                continue;
            }
            uint256 leadMint;
            if (s.shares > 0) {
                leadMint = s.assets.mulDiv(PPS_SCALE, _pricePerShare(LEAD));
                s.mergeRate = leadMint.mulDiv(WAD, s.shares);
                _series[LEAD].assets += s.assets;
                _systemMint(address(this), leadMint); // pool, claimed lazily by holders
            }
            emit SeriesConsolidated(id, s.assets, leadMint, s.mergeRate);
            s.assets = 0;
            s.merged = true;
            _removeOutstanding(i);
        }
    }

    function _createSeries() internal returns (uint256 id) {
        if (_outstanding.length >= MAX_OUTSTANDING) revert TooManySeries();
        id = nextSeriesId++;
        Series storage s = _series[id];
        s.hwm = _pricePerShare(LEAD); // starts at the lead's current price
        s.createdAt = uint64(block.timestamp);
        _outstanding.push(id);
        emit SeriesCreated(id, s.hwm);
    }

    function _removeOutstanding(uint256 idx) internal {
        // keep ascending order (FIFO)
        for (uint256 j = idx; j + 1 < _outstanding.length; ++j) _outstanding[j] = _outstanding[j + 1];
        _outstanding.pop();
    }

    // ---------------------------------------------------------------- lazy consolidation
    function _pendingMerged(address user) internal view returns (uint256 p) {
        uint256[] storage us = _userSeries[user];
        for (uint256 i; i < us.length; ++i) {
            Series storage s = _series[us[i]];
            if (s.merged) p += seriesSharesOf[us[i]][user].mulDiv(s.mergeRate, WAD);
        }
    }

    function _settle(address user) internal {
        uint256[] storage us = _userSeries[user];
        uint256 i;
        while (i < us.length) {
            uint256 id = us[i];
            uint256 sh = seriesSharesOf[id][user];
            Series storage s = _series[id];
            if (s.merged || sh == 0) {
                if (s.merged && sh > 0) {
                    seriesSharesOf[id][user] = 0;
                    s.shares -= sh;
                    uint256 lead = sh.mulDiv(s.mergeRate, WAD);
                    uint256 poolBal = super.balanceOf(address(this));
                    if (lead > poolBal) lead = poolBal;
                    if (lead > 0) {
                        _systemOp = true;
                        _transfer(address(this), user, lead);
                        _systemOp = false;
                    }
                }
                us[i] = us[us.length - 1];
                us.pop();
            } else {
                ++i;
            }
        }
    }

    // ---------------------------------------------------------------- redemption internals
    function _burnSlices(address owner, uint256 assets) internal {
        uint256 rem = assets;
        // 1) lead series
        uint256 bal = super.balanceOf(owner);
        if (bal > 0) {
            Series storage l = _series[LEAD];
            uint256 supply = totalSupply();
            uint256 value = bal.mulDiv(l.assets, supply);
            uint256 take = rem.min(value);
            if (take > 0) {
                uint256 sh = take == value ? bal : take.mulDiv(supply, l.assets, Math.Rounding.Ceil).min(bal);
                _systemBurn(owner, sh);
                l.assets -= take;
                rem -= take;
                emit RedeemSlice(LEAD, owner, take, sh);
            }
        }
        // 2) outstanding series, lowest id first
        for (uint256 i; i < _outstanding.length && rem > 0; ++i) {
            uint256 id = _outstanding[i];
            uint256 us = seriesSharesOf[id][owner];
            if (us == 0) continue;
            Series storage s = _series[id];
            uint256 value = us.mulDiv(s.assets, s.shares);
            uint256 take = rem.min(value);
            if (take == 0) continue;
            uint256 sh = take == value ? us : take.mulDiv(s.shares, s.assets, Math.Rounding.Ceil).min(us);
            seriesSharesOf[id][owner] = us - sh;
            s.shares -= sh;
            s.assets -= take;
            rem -= take;
            emit RedeemSlice(id, owner, take, sh);
        }
        if (rem > 0) revert InsufficientBalance();
        _cleanupEmptySeries();
    }

    function _cleanupEmptySeries() internal {
        uint256 i;
        while (i < _outstanding.length) {
            Series storage s = _series[_outstanding[i]];
            if (s.shares == 0) {
                // leftover rounding dust returns to lead
                _series[LEAD].assets += s.assets;
                s.assets = 0;
                s.merged = true; // closed
                _removeOutstanding(i);
            } else {
                ++i;
            }
        }
    }

    function _payout(address owner, address receiver, uint256 gross)
        internal
        returns (uint256 paidNow, uint256 requestId)
    {
        requestId = type(uint256).max;
        uint256 navAfter = totalAssets();

        // only net outflow pays the exit fee
        _rollEpoch();
        uint256 covered = gross.min(epochInflow);
        epochInflow -= covered;
        uint256 feeable = gross - covered;
        uint256 rate = navAfter == 0 ? 0 : _exitFeeRate(feeable, navAfter + gross);
        uint256 fee = feeable.mulDiv(rate, WAD);
        uint256 feeBps_ = rate * BPS / WAD;
        if (fee > 0) {
            _distribute(navAfter + fee, navAfter, true); // fee accrues to remaining holders
            totalExitFees += fee;
            emit ExitFee(owner, gross, fee, feeBps_);
        }
        uint256 net = gross - fee;

        uint256 instant = instantLiquidity().min(net);
        if (instant > 0) {
            usdc.safeTransfer(receiver, instant);
            paidNow = instant;
        }
        uint256 rest = net - instant;
        if (rest > 0) {
            requestId = _requests.length;
            _requests.push(Request(owner, receiver, rest, queueEra, queueIndex, 0, uint64(block.timestamp)));
            _userRequests[owner].push(requestId);
            totalQueued += rest;
            emit RedeemQueued(requestId, owner, rest);
        }
    }

    /// @dev fee = maxExitFee * min(1, (depth / knee)^2), depth = (queue + net outflow) / NAV
    /// @return rate exit-fee rate as WAD (1e18 = 100%)
    function _exitFeeRate(uint256 feeable, uint256 nav) internal view returns (uint256) {
        if (feeable == 0 || nav == 0) return 0;
        uint256 maxRate = maxExitFeeBps * WAD / BPS;
        uint256 depth = (totalQueued + feeable).mulDiv(WAD, nav);
        uint256 x = depth.mulDiv(WAD, exitFeeKneeWad);
        if (x >= WAD) return maxRate;
        return maxRate.mulDiv(x.mulDiv(x, WAD), WAD);
    }

    function _rollEpoch() internal {
        uint256 e = block.timestamp / EPOCH;
        if (e != currentEpoch) {
            currentEpoch = e;
            epochInflow = 0;
        }
    }

    function _currentEpochInflow() internal view returns (uint256) {
        return block.timestamp / EPOCH == currentEpoch ? epochInflow : 0;
    }

    function _remaining(Request storage r) internal view returns (uint256) {
        if (r.era < queueEra) return 0;
        return r.amount.mulDiv(queueIndex, r.pStart);
    }

    function _processQueue() internal {
        if (totalQueued == 0) return;
        uint256 avail = _freeIdle();
        if (avail == 0) return;
        uint256 filled;
        uint256 ratio;
        if (avail >= totalQueued) {
            filled = totalQueued;
            ratio = WAD;
            totalQueued = 0;
            queueEra++;
            queueIndex = WAD;
        } else {
            ratio = avail.mulDiv(WAD, totalQueued);
            uint256 keep = WAD - ratio;
            uint256 newQueued = totalQueued.mulDiv(keep, WAD, Math.Rounding.Ceil);
            filled = totalQueued - newQueued;
            totalQueued = newQueued;
            queueIndex = queueIndex.mulDiv(keep, WAD, Math.Rounding.Ceil);
        }
        reservedClaimable += filled;
        emit QueueProcessed(filled, ratio, totalQueued);
    }

    // ---------------------------------------------------------------- ERC-20 hooks / KYC
    function _checkKyc(address a) internal view {
        if (whitelistEnabled && !isWhitelisted[a] && a != treasury && a != address(this)) revert NotWhitelisted(a);
    }

    function _systemMint(address to, uint256 amt) internal {
        _systemOp = true;
        _mint(to, amt);
        _systemOp = false;
    }

    function _systemBurn(address from, uint256 amt) internal {
        _systemOp = true;
        _burn(from, amt);
        _systemOp = false;
    }

    /// @dev Lead shares (MDELTA) are freely transferable (ERC-3643-style whitelist hook when enabled).
    function _update(address from, address to, uint256 value) internal override {
        if (!_systemOp) {
            if (from != address(0)) _settle(from);
            _checkKyc(from);
            _checkKyc(to);
            _requireNotPaused();
        }
        super._update(from, to, value);
    }
}
