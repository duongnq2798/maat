// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VaultFixture} from "./utils/VaultFixture.sol";
import {MandateVault} from "../src/MandateVault.sol";
import {Action, Reason, Intent, Mandate, TokenConfig} from "../src/Types.sol";
import {B20Constants} from "../src/interfaces/IB20Asset.sol";
import {MockPool} from "./mocks/MockPool.sol";
import {MockB20} from "./mocks/MockB20.sol";
import {MockFeed} from "./mocks/MockFeed.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockReverter} from "./mocks/MockReverter.sol";
import {MockFaultyERC20} from "./mocks/MockFaultyERC20.sol";

contract MandateVaultTest is VaultFixture {
    function test_buyInSessionIsAllowed() public {
        adapter.setNextOut(0.1e8); // $20 / $200
        Intent memory i = _intent(Action.BUY, 20e6);
        vm.expectEmit(true, true, false, true, address(vault));
        emit Decision(i.id, Action.BUY, address(nvda), 20e6, true, Reason.OK, i.rationaleHash);
        (bool allowed, Reason r) = _exec(i);
        assertTrue(allowed);
        _assertReason(r, Reason.OK);
        assertEq(nvda.balanceOf(address(vault)), 0.1e8);
        assertEq(usdc.balanceOf(address(vault)), 180e6);
        assertEq(vault.spentOnDay(vault.today()), 20e6);
        assertEq(usdc.allowance(address(vault), address(adapter)), 0);
    }

    function test_refusalIsLoggedNotReverted() public {
        vm.warp(SAT_1300_ET);
        feed.set(200e8, block.timestamp);
        Intent memory i = _intent(Action.BUY, 20e6);
        vm.expectEmit(true, true, false, true, address(vault));
        emit Decision(i.id, Action.BUY, address(nvda), 20e6, false, Reason.MARKET_CLOSED, i.rationaleHash);
        (bool allowed, Reason r) = _exec(i);
        assertFalse(allowed);
        _assertReason(r, Reason.MARKET_CLOSED);
        assertEq(usdc.balanceOf(address(vault)), 200e6);
        assertTrue(vault.usedIntent(i.id));
    }

    function test_refusesStaleFeed() public {
        feed.set(200e8, block.timestamp - 7200);
        (, Reason r) = _exec(_intent(Action.BUY, 20e6));
        _assertReason(r, Reason.FEED_STALE);
    }

    function test_refusesPremium() public {
        pool.setTick(-7932, 1800);
        (, Reason r) = _exec(_intent(Action.BUY, 20e6));
        _assertReason(r, Reason.PREMIUM_TOO_HIGH);
    }

    function test_refusesPausedToken() public {
        nvda.setPaused(B20Constants.FEATURE_TRANSFER, true);
        (, Reason r) = _exec(_intent(Action.BUY, 20e6));
        _assertReason(r, Reason.TOKEN_PAUSED);
    }

    function test_refusesWhenPolicyBlocksVault() public {
        nvda.setPolicyId(B20Constants.TRANSFER_RECEIVER_POLICY, 7);
        (, Reason r) = _exec(_intent(Action.BUY, 20e6));
        _assertReason(r, Reason.POLICY_BLOCKED);
        registry.setAuthorized(7, address(vault), true);
        adapter.setNextOut(0.1e8);
        (, r) = _exec(_intent(Action.BUY, 20e6));
        _assertReason(r, Reason.OK);
    }

    function test_multiplierChangeStartsCooldown() public {
        nvda.setUiMultiplier(1.01e18); // legacy-style change: effectiveAt stays 0
        (, Reason r) = _exec(_intent(Action.BUY, 20e6));
        _assertReason(r, Reason.MULTIPLIER_COOLDOWN);
        assertEq(vault.multiplierChangedAt(address(nvda)), block.timestamp);
        assertEq(vault.lastMultiplier(address(nvda)), 1.01e18);

        vm.warp(block.timestamp + 25 hours); // Fri 11:30 ET
        feed.set(200e8, block.timestamp);
        adapter.setNextOut(0.1e8);
        (, r) = _exec(_intent(Action.BUY, 20e6));
        _assertReason(r, Reason.OK);
    }

    function test_pendingMultiplierBlocks() public {
        nvda.setEffectiveAt(block.timestamp + 1 hours);
        (, Reason r) = _exec(_intent(Action.BUY, 20e6));
        _assertReason(r, Reason.MULTIPLIER_COOLDOWN);
    }

    function test_perTradeCap() public {
        (, Reason r) = _exec(_intent(Action.BUY, 60e6));
        _assertReason(r, Reason.SIZE_LIMIT);
    }

    function test_dailyCap() public {
        adapter.setNextOut(0.2e8); // $40 at $200
        (, Reason r) = _exec(_intent(Action.BUY, 40e6));
        _assertReason(r, Reason.OK);
        (, r) = _exec(_intent(Action.BUY, 40e6));
        _assertReason(r, Reason.OK);
        (, r) = _exec(_intent(Action.BUY, 40e6)); // 120 > 100
        _assertReason(r, Reason.SIZE_LIMIT);
    }

    function test_concentration() public {
        adapter.setNextOut(0.25e8); // $50 at $200
        (, Reason r) = _exec(_intent(Action.BUY, 50e6)); // 25% of $200
        _assertReason(r, Reason.OK);
        (, r) = _exec(_intent(Action.BUY, 50e6)); // would be 50% > 40%
        _assertReason(r, Reason.CONCENTRATION);
    }

    function test_slippageFloorIsEnforcedEvenIfAgentSendsZero() public {
        adapter.setNextOut(0.098e8); // floor is 0.099e8 (1% below oracle-implied 0.1e8)
        (bool allowed, Reason r) = _exec(_intent(Action.BUY, 20e6));
        assertFalse(allowed);
        _assertReason(r, Reason.SWAP_FAILED);
        assertEq(usdc.balanceOf(address(vault)), 200e6);
        assertEq(usdc.allowance(address(vault), address(adapter)), 0);
    }

    function test_agentMinOutAboveFloorIsUsed() public {
        adapter.setNextOut(0.1e8);
        Intent memory i = _intent(Action.BUY, 20e6);
        i.minOut = 0.1e8 + 1;
        (, Reason r) = _exec(i);
        _assertReason(r, Reason.SWAP_FAILED);
    }

    function test_swapRevertIsRecorded() public {
        adapter.setRevert(true);
        Intent memory i = _intent(Action.BUY, 20e6);
        (, Reason r) = _exec(i);
        _assertReason(r, Reason.SWAP_FAILED);
        assertTrue(vault.usedIntent(i.id));
        assertEq(vault.spentOnDay(vault.today()), 0);
    }

    function test_sellAfterBuy() public {
        adapter.setNextOut(0.1e8);
        _exec(_intent(Action.BUY, 20e6));
        adapter.setNextOut(19.9e6); // floor = $20 * 0.99 = 19.8e6
        (, Reason r) = _exec(_intent(Action.SELL, 0.1e8));
        _assertReason(r, Reason.OK);
        assertEq(nvda.balanceOf(address(vault)), 0);
        assertEq(usdc.balanceOf(address(vault)), 199.9e6);
        assertEq(vault.spentOnDay(vault.today()), 40e6);
        assertEq(nvda.allowance(address(vault), address(adapter)), 0);
    }

    function test_payExpenseWorksWhenMarketClosed() public {
        vm.warp(SAT_1300_ET);
        Intent memory i = _intent(Action.PAY_EXPENSE, 5e6);
        i.payee = payee;
        (, Reason r) = _exec(i);
        _assertReason(r, Reason.OK);
        assertEq(usdc.balanceOf(payee), 5e6);
        assertEq(vault.recordedUsdc(), 195e6);
    }

    function test_payExpenseRejectsUnknownPayee() public {
        Intent memory i = _intent(Action.PAY_EXPENSE, 5e6);
        i.payee = makeAddr("attacker");
        (, Reason r) = _exec(i);
        _assertReason(r, Reason.PAYEE_NOT_ALLOWED);
        assertEq(usdc.balanceOf(address(vault)), 200e6);
    }

    function test_replayReverts() public {
        Intent memory i = _intent(Action.BUY, 60e6);
        _exec(i);
        vm.prank(executor, executor);
        vm.expectRevert(abi.encodeWithSelector(MandateVault.IntentAlreadyUsed.selector, i.id));
        vault.execute(i);
    }

    function test_onlyExecutorCanExecute() public {
        Intent memory i = _intent(Action.BUY, 20e6);
        vm.prank(owner);
        vm.expectRevert(MandateVault.NotExecutor.selector);
        vault.execute(i);
    }

    function test_unsupportedActionsAreRefused() public {
        (, Reason r) = _exec(_intent(Action.BORROW, 5e6));
        _assertReason(r, Reason.ACTION_NOT_SUPPORTED);
    }

    function test_creditActionsRefusedWhenCreditDisabled() public {
        Action[4] memory acts = [Action.SUPPLY, Action.WITHDRAW_COLLATERAL, Action.BORROW, Action.REPAY];
        for (uint256 k; k < acts.length; ++k) {
            (, Reason r) = _exec(_intent(acts[k], 1e6));
            _assertReason(r, Reason.ACTION_NOT_SUPPORTED);
        }
    }

    function test_vaultPaused() public {
        vm.prank(owner);
        vault.setPaused(true);
        (, Reason r) = _exec(_intent(Action.BUY, 20e6));
        _assertReason(r, Reason.VAULT_PAUSED);
    }

    function test_tokenNotAllowed() public {
        Intent memory i = _intent(Action.BUY, 20e6);
        i.token = address(usdc);
        (, Reason r) = _exec(i);
        _assertReason(r, Reason.TOKEN_NOT_ALLOWED);
    }

    function test_insufficientBalance() public {
        (, Reason r) = _exec(_intent(Action.SELL, 1e8));
        _assertReason(r, Reason.INSUFFICIENT_BALANCE);
        (, r) = _exec(_intent(Action.BUY, 0));
        _assertReason(r, Reason.INSUFFICIENT_BALANCE);
    }

    function test_previewMatchesExecute() public {
        Intent memory i = _intent(Action.BUY, 20e6);
        _assertReason(vault.previewIntent(i), Reason.OK);
        nvda.setUiMultiplier(1.02e18);
        _assertReason(vault.previewIntent(i), Reason.MULTIPLIER_COOLDOWN);
        (, Reason r) = _exec(i);
        _assertReason(r, Reason.MULTIPLIER_COOLDOWN);
    }

    // ------------------------------------------------------------------ controller ruling R1 / R2

    function _deploy(Mandate memory m, TokenConfig memory c) internal returns (MandateVault) {
        address[] memory toks = new address[](1);
        toks[0] = address(nvda);
        TokenConfig[] memory cfgs = new TokenConfig[](1);
        cfgs[0] = c;
        return new MandateVault(owner, executor, address(usdc), address(registry), m, toks, cfgs, new address[](0));
    }

    function _goodConfig() internal view returns (TokenConfig memory) {
        return TokenConfig({allowed: true, feed: address(feed), pool: address(pool), maxWeightBps: 4000});
    }

    /// @dev external wrapper so vm.expectRevert targets the vault constructor revert, not helper internals
    function deployExternal(Mandate memory m, TokenConfig memory c) external returns (MandateVault) {
        return _deploy(m, c);
    }

    function test_lastMultiplierSnapshottedAtConstruction() public view {
        assertEq(vault.lastMultiplier(address(nvda)), nvda.uiMultiplier());
        assertTrue(vault.lastMultiplier(address(nvda)) != 0);
    }

    function test_constructorRejectsFeedWithoutCode() public {
        TokenConfig memory c = _goodConfig();
        c.feed = makeAddr("noCodeFeed");
        Mandate memory m = defaultMandate();
        vm.expectRevert(MandateVault.InvalidConfig.selector);
        this.deployExternal(m, c);
    }

    function test_constructorRejectsPoolWithoutCode() public {
        TokenConfig memory c = _goodConfig();
        c.pool = makeAddr("noCodePool");
        Mandate memory m = defaultMandate();
        vm.expectRevert(MandateVault.InvalidConfig.selector);
        this.deployExternal(m, c);
    }

    function test_constructorRejectsPoolWithMismatchedTokens() public {
        TokenConfig memory c = _goodConfig();
        c.pool = address(new MockPool(address(usdc), makeAddr("otherToken")));
        Mandate memory m = defaultMandate();
        vm.expectRevert(MandateVault.InvalidConfig.selector);
        this.deployExternal(m, c);
    }

    function test_constructorAcceptsPoolWithTokensInEitherOrder() public {
        TokenConfig memory c = _goodConfig();
        c.pool = address(new MockPool(address(nvda), address(usdc)));
        MandateVault v = _deploy(defaultMandate(), c);
        assertTrue(v.lastMultiplier(address(nvda)) != 0);
    }

    function test_constructorRejectsCalendarWithoutCode() public {
        Mandate memory m = defaultMandate();
        m.calendar = makeAddr("noCodeCalendar");
        vm.expectRevert(MandateVault.InvalidConfig.selector);
        this.deployExternal(m, _goodConfig());
    }

    function test_constructorRejectsSwapAdapterWithoutCode() public {
        Mandate memory m = defaultMandate();
        m.swapAdapter = makeAddr("noCodeAdapter");
        vm.expectRevert(MandateVault.InvalidConfig.selector);
        this.deployExternal(m, _goodConfig());
    }

    function test_applyTokenConfigRejectsInvalidFeedAndPool() public {
        TokenConfig memory c = _goodConfig();
        c.feed = makeAddr("noCodeFeed");
        _queueTokenAndWait(address(nvda), c);
        vm.prank(owner);
        vm.expectRevert(MandateVault.InvalidConfig.selector);
        vault.applyTokenConfig(address(nvda), c);

        TokenConfig memory d = _goodConfig();
        d.pool = address(new MockPool(address(usdc), makeAddr("otherToken")));
        _queueTokenAndWait(address(nvda), d);
        vm.prank(owner);
        vm.expectRevert(MandateVault.InvalidConfig.selector);
        vault.applyTokenConfig(address(nvda), d);
    }

    function test_applyMandateRejectsCalendarWithoutCode() public {
        Mandate memory m = defaultMandate();
        m.calendar = makeAddr("noCodeCalendar");
        _queueMandateAndWait(m);
        vm.prank(owner);
        vm.expectRevert(MandateVault.InvalidConfig.selector);
        vault.applyMandate(m);
    }

    function test_applyMandateAcceptsValidMandateAfterTimelock() public {
        Mandate memory m = defaultMandate();
        m.perTradeCapUsd = 10e6;
        _queueMandateAndWait(m);
        vm.prank(owner);
        vault.applyMandate(m);
        assertEq(vault.mandate().perTradeCapUsd, 10e6);
    }

    function test_disallowedTokenConfigSkipsFeedPoolValidation() public {
        TokenConfig memory c = TokenConfig({allowed: false, feed: address(0), pool: address(0), maxWeightBps: 0});
        _queueTokenAndWait(address(nvda), c);
        vm.prank(owner);
        vault.applyTokenConfig(address(nvda), c);
        (bool allowed,,,) = vault.tokenConfig(address(nvda));
        assertFalse(allowed);
    }

    // ------------------------------------------------------------------ fix round 1

    function _addSecondToken() internal returns (MockB20 aapl, MockFeed feedB) {
        aapl = new MockB20("AAPLc");
        feedB = new MockFeed(100e8);
        MockPool poolB = new MockPool(address(usdc), address(aapl));
        TokenConfig memory c =
            TokenConfig({allowed: true, feed: address(feedB), pool: address(poolB), maxWeightBps: 4000});
        _queueTokenAndWait(address(aapl), c);
        vm.prank(owner);
        vault.applyTokenConfig(address(aapl), c);
    }

    function test_delistedHoldingDoesNotRevertBuy() public {
        // queue add + delist together so a single 24h wait keeps us inside the Friday session
        MockB20 aapl = new MockB20("AAPLc");
        MockPool poolB = new MockPool(address(usdc), address(aapl));
        TokenConfig memory add = TokenConfig({
            allowed: true, feed: address(new MockFeed(100e8)), pool: address(poolB), maxWeightBps: 4000
        });
        TokenConfig memory del = TokenConfig({allowed: false, feed: address(0), pool: address(0), maxWeightBps: 0});
        vm.startPrank(owner);
        vault.queueTokenConfig(address(aapl), add);
        vault.queueTokenConfig(address(aapl), del);
        vm.stopPrank();
        vm.warp(block.timestamp + 24 hours);
        vm.startPrank(owner);
        vault.applyTokenConfig(address(aapl), add);
        aapl.mint(address(vault), 5e8);
        vault.applyTokenConfig(address(aapl), del);
        vm.stopPrank();
        feed.set(200e8, block.timestamp);
        adapter.setNextOut(0.1e8);
        Intent memory i = _intent(Action.BUY, 20e6);
        _assertReason(vault.previewIntent(i), Reason.OK);
        (bool allowed, Reason r) = _exec(i);
        assertTrue(allowed);
        _assertReason(r, Reason.OK);
    }

    function test_staleOtherTokenPriceDoesNotRevertBuy() public {
        (MockB20 aapl, MockFeed feedB) = _addSecondToken();
        aapl.mint(address(vault), 5e8);
        feed.set(200e8, block.timestamp);
        feedB.set(100e8, block.timestamp - 2 days); // stale vs maxStaleness 3600
        adapter.setNextOut(0.1e8);
        (bool allowed, Reason r) = _exec(_intent(Action.BUY, 20e6));
        assertTrue(allowed);
        _assertReason(r, Reason.OK);

        feedB.set(0, block.timestamp); // bad price
        (allowed, r) = _exec(_intent(Action.BUY, 20e6));
        assertTrue(allowed);
        _assertReason(r, Reason.OK);
    }

    function test_revertingUiMultiplierFailsClosedWithoutReverting() public {
        nvda.setReverts(false, false, true, false);
        Intent memory i = _intent(Action.BUY, 20e6);
        _assertReason(vault.previewIntent(i), Reason.MULTIPLIER_COOLDOWN);
        (bool allowed, Reason r) = _exec(i);
        assertFalse(allowed);
        _assertReason(r, Reason.MULTIPLIER_COOLDOWN);
        assertTrue(vault.usedIntent(i.id));
        vault.syncMultiplier(address(nvda)); // also non-reverting
    }

    function test_maxSlippageAbove100PercentIsInvalid() public {
        Mandate memory m = defaultMandate();
        m.maxSlippageBps = 10_001;
        vm.expectRevert(MandateVault.InvalidConfig.selector);
        this.deployExternal(m, _goodConfig());

        _queueMandateAndWait(m);
        vm.prank(owner);
        vm.expectRevert(MandateVault.InvalidConfig.selector);
        vault.applyMandate(m);

        m.maxSlippageBps = 10_000; // boundary is accepted
        _queueMandateAndWait(m);
        vm.prank(owner);
        vault.applyMandate(m);
    }

    function test_zeroPayeeRejected() public {
        address[] memory toks = new address[](0);
        TokenConfig[] memory cfgs = new TokenConfig[](0);
        address[] memory payees = new address[](1);
        Mandate memory m = defaultMandate();
        vm.expectRevert(MandateVault.ZeroAddress.selector);
        new MandateVault(owner, executor, address(usdc), address(registry), m, toks, cfgs, payees);

        _queuePayeeAndWait(address(0), true);
        vm.prank(owner);
        vm.expectRevert(MandateVault.ZeroAddress.selector);
        vault.applyPayee(address(0), true);
    }

    function test_reapplyingTokenConfigDoesNotAbsorbMultiplierChange() public {
        nvda.setUiMultiplier(1.05e18); // changed, but never synced into the vault
        TokenConfig memory c = _goodConfig();
        _queueTokenAndWait(address(nvda), c);
        vm.prank(owner);
        vault.applyTokenConfig(address(nvda), c);
        assertEq(vault.lastMultiplier(address(nvda)), 1.05e18);
        assertEq(vault.multiplierChangedAt(address(nvda)), block.timestamp);
        feed.set(200e8, block.timestamp);
        (, Reason r) = _exec(_intent(Action.BUY, 20e6));
        _assertReason(r, Reason.MULTIPLIER_COOLDOWN);
    }

    function test_firstSnapshotStartsNoCooldown() public view {
        assertEq(vault.multiplierChangedAt(address(nvda)), 0);
    }

    function test_sellSwapFailureLeavesBalancesAndAllowanceClean() public {
        adapter.setNextOut(0.1e8);
        _exec(_intent(Action.BUY, 20e6));
        adapter.setNextOut(19.7e6); // below the 19.8e6 floor
        Intent memory i = _intent(Action.SELL, 0.1e8);
        (bool allowed, Reason r) = _exec(i);
        assertFalse(allowed);
        _assertReason(r, Reason.SWAP_FAILED);
        assertEq(nvda.balanceOf(address(vault)), 0.1e8);
        assertEq(usdc.balanceOf(address(vault)), 180e6);
        assertEq(nvda.allowance(address(vault), address(adapter)), 0);
        assertEq(vault.spentOnDay(vault.today()), 20e6);
        assertTrue(vault.usedIntent(i.id));
    }

    // ------------------------------------------------------------------ final review: M1 token-call failures

    /// @dev Replaces the fixture vault with one whose USDC can be made to fail transfer()/approve().
    function _useFaultyUsdcVault() internal returns (MockFaultyERC20 fusdc) {
        fusdc = new MockFaultyERC20();
        MockPool fpool = new MockPool(address(fusdc), address(nvda));
        fpool.setTick(-6932, 1800);
        address[] memory toks = new address[](1);
        toks[0] = address(nvda);
        TokenConfig[] memory cfgs = new TokenConfig[](1);
        cfgs[0] = TokenConfig({allowed: true, feed: address(feed), pool: address(fpool), maxWeightBps: 4000});
        address[] memory payees = new address[](1);
        payees[0] = payee;
        vault =
            new MandateVault(owner, executor, address(fusdc), address(registry), defaultMandate(), toks, cfgs, payees);
        fusdc.mint(address(vault), 200e6);
        vault.notifyRevenue();
    }

    function _assertFailedPayExpense(MockFaultyERC20.Mode mode) internal {
        MockFaultyERC20 fusdc = _useFaultyUsdcVault();
        fusdc.setModes(mode, MockFaultyERC20.Mode.OK);
        Intent memory i = _intent(Action.PAY_EXPENSE, 5e6);
        i.payee = payee;
        _assertReason(vault.previewIntent(i), Reason.OK); // preview cannot predict a token-call failure
        vm.expectEmit(true, true, false, true, address(vault));
        emit Decision(i.id, Action.PAY_EXPENSE, address(nvda), 5e6, false, Reason.TRANSFER_FAILED, i.rationaleHash);
        (bool allowed, Reason r) = _exec(i);
        assertFalse(allowed);
        _assertReason(r, Reason.TRANSFER_FAILED);
        assertTrue(vault.usedIntent(i.id));
        assertEq(fusdc.balanceOf(address(vault)), 200e6);
        assertEq(fusdc.balanceOf(payee), 0);
        assertEq(vault.spentOnDay(vault.today()), 0);
        assertEq(vault.recordedUsdc(), 200e6);
        assertEq(vault.notifyRevenue(), 0);
    }

    function test_payExpenseTransferReturningFalseIsLogged() public {
        _assertFailedPayExpense(MockFaultyERC20.Mode.RETURN_FALSE);
    }

    function test_payExpenseTransferRevertIsLogged() public {
        _assertFailedPayExpense(MockFaultyERC20.Mode.REVERT);
    }

    function _assertFailedApprove(MockFaultyERC20.Mode mode) internal {
        MockFaultyERC20 fusdc = _useFaultyUsdcVault();
        fusdc.setModes(MockFaultyERC20.Mode.OK, mode);
        adapter.setNextOut(0.1e8);
        Intent memory i = _intent(Action.BUY, 20e6);
        (bool allowed, Reason r) = _exec(i);
        assertFalse(allowed);
        _assertReason(r, Reason.TRANSFER_FAILED);
        assertTrue(vault.usedIntent(i.id));
        assertEq(fusdc.balanceOf(address(vault)), 200e6);
        assertEq(nvda.balanceOf(address(vault)), 0);
        assertEq(fusdc.allowance(address(vault), address(adapter)), 0);
        assertEq(vault.spentOnDay(vault.today()), 0);
        assertEq(vault.recordedUsdc(), 200e6);
    }

    function test_buyApproveReturningFalseIsLogged() public {
        _assertFailedApprove(MockFaultyERC20.Mode.RETURN_FALSE);
    }

    function test_buyApproveRevertIsLogged() public {
        _assertFailedApprove(MockFaultyERC20.Mode.REVERT);
    }

    function test_faultyUsdcVaultStillTradesWhenHealthy() public {
        MockFaultyERC20 fusdc = _useFaultyUsdcVault();
        adapter.setNextOut(0.1e8);
        (, Reason r) = _exec(_intent(Action.BUY, 20e6));
        _assertReason(r, Reason.OK);
        assertEq(fusdc.balanceOf(address(vault)), 180e6);
        Intent memory i = _intent(Action.PAY_EXPENSE, 5e6);
        i.payee = payee;
        (, r) = _exec(i);
        _assertReason(r, Reason.OK);
        assertEq(fusdc.balanceOf(payee), 5e6);
        assertEq(vault.spentOnDay(vault.today()), 25e6);
    }

    function test_transferFailedIsAppendedLast() public pure {
        assertEq(uint8(Reason.SWAP_FAILED), 15);
        assertEq(uint8(Reason.TRANSFER_FAILED), 16);
    }

    // ------------------------------------------------------------------ final review: M3 market reasons first

    function test_marketReasonTakesPrecedenceOverBalance() public {
        // in session, stale feed: an over-balance BUY reports the market reason
        feed.set(200e8, block.timestamp - 7200);
        (, Reason r) = _exec(_intent(Action.BUY, 1_000e6));
        _assertReason(r, Reason.FEED_STALE);

        vm.warp(SAT_1300_ET);
        feed.set(200e8, SAT_1300_ET);
        (, r) = _exec(_intent(Action.SELL, 1e8)); // vault holds no NVDAc
        _assertReason(r, Reason.MARKET_CLOSED);
        (, r) = _exec(_intent(Action.BUY, 0));
        _assertReason(r, Reason.MARKET_CLOSED);
    }

    // ------------------------------------------------------------------ final review: M7 decimals validation

    function deployTokenExternal(address token, TokenConfig memory c) external returns (MandateVault) {
        address[] memory toks = new address[](1);
        toks[0] = token;
        TokenConfig[] memory cfgs = new TokenConfig[](1);
        cfgs[0] = c;
        return new MandateVault(
            owner, executor, address(usdc), address(registry), defaultMandate(), toks, cfgs, new address[](0)
        );
    }

    function test_rejectsFeedWithNon8Decimals() public {
        MockFeed f18 = new MockFeed(200e8);
        f18.setDecimals(18);
        TokenConfig memory c = _goodConfig();
        c.feed = address(f18);
        vm.expectRevert(MandateVault.InvalidConfig.selector);
        this.deployExternal(defaultMandate(), c);

        _queueTokenAndWait(address(nvda), c);
        vm.prank(owner);
        vm.expectRevert(MandateVault.InvalidConfig.selector);
        vault.applyTokenConfig(address(nvda), c);
    }

    function test_rejectsFeedWithRevertingDecimals() public {
        TokenConfig memory c = _goodConfig();
        c.feed = address(new MockReverter());
        vm.expectRevert(MandateVault.InvalidConfig.selector);
        this.deployExternal(defaultMandate(), c);
    }

    function test_rejectsTokenWithMoreThan18Decimals() public {
        MockERC20 big = new MockERC20("BIG", 19);
        TokenConfig memory c = _goodConfig();
        c.pool = address(new MockPool(address(usdc), address(big)));
        vm.expectRevert(MandateVault.InvalidConfig.selector);
        this.deployTokenExternal(address(big), c);
    }

    function test_rejectsTokenWithRevertingDecimals() public {
        address bad = address(new MockReverter());
        TokenConfig memory c = _goodConfig();
        c.pool = address(new MockPool(address(usdc), bad));
        vm.expectRevert(MandateVault.InvalidConfig.selector);
        this.deployTokenExternal(bad, c);
    }

    // ------------------------------------------------------------------ final review: M11 coverage

    function _payIntent(uint256 amount) internal returns (Intent memory i) {
        i = _intent(Action.PAY_EXPENSE, amount);
        i.payee = payee;
    }

    function test_payExpenseCountsAgainstDailyCap() public {
        uint256 day = vault.today();
        Intent memory i = _payIntent(50e6);
        vm.expectEmit(true, true, false, true, address(vault));
        emit Decision(i.id, Action.PAY_EXPENSE, address(nvda), 50e6, true, Reason.OK, i.rationaleHash);
        (bool allowed, Reason r) = _exec(i);
        assertTrue(allowed);
        _assertReason(r, Reason.OK);
        assertEq(vault.spentOnDay(day), 50e6);

        (, r) = _exec(_payIntent(50e6));
        _assertReason(r, Reason.OK);
        assertEq(vault.spentOnDay(day), 100e6);

        (allowed, r) = _exec(_payIntent(1e6)); // 101 > dailyCap 100
        assertFalse(allowed);
        _assertReason(r, Reason.SIZE_LIMIT);
        assertEq(vault.spentOnDay(day), 100e6);
        assertEq(usdc.balanceOf(payee), 100e6);
    }

    function test_payExpenseSharesDailyCapWithTrades() public {
        adapter.setNextOut(0.2e8);
        (, Reason r) = _exec(_intent(Action.BUY, 40e6));
        _assertReason(r, Reason.OK);
        (, r) = _exec(_payIntent(50e6));
        _assertReason(r, Reason.OK);
        (, r) = _exec(_payIntent(20e6)); // 40 + 50 + 20 > 100
        _assertReason(r, Reason.SIZE_LIMIT);
        assertEq(vault.spentOnDay(vault.today()), 90e6);
    }

    function test_dailyCapResetsOnUtcDayRollover() public {
        uint256 day = vault.today();
        _exec(_payIntent(50e6));
        _exec(_payIntent(50e6));
        (, Reason r) = _exec(_payIntent(10e6));
        _assertReason(r, Reason.SIZE_LIMIT);

        vm.warp(THU_1030_ET + 1 days); // Fri 2026-11-06 15:30 UTC, next UTC day
        assertEq(vault.today(), day + 1);
        (, r) = _exec(_payIntent(10e6));
        _assertReason(r, Reason.OK);
        assertEq(vault.spentOnDay(day + 1), 10e6);
        assertEq(vault.spentOnDay(day), 100e6);

        feed.set(200e8, THU_1030_ET + 1 days);
        adapter.setNextOut(0.15e8); // $30 at $200; 30 of 90 USDC left stays under maxWeight 40%
        (, r) = _exec(_intent(Action.BUY, 30e6));
        _assertReason(r, Reason.OK);
        assertEq(vault.spentOnDay(day + 1), 40e6);
    }

    function test_thanksgivingIsMarketClosedAtVaultLevel() public {
        uint256 thanksgiving1030Est = 1795707000; // Thu 2026-11-26 15:30 UTC
        vm.warp(thanksgiving1030Est);
        feed.set(200e8, thanksgiving1030Est);
        Intent memory i = _intent(Action.BUY, 20e6);
        _assertReason(vault.previewIntent(i), Reason.MARKET_CLOSED);
        vm.expectEmit(true, true, false, true, address(vault));
        emit Decision(i.id, Action.BUY, address(nvda), 20e6, false, Reason.MARKET_CLOSED, i.rationaleHash);
        (bool allowed, Reason r) = _exec(i);
        assertFalse(allowed);
        _assertReason(r, Reason.MARKET_CLOSED);
        assertEq(usdc.balanceOf(address(vault)), 200e6);

        // control: same time next day (early close 13:00) trades
        vm.warp(thanksgiving1030Est + 1 days);
        feed.set(200e8, thanksgiving1030Est + 1 days);
        adapter.setNextOut(0.1e8);
        (, r) = _exec(_intent(Action.BUY, 20e6));
        _assertReason(r, Reason.OK);
    }
}
