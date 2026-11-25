// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MandateVault} from "../../src/MandateVault.sol";
import {MarketCalendar} from "../../src/MarketCalendar.sol";
import {Reason, SessionMode, Mandate} from "../../src/Types.sol";
import {IERC20Minimal} from "../../src/interfaces/IExternal.sol";
import {AaveV4CreditAdapter} from "../../src/adapters/AaveV4CreditAdapter.sol";
import {MockFeed} from "../mocks/MockFeed.sol";
import {Ghosts} from "../invariant/VaultHandler.sol";
import {TimeHandler} from "../invariant/TimeHandler.sol";
import {OwnerHandler} from "../invariant/OwnerHandler.sol";
import {LiveFork} from "./live/LiveFork.sol";
import {LiveEnv, LiveTradeHandler, LiveExpenseHandler, LiveCreditHandler} from "./live/LiveHandlers.sol";

/// @notice The six invariants of test/invariant/MandateVaultInvariants.t.sol, on the vault deployed on Base mainnet
/// at the pinned fork block: random trades, payments and credit actions sent as the live executor, clock moves and
/// timelocked mandate changes queued and applied as the live owner. No mocks: the real tokens, Chainlink feeds,
/// Aerodrome pools, MarketCalendar and Aave V4 adapter the live mandate names. Run by
/// .github/workflows/live-fork.yml.
/// @dev 2,048 calls in 4 runs of 512, set here so a run by hand of test/fork/* is as short as the workflow's. Not
/// shorter runs: afterInvariant asks every run for a PAYEE_NOT_ALLOWED and a TOKEN_NOT_ALLOWED refusal, and each
/// comes about once in 46 calls (PAYEE_NOT_ALLOWED: 1 selector in 10, a payee off the allowlist 1 time in 4, 14 sends
/// in 16 neither a stranger's nor a replay), so a run of 128 calls can miss one, and one did.
/// forge-config: default.invariant.runs = 4
/// forge-config: default.invariant.depth = 512
contract LiveVaultInvariants is LiveFork {
    /// The owner's fund call on the fork, so payments and buys are not all INSUFFICIENT_BALANCE: two daily caps of
    /// the live mandate.
    uint256 internal topUp;

    MandateVault internal vault;
    IERC20Minimal internal usdc;
    address internal owner;
    address internal swap;
    address internal credit;
    address[] internal tokens;
    address[] internal payees;
    bool internal pausedAtFork;
    Ghosts internal ghosts;

    /// spentOnDay of the fork block's UTC day before the run, which the run's model adds to.
    uint256 internal forkDay;
    uint256 internal forkDaySpent;

    /// The USDC each address the handlers may send to off the allowlist holds before the run.
    address[2] internal outsiders;
    uint256[2] internal outsiderUsdc;
    /// Every address USDC can reach from the vault on the fork: the vault, both adapters, the payees, the pools and
    /// the venue's hub. Nothing else moves on a fork, so their total must not change.
    address[] internal reachable;
    uint256 internal reachableUsdc;

    LiveTradeHandler internal trade;
    LiveExpenseHandler internal expense;
    LiveCreditHandler internal creditActions;
    TimeHandler internal time;
    OwnerHandler internal ownerActions;

    function setUp() public {
        _selectLiveFork();
        vault = LIVE;
        usdc = IERC20Minimal(vault.usdc());
        owner = vault.owner();
        Mandate memory live = vault.mandate();
        swap = live.swapAdapter;
        credit = live.creditAdapter;
        tokens = vault.tokens();
        payees = vault.payees();
        pausedAtFork = vault.paused();

        forkDay = vm.getBlockTimestamp() / 1 days;
        forkDaySpent = vault.spentOnDay(forkDay);
        assertLe(forkDaySpent, live.dailyCapUsd, "the fork block's UTC day is already over the daily cap");
        topUp = 2 * uint256(live.dailyCapUsd);
        _fundAsOwner(topUp);

        ghosts = new Ghosts();
        ghosts.touch(forkDay, live.dailyCapUsd);
        Mandate[3] memory mandates = _mandates(live);
        // The owner handler starts with nothing queued: cancel any of its three mandates the live owner has queued.
        for (uint256 i; i < 3; ++i) {
            bytes32 h = vault.mandateChangeHash(mandates[i]);
            if (vault.queuedAt(h) != 0) {
                vm.prank(owner);
                vault.cancelChange(h);
            }
        }

        LiveEnv memory env = LiveEnv({
            vault: vault, usdc: address(usdc), executor: vault.executor(), swap: swap, credit: credit
        });
        trade = new LiveTradeHandler(env, tokens, payees, ghosts);
        expense = new LiveExpenseHandler(env, tokens, payees, ghosts);
        creditActions = new LiveCreditHandler(env, tokens, payees, ghosts);
        MockFeed[2] memory noFeeds; // the live feeds keep their last answers and go stale as the clock moves
        time = new TimeHandler(MarketCalendar(live.calendar), noFeeds);
        ownerActions = new OwnerHandler(vault, owner, mandates);
        targetContract(address(trade));
        targetContract(address(expense));
        targetContract(address(creditActions));
        targetContract(address(time));
        targetContract(address(ownerActions));
        targetSender(FUZZ_SENDER);

        outsiders = [expense.STRANGER(), expense.NOT_A_PAYEE()];
        for (uint256 o; o < 2; ++o) {
            outsiderUsdc[o] = usdc.balanceOf(outsiders[o]);
        }
        _collectReachable();
    }

    /// @dev [0] is the live mandate; [1] has lower caps, a wider slippage limit and another de-risk window; [2] trades
    /// in the other session mode with a higher daily cap. All three keep the live calendar and adapters.
    function _mandates(Mandate memory live) internal pure returns (Mandate[3] memory m) {
        // one struct each: assigning a memory struct copies a reference, not the values
        for (uint256 i; i < 3; ++i) {
            m[i] = _copy(live);
        }
        m[1].perTradeCapUsd = live.perTradeCapUsd * 3 / 5;
        m[1].dailyCapUsd = live.dailyCapUsd * 3 / 5;
        m[1].maxSlippageBps = live.maxSlippageBps + 50 > 10_000 ? 10_000 : live.maxSlippageBps + 50;
        m[1].deriskWindow = live.deriskWindow == 6 hours ? 8 hours : 6 hours;
        m[2].sessionMode =
            live.sessionMode == SessionMode.REGULAR ? SessionMode.FEED_24_5 : SessionMode.REGULAR;
        m[2].dailyCapUsd = live.dailyCapUsd * 3 / 2;
    }

    function _copy(Mandate memory a) internal pure returns (Mandate memory) {
        return abi.decode(abi.encode(a), (Mandate));
    }

    function _collectReachable() internal {
        reachable.push(address(vault));
        reachable.push(swap);
        if (credit != address(0)) {
            reachable.push(credit);
            reachable.push(AaveV4CreditAdapter(credit).hub());
        }
        for (uint256 p; p < payees.length; ++p) {
            reachable.push(payees[p]);
        }
        for (uint256 t; t < tokens.length; ++t) {
            (,, address pool,) = vault.tokenConfig(tokens[t]);
            if (pool != address(0)) reachable.push(pool);
        }
        reachableUsdc = _reachableUsdc();
    }

    function _reachableUsdc() internal view returns (uint256 total) {
        for (uint256 r; r < reachable.length; ++r) {
            // an address listed twice (a payee that is also the owner's pool, say) is counted once
            bool seen;
            for (uint256 s; s < r && !seen; ++s) {
                seen = reachable[s] == reachable[r];
            }
            if (!seen) total += usdc.balanceOf(reachable[r]);
        }
    }

    // ------------------------------------------------------------------ invariants

    function invariant_executeRevertsOnlyWithNotExecutorOrIntentAlreadyUsed() public view {
        assertEq(ghosts.revertViolations(), 0, ghosts.lastViolation());
    }

    /// @dev Every UTC day the run touched: under the largest cap in force at an execute that day, and equal to what
    /// the vault had spent that day at the fork block plus the notional of what the run's executes allowed.
    function invariant_spentOnDayStaysWithinTheDailyCap() public view {
        for (uint256 j; j < ghosts.dayCount(); ++j) {
            uint256 day = ghosts.dayAt(j);
            uint256 spent = vault.spentOnDay(day);
            assertLe(spent, ghosts.maxDailyCap(day), vm.toString(day));
            assertEq(spent, (day == forkDay ? forkDaySpent : 0) + ghosts.spentModel(day), vm.toString(day));
        }
    }

    function invariant_noAllowanceOutlivesACall() public view {
        assertEq(ghosts.allowancesLeft(), 0, ghosts.lastViolation());
        address[2] memory spenders = [swap, credit];
        for (uint256 s; s < 2; ++s) {
            if (spenders[s] == address(0)) continue;
            assertEq(usdc.allowance(address(vault), spenders[s]), 0);
            for (uint256 t; t < tokens.length; ++t) {
                assertEq(IERC20Minimal(tokens[t]).allowance(address(vault), spenders[s]), 0);
            }
        }
    }

    /// @dev Seen per transfer by the handlers, and by balance: the addresses off the allowlist gain nothing, and the
    /// USDC the vault can reach on the fork adds up to what it did before the run.
    function invariant_usdcLeavesOnlyToAnAdapterOrAPayee() public view {
        assertEq(ghosts.strayOutflows(), 0, ghosts.lastViolation());
        for (uint256 o; o < 2; ++o) {
            assertEq(usdc.balanceOf(outsiders[o]), outsiderUsdc[o], vm.toString(outsiders[o]));
        }
        assertEq(_reachableUsdc(), reachableUsdc);
    }

    function invariant_previewMatchesExecuteUntilItActs() public view {
        assertEq(ghosts.previewMismatches(), 0, ghosts.lastViolation());
    }

    function invariant_mandateChangesOnlyThroughATimelockedApply() public view {
        assertEq(vault.mandateHash(), ownerActions.expectedMandateHash());
        assertEq(ownerActions.timelockViolations(), 0, ownerActions.lastViolation());
    }

    // ------------------------------------------------------------------ coverage

    /// @dev Runs at the end of each run, so the invariants cannot hold for nothing. The live state decides what is
    /// reachable (an open market, fresh feeds, the vault's holdings), so this asks only for what any block allows:
    /// both expected reverts, an applied and a refused mandate change and, unless the live vault is paused, an
    /// allowed payment and refusals for a payee off the allowlist and for USDC traded as a stock.
    function afterInvariant() public view {
        assertGe(ghosts.notExecutorReverts(), 1, "NotExecutor reverts");
        assertGe(ghosts.replayReverts(), 1, "IntentAlreadyUsed reverts");
        assertGe(ownerActions.applied(), 1, "applied mandate changes");
        assertGe(ownerActions.refusedApplies(), 1, "refused mandate changes");
        uint256 refused = trade.refusedReasons() | expense.refusedReasons() | creditActions.refusedReasons();
        if (pausedAtFork) {
            assertTrue(refused & (1 << uint8(Reason.VAULT_PAUSED)) != 0, "VAULT_PAUSED");
            return;
        }
        assertGe(expense.allowedSends(), 1, "allowed payments");
        assertTrue(refused & (1 << uint8(Reason.PAYEE_NOT_ALLOWED)) != 0, "PAYEE_NOT_ALLOWED");
        assertTrue(refused & (1 << uint8(Reason.TOKEN_NOT_ALLOWED)) != 0, "TOKEN_NOT_ALLOWED");
    }
}
