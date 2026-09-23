// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MidenDeltaVault} from "../src/MidenDeltaVault.sol";
import {SimulatedStrategy} from "../src/SimulatedStrategy.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {IStrategy} from "../src/interfaces/IStrategy.sol";

contract MidenDeltaVaultTest is Test {
    MockUSDC usdc;
    MidenDeltaVault vault;
    SimulatedStrategy strat;

    address admin = address(0xA11CE);
    address treasury = address(0x7EA5);
    address alice = address(0xA1);
    address bob = address(0xB0B);
    address carol = address(0xCA201);

    function setUp() public {
        vm.startPrank(admin);
        usdc = new MockUSDC(admin);
        vault = new MidenDeltaVault(usdc, admin, treasury);
        strat = new SimulatedStrategy(usdc, address(vault), admin);
        usdc.grantRole(usdc.MINTER_ROLE(), address(strat));
        usdc.grantRole(usdc.MINTER_ROLE(), admin);
        vault.setStrategy(IStrategy(address(strat)));
        vm.stopPrank();
        for (uint256 i; i < 3; ++i) {
            address u = [alice, bob, carol][i];
            vm.prank(admin);
            usdc.mint(u, 1_000_000e6);
            vm.prank(u);
            usdc.approve(address(vault), type(uint256).max);
        }
    }

    // ---------------------------------------------------------------- helpers
    function _dep(address u, uint256 a) internal returns (uint256) {
        vm.prank(u);
        return vault.deposit(a, u);
    }

    /// simulate strategy PnL by minting / burning MockUSDC in the strategy
    function _pnl(int256 amt) internal {
        if (amt > 0) {
            vm.prank(admin);
            usdc.mint(address(vault), uint256(amt));
        } else {
            // move USDC out of the strategy (then vault) to simulate a loss
            uint256 loss = uint256(-amt);
            uint256 fromStrat = loss < strat.totalValue() ? loss : strat.totalValue();
            if (fromStrat > 0) {
                vm.prank(address(strat));
                usdc.transfer(address(0xdead), fromStrat);
            }
            if (loss > fromStrat) {
                vm.prank(address(vault));
                usdc.transfer(address(0xdead), loss - fromStrat);
            }
        }
        vault.accrue();
    }

    function _value(address u) internal view returns (uint256 v) {
        (,,,,, v) = vault.positionOf(u);
    }

    // ---------------------------------------------------------------- deposits
    function test_firstDepositMintsLeadAtOneDollar() public {
        uint256 sh = _dep(alice, 10_000e6);
        assertEq(sh, 10_000e18);
        assertEq(vault.balanceOf(alice), 10_000e18);
        assertEq(vault.pricePerShare(), 1e18);
        assertEq(vault.totalAssets(), 10_000e6);
    }

    function test_minimumDeposit() public {
        vm.prank(alice);
        vm.expectRevert(MidenDeltaVault.BelowMinimum.selector);
        vault.deposit(999e6, alice);
    }

    function test_depositCap() public {
        vm.prank(admin);
        vault.setParams(1950, 500, 300, 0.2e18, 1_000e6, 50_000e6);
        _dep(alice, 40_000e6);
        vm.prank(bob);
        vm.expectRevert(MidenDeltaVault.CapExceeded.selector);
        vault.deposit(20_000e6, bob);
    }

    // ---------------------------------------------------------------- performance fee
    function test_performanceFeeOnLeadGain() public {
        _dep(alice, 10_000e6);
        _pnl(1_000e6); // +10%
        // fee = 19.5% of 1000 = 195 USDC -> treasury shares
        uint256 tv = vault.convertToAssets(vault.balanceOf(treasury), 0);
        assertApproxEqAbs(tv, 195e6, 2);
        assertApproxEqAbs(_value(alice), 10_805e6, 2);
        (,, uint256 pps, uint256 hwm,,) = vault.seriesInfo(0);
        assertEq(pps, hwm);
    }

    function test_noFeeWhileRecoveringLosses() public {
        _dep(alice, 10_000e6);
        _pnl(-1_000e6);
        _pnl(1_000e6); // back to the high-water mark
        assertEq(vault.balanceOf(treasury), 0);
        assertApproxEqAbs(_value(alice), 10_000e6, 1);
    }

    // ---------------------------------------------------------------- ERC-8113 series
    function test_newSeriesWhenBelowHwm_noFreeRiding() public {
        _dep(alice, 10_000e6);
        _pnl(-1_000e6); // lead pps 0.90 < hwm 1.00
        assertEq(vault.depositSeries(), 1);
        _dep(bob, 9_000e6); // lands in series 1 at pps 0.90
        assertEq(vault.balanceOf(bob), 0, "not in lead yet");
        assertEq(vault.seriesSharesOf(1, bob), 10_000e18);
        uint256[] memory os = vault.outstandingSeries();
        assertEq(os.length, 1);

        // +11.11% gross for everyone: 18k -> 20k
        _pnl(2_000e6);
        // alice only recovered her loss => no fee. bob gained 1000 => pays 195.
        assertApproxEqAbs(_value(alice), 10_000e6, 2);
        assertApproxEqAbs(_value(bob), 9_805e6, 2);
        assertApproxEqAbs(vault.convertToAssets(vault.balanceOf(treasury), 0), 195e6, 2);

        // lead hit its HWM => series 1 consolidated into tradable lead shares
        assertEq(vault.outstandingSeries().length, 0);
        assertGt(vault.balanceOf(bob), 0);
        assertApproxEqAbs(vault.convertToAssets(vault.balanceOf(bob), 0), 9_805e6, 2);

        // bob can now trade his MDELTA
        uint256 b = vault.balanceOf(bob);
        vm.prank(bob);
        vault.transfer(carol, b);
        assertEq(vault.balanceOf(carol), b);
        assertEq(vault.balanceOf(bob), 0);
    }

    function test_depositsJoinLatestSeriesAtItsHwm() public {
        _dep(alice, 10_000e6);
        _pnl(-1_000e6);
        _dep(bob, 5_000e6);
        _dep(carol, 5_000e6);
        assertEq(vault.outstandingSeries().length, 1);
        assertEq(vault.seriesSharesOf(1, carol), vault.seriesSharesOf(1, bob));
    }

    function test_secondSeriesAfterSeriesLoss() public {
        _dep(alice, 10_000e6);
        _pnl(-1_000e6);
        _dep(bob, 9_000e6); // series 1
        _pnl(-1_800e6); // -10% again: series 1 below its hwm
        _dep(carol, 5_000e6); // new series 2
        uint256[] memory os = vault.outstandingSeries();
        assertEq(os.length, 2);
        assertEq(os[1], 2);
    }

    function test_fifoRedeemSlices() public {
        _dep(alice, 10_000e6); // lead
        _pnl(-1_000e6);
        _dep(alice, 9_000e6); // series 1
        // redeem 12k: 9k from lead first, 3k from series 1
        vm.prank(alice);
        vault.redeem(12_000e6, alice);
        assertEq(vault.balanceOf(alice), 0);
        assertApproxEqAbs(vault.convertToAssets(vault.seriesSharesOf(1, alice), 1), 6_000e6, 2);
    }

    // ---------------------------------------------------------------- liquidity / queue
    function test_instantRedeemFromBuffer() public {
        _dep(alice, 100_000e6);
        vm.prank(admin);
        vault.rebalance(); // 5% idle, 95% deployed
        assertApproxEqAbs(usdc.balanceOf(address(vault)), 5_000e6, 1);
        assertApproxEqAbs(strat.totalValue(), 95_000e6, 1);

        vm.warp(block.timestamp + 2 hours); // new epoch, no inflow netting
        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        (uint256 paid, uint256 rid) = vault.redeem(2_000e6, alice);
        assertEq(rid, type(uint256).max);
        assertEq(usdc.balanceOf(alice) - before, paid);
        assertGt(paid, 1_999e6); // tiny convex exit fee
    }

    function test_queueAndProRataFill() public {
        _dep(alice, 50_000e6);
        _dep(bob, 50_000e6);
        vm.prank(admin);
        vault.rebalance();
        vm.warp(block.timestamp + 2 hours);

        vm.prank(alice);
        (uint256 paidA, uint256 ridA) = vault.redeem(20_000e6, alice); // takes the 5k buffer, 15k queued
        vm.prank(bob);
        (uint256 paidB, uint256 ridB) = vault.redeem(20_000e6, bob); // fully queued
        assertGt(paidA, 0);
        assertEq(paidB, 0);
        assertTrue(ridA != type(uint256).max && ridB != type(uint256).max);

        // keeper frees liquidity: pulls buffer + queue from strategy
        vm.prank(admin);
        vault.rebalance();
        assertEq(vault.totalQueued(), 0);
        uint256 ca = vault.claimable(ridA);
        uint256 cb = vault.claimable(ridB);
        assertGt(ca, 0);
        assertGt(cb, 0);
        vm.prank(alice);
        vault.claim(ridA);
        vm.prank(bob);
        vault.claim(ridB);
        assertEq(vault.claimable(ridA), 0);
    }

    function test_partialFillSamePercentageForEveryone() public {
        _dep(alice, 50_000e6);
        _dep(bob, 50_000e6);
        vm.prank(admin);
        vault.rebalance();
        vm.warp(block.timestamp + 2 hours);
        // drain the buffer first so both requests queue fully
        vm.prank(alice);
        vault.redeem(5_000e6, alice);
        vm.prank(alice);
        (, uint256 ra) = vault.redeem(10_000e6, alice);
        vm.prank(bob);
        (, uint256 rb) = vault.redeem(30_000e6, bob);
        (,, uint256 amtA,,,,) = vault.requestInfo(ra);
        (,, uint256 amtB,,,,) = vault.requestInfo(rb);

        // only 10k of liquidity arrives (e.g. a deposit)
        vm.prank(admin);
        usdc.mint(address(vault), 0); // no-op
        _dep(carol, 10_000e6);
        vault.processQueue();
        uint256 fa = vault.claimable(ra);
        uint256 fb = vault.claimable(rb);
        // same fill percentage
        assertApproxEqRel(fa * 1e18 / amtA, fb * 1e18 / amtB, 1e12);
        assertGt(fa, 0);
    }

    function test_exitFeeConvexInQueueDepth() public {
        _dep(alice, 100_000e6);
        vm.prank(admin);
        vault.rebalance();
        vm.warp(block.timestamp + 2 hours);
        (, uint256 fee1) = vault.previewExitFee(1_000e6);
        (, uint256 fee10) = vault.previewExitFee(10_000e6);
        (uint256 bps20,) = vault.previewExitFee(20_000e6);
        assertGt(fee1, 0);
        assertEq(bps20, 300); // at the knee => max 3%
        // convex: 10x size => 100x fee rate => 1000x fee amount
        assertApproxEqRel(fee10, fee1 * 1000, 0.01e18);
    }

    function test_onlyNetOutflowPaysExitFee() public {
        _dep(alice, 100_000e6);
        _dep(bob, 20_000e6); // same epoch inflow = 20k
        (uint256 bps, uint256 fee) = vault.previewExitFee(20_000e6);
        assertEq(bps, 0);
        assertEq(fee, 0);
    }

    function test_exitFeeAccruesToRemainingHolders() public {
        _dep(alice, 50_000e6);
        _dep(bob, 50_000e6);
        vm.prank(admin);
        vault.rebalance();
        vm.warp(block.timestamp + 2 hours);
        uint256 bobBefore = _value(bob);
        vm.prank(alice);
        vault.redeem(15_000e6, alice);
        assertGt(_value(bob), bobBefore);
        assertEq(vault.balanceOf(treasury), 0, "exit fee is not a performance-fee event");
    }

    // ---------------------------------------------------------------- strategy
    function test_fundingCompoundsIntoNav() public {
        _dep(alice, 100_000e6);
        vm.prank(admin);
        vault.rebalance();
        // 14.16% APR / 8760h, applied for 24h
        int256 hourly = int256(uint256(0.1416e18) / 8760);
        vm.prank(admin);
        strat.reinvestFunding(hourly, 24, 2_600e6);
        vm.prank(admin);
        vault.rebalance();
        assertGt(vault.pricePerShare(), 1e18);
        (uint256 hr,) = strat.hedgeStats();
        assertApproxEqAbs(hr, 10_000, 20);
    }

    function test_negativeFundingLowersNavNoFee() public {
        _dep(alice, 100_000e6);
        vm.prank(admin);
        vault.rebalance();
        vm.prank(admin);
        strat.reinvestFunding(-int256(uint256(0.0001e18)), 10, 0);
        vault.accrue();
        assertLt(vault.pricePerShare(), 1e18);
        assertEq(vault.balanceOf(treasury), 0);
    }

    // ---------------------------------------------------------------- KYC
    function test_whitelistBlocksNonKyc() public {
        vm.startPrank(admin);
        vault.setWhitelistEnabled(true);
        address[] memory a = new address[](1);
        a[0] = alice;
        vault.setWhitelisted(a, true);
        vm.stopPrank();
        _dep(alice, 5_000e6);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(MidenDeltaVault.NotWhitelisted.selector, bob));
        vault.deposit(5_000e6, bob);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MidenDeltaVault.NotWhitelisted.selector, bob));
        vault.transfer(bob, 1e18);
    }

    // ---------------------------------------------------------------- fuzz: solvency
    function testFuzz_solvency(uint96 a, uint96 b, int64 pnl1, int64 pnl2, uint96 r) public {
        uint256 da = bound(uint256(a), 1_000e6, 400_000e6);
        uint256 db = bound(uint256(b), 1_000e6, 400_000e6);
        _dep(alice, da);
        vm.prank(admin);
        vault.rebalance();
        int256 p1 = int256(bound(int256(pnl1), -int256(da / 5), int256(da / 5)));
        _pnl(p1);
        _dep(bob, db);
        int256 p2 = int256(bound(int256(pnl2), -int256((da + db) / 10), int256((da + db) / 5)));
        _pnl(p2);
        vm.prank(admin);
        vault.rebalance();

        uint256 claims = _value(alice) + _value(bob) + vault.convertToAssets(vault.balanceOf(treasury), 0);
        uint256 backing = usdc.balanceOf(address(vault)) + strat.totalValue();
        assertLe(claims, backing + 10, "insolvent");

        uint256 rv = bound(uint256(r), 1, _value(alice));
        vm.warp(block.timestamp + 2 hours);
        vm.prank(alice);
        vault.redeem(rv, alice);
        vm.prank(admin);
        vault.rebalance();
        claims = _value(alice) + _value(bob) + vault.convertToAssets(vault.balanceOf(treasury), 0)
            + vault.totalQueued() + vault.reservedClaimable();
        backing = usdc.balanceOf(address(vault)) + strat.totalValue();
        assertLe(claims, backing + 10, "insolvent after redeem");
    }

    function test_redeemAllExitsEverything() public {
        _dep(alice, 10_000e6);
        _pnl(-1_000e6);
        _dep(alice, 9_000e6);
        vm.prank(alice);
        vault.redeemAll(alice);
        assertEq(_value(alice), 0);
        assertEq(vault.outstandingSeries().length, 0);
    }
}
