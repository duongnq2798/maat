// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MandateVault} from "../../src/MandateVault.sol";
import {MarketCalendar} from "../../src/MarketCalendar.sol";
import {Reason, SessionMode, Mandate, TokenConfig} from "../../src/Types.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockB20} from "../mocks/MockB20.sol";
import {MockFeed} from "../mocks/MockFeed.sol";
import {MockPool} from "../mocks/MockPool.sol";
import {MockPolicyRegistry} from "../mocks/MockPolicyRegistry.sol";
import {MockSwapAdapter} from "../mocks/MockSwapAdapter.sol";
import {MockCreditAdapter} from "../mocks/MockCreditAdapter.sol";
import {Env, Ghosts} from "./VaultHandler.sol";
import {TradeHandler} from "./TradeHandler.sol";
import {ExpenseHandler} from "./ExpenseHandler.sol";
import {CreditHandler} from "./CreditHandler.sol";
import {TimeHandler} from "./TimeHandler.sol";
import {OwnerHandler} from "./OwnerHandler.sol";

/// @notice Stateful fuzzing of MandateVault: random sequences of trades, payments, credit actions, clock moves and
/// timelocked mandate changes against a two-stock vault with credit, on mocks that follow their ABI. Runs and depth
/// are in foundry.toml ([invariant], and [profile.deep.invariant] for a longer run).
contract MandateVaultInvariants is Test {
    uint256 internal constant MON_1030_ET = 1795447800; // Mon 2026-11-23 15:30 UTC, the week of Thanksgiving
    uint256 internal constant VAULT_USDC = 1_000e6;
    uint256 internal constant SWAP_USDC = 1_000_000e6;
    uint256 internal constant CREDIT_USDC = 10_000e6;

    address internal owner = makeAddr("owner");
    address internal executor = makeAddr("executor");

    MockERC20 internal usdc;
    MandateVault internal vault;
    MockSwapAdapter internal swap;
    MockCreditAdapter internal credit;
    MockB20[2] internal tokens;
    address[2] internal payees;
    Ghosts internal ghosts;

    TradeHandler internal trade;
    ExpenseHandler internal expense;
    CreditHandler internal creditActions;
    TimeHandler internal time;
    OwnerHandler internal ownerActions;

    function setUp() public {
        vm.warp(MON_1030_ET);
        usdc = new MockERC20("USDC", 6);
        MarketCalendar calendar = new MarketCalendar(owner);
        MockPolicyRegistry registry = new MockPolicyRegistry();
        swap = new MockSwapAdapter();
        MockFeed[2] memory feeds;
        address[] memory listed = new address[](2);
        TokenConfig[] memory configs = new TokenConfig[](2);
        tokens[0] = new MockB20("NVDAc");
        tokens[1] = new MockB20("AAPLc");
        for (uint256 t; t < 2; ++t) {
            feeds[t] = new MockFeed(200e8);
            MockPool pool = new MockPool(address(usdc), address(tokens[t]));
            pool.setTick(-6932, 1800); // ~ $200.0036
            listed[t] = address(tokens[t]);
            configs[t] = TokenConfig({
                allowed: true, feed: address(feeds[t]), pool: address(pool), maxWeightBps: 4000
            });
        }
        payees = [makeAddr("payee"), makeAddr("payee2")];
        address[] memory allowlist = new address[](2);
        (allowlist[0], allowlist[1]) = (payees[0], payees[1]);

        // the adapter is bound to the vault's address before the vault exists: no call may sit between the two
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        credit = new MockCreditAdapter(predicted, address(usdc));
        Mandate[3] memory mandates = _mandates(address(calendar));
        vault = new MandateVault(
            owner, executor, address(usdc), address(registry), mandates[0], listed, configs, allowlist
        );
        assertEq(address(vault), predicted);

        usdc.mint(address(vault), VAULT_USDC);
        usdc.mint(address(swap), SWAP_USDC);
        usdc.mint(address(credit), CREDIT_USDC);
        vault.notifyRevenue();
        for (uint256 t; t < 2; ++t) {
            tokens[t].mint(address(vault), 0.5e8); // $100 each
            tokens[t].mint(address(swap), 1_000e8);
            credit.setSupported(address(tokens[t]), true);
        }

        ghosts = new Ghosts();
        Env memory env = Env({
            vault: vault,
            usdc: usdc,
            tokens: tokens,
            feeds: feeds,
            unlisted: new MockB20("TSLAc"),
            swap: swap,
            credit: credit,
            executor: executor,
            payees: payees
        });
        trade = new TradeHandler(env, ghosts);
        expense = new ExpenseHandler(env, ghosts);
        creditActions = new CreditHandler(env, ghosts);
        time = new TimeHandler(calendar, feeds);
        ownerActions = new OwnerHandler(vault, owner, mandates);
        targetContract(address(trade));
        targetContract(address(expense));
        targetContract(address(creditActions));
        targetContract(address(time));
        targetContract(address(ownerActions));
    }

    /// @dev [0] is the vault's mandate at deployment (the unit tests' defaults, with credit); [1] has lower caps,
    /// a wider slippage limit and a longer de-risk window; [2] trades on the feed's 24/5 session with a higher cap.
    function _mandates(address calendar) internal view returns (Mandate[3] memory m) {
        // one struct each: assigning a memory struct copies a reference, not the values
        for (uint256 i; i < 3; ++i) {
            m[i] = _baseMandate(calendar);
        }
        m[1].perTradeCapUsd = 30e6;
        m[1].dailyCapUsd = 60e6;
        m[1].maxSlippageBps = 150;
        m[1].deriskWindow = 8 hours;
        m[2].sessionMode = SessionMode.FEED_24_5;
        m[2].dailyCapUsd = 150e6;
    }

    function _baseMandate(address calendar) internal view returns (Mandate memory) {
        return Mandate({
            sessionMode: SessionMode.REGULAR,
            maxPremiumBps: 50,
            maxSlippageBps: 100,
            maxStaleness: 3600,
            multiplierCooldown: 1 days,
            twapWindow: 1800,
            perTradeCapUsd: 50e6,
            dailyCapUsd: 100e6,
            calendar: calendar,
            swapAdapter: address(swap),
            creditAdapter: address(credit),
            minHealthFactor: 1.5e18,
            targetHealthFactor: 2e18,
            deriskWindow: 6 hours
        });
    }

    // ------------------------------------------------------------------ invariants

    function invariant_executeRevertsOnlyWithNotExecutorOrIntentAlreadyUsed() public view {
        assertEq(ghosts.revertViolations(), 0, ghosts.lastViolation());
    }

    /// @dev Every UTC day an execute ran, midnight crossings included: under the largest cap in force that day,
    /// and equal to the notional of what was allowed.
    function invariant_spentOnDayStaysWithinTheDailyCap() public view {
        for (uint256 j; j < ghosts.dayCount(); ++j) {
            uint256 day = ghosts.dayAt(j);
            uint256 spent = vault.spentOnDay(day);
            assertLe(spent, ghosts.maxDailyCap(day), vm.toString(day));
            assertEq(spent, ghosts.spentModel(day), vm.toString(day));
        }
    }

    function invariant_noAllowanceOutlivesACall() public view {
        assertEq(ghosts.allowancesLeft(), 0, ghosts.lastViolation());
        address[2] memory spenders = [address(swap), address(credit)];
        for (uint256 s; s < 2; ++s) {
            assertEq(usdc.allowance(address(vault), spenders[s]), 0);
            assertEq(tokens[0].allowance(address(vault), spenders[s]), 0);
            assertEq(tokens[1].allowance(address(vault), spenders[s]), 0);
        }
    }

    /// @dev Seen per transfer by the handlers, and by balance: all the USDC there is stays with the vault, the
    /// two adapters and the payees.
    function invariant_usdcLeavesOnlyToAnAdapterOrAPayee() public view {
        assertEq(ghosts.strayOutflows(), 0, ghosts.lastViolation());
        uint256 held = usdc.balanceOf(address(vault)) + usdc.balanceOf(address(swap))
            + usdc.balanceOf(address(credit)) + usdc.balanceOf(payees[0]) + usdc.balanceOf(payees[1]);
        assertEq(held, VAULT_USDC + SWAP_USDC + CREDIT_USDC);
    }

    function invariant_previewMatchesExecuteUntilItActs() public view {
        assertEq(ghosts.previewMismatches(), 0, ghosts.lastViolation());
    }

    function invariant_mandateChangesOnlyThroughATimelockedApply() public view {
        assertEq(vault.mandateHash(), ownerActions.expectedMandateHash());
        assertEq(ownerActions.timelockViolations(), 0, ownerActions.lastViolation());
    }

    // ------------------------------------------------------------------ coverage

    /// @dev Runs at the end of each run: the run must have reached the allowed path of every handler, both expected
    /// reverts, applied mandate changes, spends on consecutive UTC days and a spread of refusals, or the invariants
    /// above would hold for nothing. The thresholds are far below what a run of the configured depth reaches.
    function afterInvariant() public view {
        assertGe(trade.allowedSends(), 10, "allowed trades");
        assertGe(expense.allowedSends(), 5, "allowed payments");
        assertGe(creditActions.allowedSends(), 25, "allowed credit actions");
        assertGe(ownerActions.applied(), 1, "applied mandate changes");
        assertGe(ownerActions.refusedApplies(), 1, "refused mandate changes");
        assertGe(ghosts.expectedReverts(), 5, "NotExecutor and IntentAlreadyUsed reverts");
        assertGe(ghosts.adjacentSpendDays(), 1, "spends on both sides of a UTC midnight");
        assertGe(time.openLandings(), 10, "landings in a session");

        uint256 refused = trade.refusedReasons() | expense.refusedReasons() | creditActions.refusedReasons();
        assertTrue(refused & (1 << uint8(Reason.MARKET_CLOSED)) != 0, "MARKET_CLOSED");
        assertTrue(refused & (1 << uint8(Reason.PAYEE_NOT_ALLOWED)) != 0, "PAYEE_NOT_ALLOWED");
        assertTrue(refused & (1 << uint8(Reason.INSUFFICIENT_BALANCE)) != 0, "INSUFFICIENT_BALANCE");
        uint256 kinds;
        for (; refused != 0; refused &= refused - 1) {
            ++kinds;
        }
        assertGe(kinds, 6, "kinds of refusal");
    }
}
