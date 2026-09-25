// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";
import {MidenShareToken} from "../src/MidenShareToken.sol";
import {NavOracle} from "../src/NavOracle.sol";
import {LiquidityManager} from "../src/LiquidityManager.sol";
import {StrategyManager} from "../src/StrategyManager.sol";
import {SimulatedHyperliquidAdapter} from "../src/SimulatedHyperliquidAdapter.sol";
import {MidenVault} from "../src/MidenVault.sol";
import {EligibilityCompliance} from "../src/EligibilityCompliance.sol";
import {TestnetOnboarding} from "../src/TestnetOnboarding.sol";
import {Roles} from "../src/Roles.sol";

contract FundTest is Test {
    uint16 constant DE = 276;
    uint16 constant US = 840;
    uint256 constant EPOCH = 1 days;

    MockUSDC usdc;
    IdentityRegistry reg;
    MidenShareToken token;
    NavOracle oracle;
    LiquidityManager liq;
    StrategyManager strat;
    SimulatedHyperliquidAdapter adapter;
    MidenVault vault;
    EligibilityCompliance comp;

    address aifm = address(this); // stands in for the timelocked AIFM multisig
    address agent = makeAddr("administrator");
    address keeper = makeAddr("keeper");
    address guardian = makeAddr("guardian");
    address alice = makeAddr("alice"); // professional, DE
    address bob = makeAddr("bob"); // professional, DE
    address semi = makeAddr("semi"); // semi-professional, DE
    address usPerson = makeAddr("us");

    function setUp() public {
        usdc = new MockUSDC(aifm);
        reg = new IdentityRegistry(aifm);
        token = new MidenShareToken("MidenDelta Fund Unit", "MDELTA", reg, aifm);
        oracle = new NavOracle(aifm);
        liq = new LiquidityManager(aifm);
        strat = new StrategyManager(usdc, aifm);
        adapter = new SimulatedHyperliquidAdapter(usdc, address(strat), aifm);
        vault = new MidenVault(usdc, token, oracle, reg, liq, strat, EPOCH, aifm);
        comp = new EligibilityCompliance(reg, token, oracle, aifm);

        strat.setVault(address(vault));
        strat.setAdapter(adapter);
        usdc.grantRole(usdc.MINTER_ROLE(), address(adapter));
        token.grantRole(Roles.VAULT, address(vault));
        reg.grantRole(Roles.VAULT, address(vault));
        reg.grantRole(Roles.AGENT, agent);
        token.grantRole(Roles.AGENT, agent);
        oracle.grantRole(Roles.NAV_SIGNER, agent);
        vault.grantRole(Roles.KEEPER, keeper);
        strat.grantRole(Roles.KEEPER, keeper);
        adapter.grantRole(Roles.KEEPER, keeper);
        vault.grantRole(Roles.GUARDIAN, guardian);
        vault.grantRole(Roles.GUARDIAN, address(strat)); // circuit breaker pauses the vault
        strat.grantRole(Roles.GUARDIAN, guardian);
        reg.setCountryBlocked(US, true);

        vm.startPrank(agent);
        _register(alice, DE, IdentityRegistry.Category.PROFESSIONAL);
        _register(bob, DE, IdentityRegistry.Category.PROFESSIONAL);
        _register(semi, DE, IdentityRegistry.Category.SEMI_PRO);
        _register(usPerson, US, IdentityRegistry.Category.PROFESSIONAL);
        oracle.publish(0, 1e6, 1e6); // launch NAV 1.00 USD / 1.00 EUR per unit
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ helpers
    function _register(address w, uint16 country, IdentityRegistry.Category c) internal {
        reg.registerIdentity(w, country, c, uint64(block.timestamp + 365 days));
        reg.linkWallet(w, w);
    }

    function _subscribe(address who, uint256 assets) internal {
        deal(address(usdc), who, usdc.balanceOf(who) + assets);
        vm.startPrank(who);
        usdc.approve(address(vault), assets);
        vault.requestDeposit(assets, who, who);
        vm.stopPrank();
    }

    function _cycle(uint256 navUsd) internal {
        vm.warp(block.timestamp + EPOCH);
        vm.prank(keeper);
        vault.closeEpoch();
        uint256 e = vault.currentEpoch() - 1;
        vm.prank(agent);
        oracle.publish(e, navUsd, navUsd);
        vm.prank(keeper);
        vault.settleEpoch();
    }

    function _claimUnits(address who) internal {
        uint256 a = vault.maxDeposit(who);
        vm.prank(who);
        vault.deposit(a, who, who);
    }

    function _fundTwoInvestors() internal {
        _subscribe(alice, 1_000_000e6);
        _subscribe(bob, 1_000_000e6);
        _cycle(1e6);
        _claimUnits(alice);
        _claimUnits(bob);
    }

    function _enablePeerTransfers() internal {
        token.setCompliance(comp);
        token.setPeerTransfersEnabled(true);
    }

    // ================================================================== dealing flow
    function test_fullDealingCycle() public {
        _subscribe(alice, 100_000e6);
        _subscribe(bob, 900_000e6);
        assertEq(vault.pendingDepositRequest(0, alice), 100_000e6);
        _cycle(1e6);
        assertEq(vault.claimableDepositRequest(0, alice), 100_000e6);
        _claimUnits(alice);
        _claimUnits(bob);
        assertEq(token.balanceOf(alice), 100_000e18);
        assertGt(reg.getIdentity(alice).subscriptionDate, 0);

        vm.prank(keeper);
        vault.deployToStrategy(1_000_000e6);
        assertEq(strat.totalValue(), 1_000_000e6);
        assertApproxEqAbs(adapter.getLeverage(strat.ETH()), 30_000, 1); // 3x

        // Alice redeems 10% of the fund: under the 15% gate, so filled in full
        vm.prank(alice);
        vault.requestRedeem(100_000e18, alice, alice);
        vm.warp(block.timestamp + EPOCH);
        vm.startPrank(keeper);
        vault.closeEpoch();
        vault.recallFromStrategy(100_000e6);
        vm.stopPrank();
        vm.prank(agent);
        oracle.publish(2, 1e6, 1e6);
        vm.prank(keeper);
        vault.settleEpoch();

        // levy on a 10% net outflow: 2% max * (10% / 20% knee)^2 = 0.5%
        assertEq(vault.maxWithdraw(alice), 99_500e6);
        vm.prank(alice);
        vault.withdraw(99_500e6, alice, alice);
        assertEq(token.balanceOf(alice), 0);
        assertEq(usdc.balanceOf(alice), 99_500e6);
    }

    function test_gateLimitsASingleLargeRedemption() public {
        _subscribe(alice, 100_000e6);
        _cycle(1e6);
        _claimUnits(alice);
        vm.prank(alice);
        vault.requestRedeem(100_000e18, alice, alice); // 100% of the fund
        _cycle(1e6);
        assertEq(vault.claimableRedeemRequest(0, alice), 15_000e18); // gate: 15% per epoch
        assertEq(vault.pendingRedeemRequest(0, alice), 85_000e18);
    }

    function test_synchronousPreviewsRevert() public {
        vm.expectRevert(MidenVault.AsyncOnly.selector);
        vault.previewDeposit(1);
        vm.expectRevert(MidenVault.AsyncOnly.selector);
        vault.previewRedeem(1);
    }

    function test_settleNeedsAdministratorNav() public {
        _subscribe(alice, 1_000e6);
        vm.warp(block.timestamp + EPOCH);
        vm.startPrank(keeper);
        vault.closeEpoch();
        vm.expectRevert(MidenVault.NavMissing.selector);
        vault.settleEpoch();
        vm.stopPrank();
    }

    // ================================================================== eligibility
    function test_usIdentityCannotSubscribeOrReceive() public {
        deal(address(usdc), usPerson, 1_000e6);
        vm.startPrank(usPerson);
        usdc.approve(address(vault), 1_000e6);
        vm.expectRevert(abi.encodeWithSelector(MidenVault.NotVerified.selector, usPerson));
        vault.requestDeposit(1_000e6, usPerson, usPerson);
        vm.stopPrank();

        _fundTwoInvestors();
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(MidenShareToken.NotVerified.selector, usPerson));
        token.forcedTransfer(alice, usPerson, 1e18);
    }

    function test_semiProFirstSubscriptionMinimum() public {
        deal(address(usdc), semi, 400_000e6);
        vm.startPrank(semi);
        usdc.approve(address(vault), 400_000e6);
        vm.expectRevert(MidenVault.BelowSemiProMinimum.selector);
        vault.requestDeposit(199_999e6, semi, semi);
        vault.requestDeposit(200_000e6, semi, semi);
        vm.stopPrank();
    }

    function test_peerTransfersDisabledInPhase1() public {
        _fundTwoInvestors();
        vm.prank(alice);
        vm.expectRevert(MidenShareToken.TransfersDisabled.selector);
        token.transfer(bob, 1e18);
        // the administrator's transfer-request workflow still works
        vm.prank(agent);
        token.forcedTransfer(alice, bob, 1e18);
        assertEq(token.balanceOf(bob), 1_000_001e18);
    }

    function test_transferToUnregisteredWalletReverts() public {
        _fundTwoInvestors();
        _enablePeerTransfers();
        address stranger = makeAddr("stranger");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MidenShareToken.NotVerified.selector, stranger));
        token.transfer(stranger, 1e18);
    }

    function test_semiProAntiSplitting() public {
        _fundTwoInvestors();
        _enablePeerTransfers();
        vm.startPrank(alice);
        vm.expectRevert(MidenShareToken.ComplianceRejected.selector);
        token.transfer(semi, 199_999e18); // EUR 199,999 at NAV
        for (uint256 i; i < 10; i++) {
            vm.expectRevert(MidenShareToken.ComplianceRejected.selector);
            token.transfer(semi, 20_000e18);
        }
        token.transfer(semi, 200_000e18); // EUR 200,000 passes
        vm.stopPrank();
        assertEq(token.balanceOf(semi), 200_000e18);
    }

    function test_minimumHoldingForSender() public {
        _fundTwoInvestors();
        _enablePeerTransfers();
        vm.startPrank(alice);
        vm.expectRevert(MidenShareToken.ComplianceRejected.selector);
        token.transfer(bob, 800_001e18); // would leave EUR 199,999
        token.transfer(bob, 1_000_000e18); // full balance passes
        vm.stopPrank();
    }

    function test_sameIdentityTransferAlwaysPasses() public {
        _fundTwoInvestors();
        _enablePeerTransfers();
        address alice2 = makeAddr("alice-cold-wallet");
        vm.prank(agent);
        reg.linkWallet(alice2, alice);
        vm.prank(alice);
        token.transfer(alice2, 999_999e18); // leaves 1 unit in the first wallet, still passes
        assertEq(token.balanceOf(alice2), 999_999e18);
    }

    function test_frozenWalletAndRecovery() public {
        _fundTwoInvestors();
        address newWallet = makeAddr("alice-new");
        vm.startPrank(agent);
        token.setAddressFrozen(alice, true);
        reg.linkWallet(newWallet, alice);
        token.recoveryAddress(alice, newWallet, alice);
        vm.stopPrank();
        assertEq(token.balanceOf(newWallet), 1_000_000e18);
        assertTrue(token.isFrozen(newWallet));
    }

    // ================================================================== liquidity tools
    function test_gateFillsProRataWithoutSeniority() public {
        _fundTwoInvestors(); // NAV 2,000,000
        vm.prank(alice);
        vault.requestRedeem(600_000e18, alice, alice); // 30% of NAV, gate 15%
        _cycle(1e6);
        // half filled (300k of 600k); the rest rolls on
        assertEq(vault.claimableRedeemRequest(0, alice), 300_000e18);
        assertEq(vault.pendingRedeemRequest(0, alice), 300_000e18);

        vm.prank(bob);
        vault.requestRedeem(300_000e18, bob, bob);
        _cycle(1e6);
        // both 300k requests are filled by the same percentage: no seniority for the earlier request
        uint256 aliceNew = vault.claimableRedeemRequest(0, alice) - 300_000e18;
        uint256 bobNew = vault.claimableRedeemRequest(0, bob);
        assertApproxEqAbs(aliceNew, bobNew, 1e6);
        assertLt(bobNew, 300_000e18);
    }

    function test_levyOnlyOnNetOutflowAndAccruesToNav() public {
        _fundTwoInvestors();
        // matched flows: 200k in, 200k out -> no levy
        _subscribe(bob, 200_000e6);
        vm.prank(alice);
        vault.requestRedeem(200_000e18, alice, alice);
        _cycle(1e6);
        assertEq(vault.maxWithdraw(alice), 200_000e6);
        assertEq(vault.totalLevies(), 0);

        // net outflow of 10% of NAV -> levy stays in the fund
        vm.prank(bob);
        vault.requestRedeem(200_000e18, bob, bob);
        _cycle(1e6);
        uint256 paid = vault.maxWithdraw(bob);
        assertLt(paid, 200_000e6);
        assertEq(vault.totalLevies(), 200_000e6 - paid);
        // remaining holders now own more USDC per unit than 1.00
        uint256 cashPerUnit = (usdc.balanceOf(address(vault)) - vault.reservedAssets()) * 1e18 / token.totalSupply();
        assertGt(cashPerUnit, 1e6);
    }

    function test_earlyRedemptionFeeInsideLockup() public {
        liq.setEarlyRedemption(100, 180 days);
        _fundTwoInvestors();
        uint256 supplyBefore = token.totalSupply();
        vm.prank(alice);
        vault.requestRedeem(100_000e18, alice, alice);
        assertEq(token.totalSupply(), supplyBefore - 1_000e18); // 1% burned for the remaining holders
        assertEq(vault.pendingRedeemRequest(0, alice), 99_000e18);
    }

    // ================================================================== roles, leverage, breakers
    function test_keeperCannotWithdrawChangeParamsOrUnpause() public {
        vm.startPrank(keeper);
        vm.expectRevert();
        strat.withdrawToDepositary(keeper, 1);
        vm.expectRevert();
        strat.setParams(50_000, 500, 200, 2_000, 10_000, 1e12);
        vm.expectRevert(StrategyManager.OnlyVault.selector);
        strat.deallocate(1);
        vm.expectRevert();
        liq.setGate(10_000);
        vault.pause();
        vm.expectRevert();
        vault.unpause();
        vm.stopPrank();
    }

    function test_leverageCannotExceedCap() public {
        _fundTwoInvestors();
        vm.startPrank(keeper);
        vault.deployToStrategy(2_000_000e6);
        bytes32 eth = strat.ETH();
        vm.expectRevert(StrategyManager.LeverageAboveCap.selector);
        strat.setTargetLeverage(30_001);
        vm.expectRevert(SimulatedHyperliquidAdapter.OnlyManager.selector);
        adapter.openHedge(eth, 1, 100_000);
        vm.stopPrank();
        assertLe(adapter.getLeverage(strat.ETH()), 30_001);

        strat.setParams(20_000, 500, 200, 2_000, 10_000, 1_000_000e6); // AIFM lowers the cap to 2x
        assertEq(strat.targetLeverageBps(), 20_000);
        vm.prank(keeper);
        strat.rebalanceHedge();
        assertApproxEqAbs(adapter.getLeverage(strat.ETH()), 20_000, 2);
    }

    function test_priceShockRehedgesToTarget() public {
        _fundTwoInvestors();
        vm.startPrank(keeper);
        vault.deployToStrategy(1_000_000e6);
        adapter.markPrice(3_250e6); // ETH +30%: short margin shrinks
        assertTrue(strat.marginBelowFloor());
        strat.rebalanceHedge();
        vm.stopPrank();
        assertFalse(strat.marginBelowFloor());
        assertApproxEqAbs(adapter.getLeverage(strat.ETH()), 30_000, 2);
    }

    function test_fundingCompoundsAtManagerLeverage() public {
        _fundTwoInvestors();
        vm.startPrank(keeper);
        vault.deployToStrategy(1_000_000e6);
        uint256 before = strat.totalValue();
        adapter.accrueFunding(0.0000125e18, 24, 0); // ~10.95% APR for one day
        vm.stopPrank();
        assertGt(strat.totalValue(), before);
        assertApproxEqAbs(adapter.getLeverage(strat.ETH()), 30_000, 2);
    }

    function test_breakerPausesAndOnlyAdminResumes() public {
        vm.prank(keeper);
        strat.tripBreaker("margin below floor");
        assertTrue(strat.paused());
        assertTrue(vault.paused());
        vm.startPrank(keeper);
        vm.expectRevert();
        strat.unpause();
        vm.expectRevert();
        vault.unpause();
        vm.stopPrank();
        strat.unpause();
        vault.unpause();
        assertFalse(vault.paused());
    }

    function test_withdrawOnlyToDepositaryAllowlist() public {
        _fundTwoInvestors();
        vm.prank(keeper);
        vault.deployToStrategy(1_000_000e6);
        address depositary = makeAddr("depositary");
        vm.expectRevert(StrategyManager.NotAllowlisted.selector);
        strat.withdrawToDepositary(depositary, 1e6);
        strat.setDepositaryAllowlist(depositary, true);
        strat.withdrawToDepositary(depositary, 1e6);
        assertEq(usdc.balanceOf(depositary), 1e6);
    }

    function test_navOracleRejectsImplausibleMove() public {
        vm.prank(agent);
        vm.expectRevert(NavOracle.ChangeTooLarge.selector);
        oracle.publish(1, 1.2e6, 1.2e6); // +20% vs 10% bound
    }

    function test_testnetSelfOnboarding() public {
        TestnetOnboarding onboard = new TestnetOnboarding(reg);
        reg.grantRole(Roles.AGENT, address(onboard));
        address tester = makeAddr("tester");
        vm.prank(tester);
        onboard.registerMe(DE);
        assertTrue(reg.isVerified(tester));
        address usTester = makeAddr("us-tester");
        vm.prank(usTester);
        onboard.registerMe(US);
        assertFalse(reg.isVerified(usTester));
    }
}
