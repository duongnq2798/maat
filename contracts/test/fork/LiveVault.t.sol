// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console2} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {MandateVault} from "../../src/MandateVault.sol";
import {IMandateVaultEvents} from "../../src/IMandateVaultEvents.sol";
import {Action, Reason, Intent, Mandate, TokenConfig} from "../../src/Types.sol";
import {IERC20Minimal} from "../../src/interfaces/IExternal.sol";
import {ICreditAdapter} from "../../src/adapters/ICreditAdapter.sol";
import {LiveFork} from "./live/LiveFork.sol";
import {decidedWhileActing} from "./live/LiveHandlers.sol";

/// @notice The vault deployed on Base mainnet, at the pinned fork block: what a stolen executor key can do with it,
/// and previewIntent against execute on random intents from the live executor. Run by .github/workflows/live-fork.yml.
contract LiveVaultForkTest is LiveFork {
    bytes32 internal constant RATIONALE = keccak256("live-fork");

    MandateVault internal vault = LIVE;
    IERC20Minimal internal usdc;
    address internal owner;
    address internal executor;
    address[] internal tokens;
    Mandate internal m;
    uint256 internal nonce;

    function setUp() public {
        _selectLiveFork();
        usdc = IERC20Minimal(vault.usdc());
        owner = vault.owner();
        executor = vault.executor();
        tokens = vault.tokens();
        m = vault.mandate();
        assertGt(tokens.length, 0, "the live vault lists no token");
        // More than a day's cap and a trade's cap together, so INSUFFICIENT_BALANCE never stands in for a cap.
        _fundAsOwner(uint256(m.dailyCapUsd) + m.perTradeCapUsd);
    }

    // ------------------------------------------------------------------ a compromised executor

    /// A stolen executor key at Base head. Everything it can move goes through execute(): USDC only to an allowlisted
    /// payee, never more than the per-trade cap at once, never more than what is left of the daily cap in a UTC day,
    /// and no BUY over the cap. Every owner function reverts NotOwner, and a used intent id cannot be sent again.
    function test_compromisedExecutorIsBounded() public {
        address exec = executor;
        if (exec == owner) {
            // The owner's wallet still holds the role at this block (deployments/README.md, "Switch the executor to
            // the CDP Server Wallet"). The owner-only checks need a key that is not the owner, so the owner hands the
            // role to one on the fork, as that step does.
            exec = makeAddr("compromised executor");
            vm.prank(owner);
            vault.setExecutor(exec);
            console2.log("the executor is the owner at this block: the role is handed to", exec);
        }
        address attacker = makeAddr("attacker");
        address[] memory payees = vault.payees();
        assertGt(payees.length, 0, "the live vault allowlists no payee");
        address payee = payees[0];
        bool paused = vault.paused();
        uint256 day = vault.today();
        uint256 spent = vault.spentOnDay(day);
        assertLe(spent, m.dailyCapUsd, "spent today is over the daily cap");
        uint256 room = m.dailyCapUsd - spent;
        uint256 cash = usdc.balanceOf(address(vault));
        uint256 payeeBefore = usdc.balanceOf(payee);
        uint256 attackerBefore = usdc.balanceOf(attacker);

        // Pay the attacker, then pay an allowlisted payee more than the per-trade cap.
        _expectRefused(
            exec, _intent(Action.PAY_EXPENSE, address(usdc), 1e6, attacker), Reason.PAYEE_NOT_ALLOWED
        );
        _expectRefused(
            exec,
            _intent(Action.PAY_EXPENSE, address(usdc), uint256(m.perTradeCapUsd) + 1, payee),
            Reason.SIZE_LIMIT
        );

        // BUY each stock for more than the per-trade cap: refused before any swap, whatever the market does.
        for (uint256 t; t < tokens.length; ++t) {
            uint256 heldBefore = IERC20Minimal(tokens[t]).balanceOf(address(vault));
            Reason r =
                _sendAs(exec, _intent(Action.BUY, tokens[t], uint256(m.perTradeCapUsd) + 1, address(0)));
            assertTrue(_refusedBeforeTheSizeOrAtIt(r), vm.toString(uint8(r)));
            assertEq(IERC20Minimal(tokens[t]).balanceOf(address(vault)), heldBefore);
        }
        assertEq(usdc.balanceOf(address(vault)), cash);

        // Drain to the allowlisted payee: no more than the room left under today's cap, then SIZE_LIMIT.
        uint256 paid;
        while (!paused && paid < room) {
            uint256 amount = room - paid < m.perTradeCapUsd ? room - paid : m.perTradeCapUsd;
            Reason r = _sendAs(exec, _intent(Action.PAY_EXPENSE, address(usdc), amount, payee));
            assertEq(uint8(r), uint8(Reason.OK), "a payment within both caps");
            paid += amount;
        }
        _expectRefused(exec, _intent(Action.PAY_EXPENSE, address(usdc), 1, payee), Reason.SIZE_LIMIT);
        if (!paused) assertEq(vault.spentOnDay(day), m.dailyCapUsd);

        _assertOwnerFunctionsRevert(exec, attacker);

        // A used id cannot be sent again.
        Intent memory used = _intent(Action.PAY_EXPENSE, address(usdc), 1, attacker);
        _sendAs(exec, used);
        vm.prank(exec, exec);
        vm.expectRevert(abi.encodeWithSelector(MandateVault.IntentAlreadyUsed.selector, used.id));
        vault.execute(used);

        assertEq(usdc.balanceOf(attacker), attackerBefore, "the attacker gained USDC");
        assertEq(usdc.balanceOf(payee), payeeBefore + paid);
        assertEq(usdc.balanceOf(address(vault)), cash - paid);
        console2.log("paid to the allowlisted payee before SIZE_LIMIT (USDC, 6 decimals)", paid);
    }

    // ------------------------------------------------------------------ preview and execute

    /// One random intent from the live executor, of any action, on a listed token or on USDC, to a payee or not. The
    /// reason execute returns is the one previewIntent gave just before, except the outcomes only acting can reach
    /// (the ones previewIntent's NatSpec names, and the venue's health check after a BORROW or WITHDRAW_COLLATERAL);
    /// the Decision event carries the same verdict; and a refusal moves no USDC and no stock. 128 runs, half the
    /// default, to keep the workflow's run short.
    /// forge-config: default.fuzz.runs = 128
    function testFuzz_previewMatchesExecute(
        uint8 actionSeed,
        uint256 tokenSeed,
        uint256 amountSeed,
        bool toPayee
    ) public {
        Action a = Action(actionSeed % 7);
        address token = tokenSeed % 8 == 0 ? address(usdc) : tokens[tokenSeed % tokens.length];
        if (a == Action.PAY_EXPENSE || a == Action.BORROW || a == Action.REPAY) token = address(usdc);
        address payee = address(0);
        if (a == Action.PAY_EXPENSE) payee = toPayee ? vault.payees()[0] : makeAddr("not a payee");
        Intent memory i = _intent(a, token, _amount(a, token, amountSeed), payee);

        uint256 usdcBefore = usdc.balanceOf(address(vault));
        uint256 tokenBefore = IERC20Minimal(token).balanceOf(address(vault));
        vm.prank(executor, executor);
        Reason preview = vault.previewIntent(i);

        vm.recordLogs();
        vm.prank(executor, executor);
        (bool allowed, Reason r) = vault.execute(i);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        console2.log("action", uint8(a), "reason", uint8(r));
        assertTrue(r == preview || decidedWhileActing(a, preview, r), "previewIntent and execute disagree");
        assertEq(allowed, r == Reason.OK);
        _assertOneDecision(logs, i, allowed, r);
        assertTrue(vault.usedIntent(i.id));
        if (!allowed) {
            assertEq(usdc.balanceOf(address(vault)), usdcBefore, "a refusal moved USDC");
            assertEq(IERC20Minimal(token).balanceOf(address(vault)), tokenBefore, "a refusal moved stock");
        }
    }

    // ------------------------------------------------------------------ helpers

    function _intent(Action a, address token, uint256 amount, address payee)
        internal
        returns (Intent memory)
    {
        return Intent({
            id: keccak256(abi.encode("live-fork", ++nonce)),
            action: a,
            token: token,
            amount: amount,
            minOut: 0,
            payee: payee,
            rationaleHash: RATIONALE
        });
    }

    function _sendAs(address exec, Intent memory i) internal returns (Reason r) {
        vm.prank(exec, exec);
        (, r) = vault.execute(i);
    }

    /// The vault's pause comes first for every action but REPAY: a paused vault refuses with VAULT_PAUSED instead.
    function _expectRefused(address exec, Intent memory i, Reason want) internal {
        if (vault.paused() && i.action != Action.REPAY) want = Reason.VAULT_PAUSED;
        vm.prank(exec, exec);
        (bool allowed, Reason r) = vault.execute(i);
        assertFalse(allowed);
        assertEq(uint8(r), uint8(want));
    }

    /// A BUY over the per-trade cap with the USDC for it: the pause, the token and market checks come first and may
    /// refuse it; if they pass, the size check does. Never the concentration check after it, and never OK.
    function _refusedBeforeTheSizeOrAtIt(Reason r) internal pure returns (bool) {
        return r == Reason.VAULT_PAUSED || r == Reason.TOKEN_NOT_ALLOWED || r == Reason.TOKEN_PAUSED
            || r == Reason.POLICY_BLOCKED || r == Reason.MARKET_CLOSED || r == Reason.FEED_STALE
            || r == Reason.BAD_PRICE || r == Reason.MULTIPLIER_COOLDOWN || r == Reason.PREMIUM_TOO_HIGH
            || r == Reason.SIZE_LIMIT;
    }

    function _assertOwnerFunctionsRevert(address exec, address attacker) internal {
        address stock = tokens[0];
        (bool allowed, address feed, address pool,) = vault.tokenConfig(stock);
        TokenConfig memory loose =
            TokenConfig({allowed: allowed, feed: feed, pool: pool, maxWeightBps: 10_000});
        Mandate memory wide = m;
        wide.perTradeCapUsd = type(uint128).max;
        wide.dailyCapUsd = type(uint128).max;

        bytes[] memory calls = new bytes[](12);
        calls[0] = abi.encodeCall(MandateVault.withdraw, (address(usdc), 1));
        calls[1] = abi.encodeCall(MandateVault.withdraw, (stock, 1));
        calls[2] = abi.encodeCall(MandateVault.fund, (1));
        calls[3] = abi.encodeCall(MandateVault.setExecutor, (attacker));
        calls[4] = abi.encodeCall(MandateVault.setPaused, (true));
        calls[5] = abi.encodeCall(MandateVault.queueMandate, (wide));
        calls[6] = abi.encodeCall(MandateVault.queueTokenConfig, (stock, loose));
        calls[7] = abi.encodeCall(MandateVault.queuePayee, (attacker, true));
        calls[8] = abi.encodeCall(MandateVault.cancelChange, (vault.mandateChangeHash(m)));
        calls[9] = abi.encodeCall(MandateVault.applyMandate, (wide));
        calls[10] = abi.encodeCall(MandateVault.applyTokenConfig, (stock, loose));
        calls[11] = abi.encodeCall(MandateVault.applyPayee, (attacker, true));
        for (uint256 c; c < calls.length; ++c) {
            vm.prank(exec, exec);
            (bool ok, bytes memory err) = address(vault).call(calls[c]);
            assertFalse(ok, vm.toString(c));
            assertEq(err, abi.encodeWithSelector(MandateVault.NotOwner.selector), vm.toString(c));
        }
    }

    /// Sizes on the scale of each action: USDC up to one and a half per-trade caps for BUY, PAY_EXPENSE, BORROW and
    /// REPAY; for SELL, SUPPLY and WITHDRAW_COLLATERAL up to one and a half times what the vault or the credit
    /// adapter holds. Zero one time in sixteen.
    function _amount(Action a, address token, uint256 seed) internal view returns (uint256) {
        if (seed % 16 == 0) return 0;
        seed >>= 4;
        if (a == Action.BUY || a == Action.PAY_EXPENSE || a == Action.BORROW || a == Action.REPAY) {
            return bound(seed, 1, uint256(m.perTradeCapUsd) * 3 / 2);
        }
        uint256 held = a == Action.WITHDRAW_COLLATERAL
            ? _supplied(token)
            : IERC20Minimal(token).balanceOf(address(vault));
        return bound(seed, 1, held < 2 ? 2 : held * 3 / 2);
    }

    function _supplied(address token) internal view returns (uint256) {
        if (m.creditAdapter == address(0)) return 0;
        try ICreditAdapter(m.creditAdapter).suppliedOf(token) returns (uint256 s) {
            return s;
        } catch {
            return 0;
        }
    }

    function _assertOneDecision(Vm.Log[] memory logs, Intent memory i, bool allowed, Reason r) internal view {
        uint256 found;
        for (uint256 k; k < logs.length; ++k) {
            Vm.Log memory e = logs[k];
            if (e.emitter != address(vault) || e.topics.length == 0) continue;
            if (e.topics[0] != IMandateVaultEvents.Decision.selector) continue;
            ++found;
            assertEq(e.topics[1], i.id);
            assertEq(address(uint160(uint256(e.topics[2]))), i.token);
            (Action action, uint256 amount, bool ok, Reason reason, bytes32 rh) =
                abi.decode(e.data, (Action, uint256, bool, Reason, bytes32));
            assertEq(uint8(action), uint8(i.action));
            assertEq(amount, i.amount);
            assertEq(ok, allowed);
            assertEq(uint8(reason), uint8(r));
            assertEq(rh, i.rationaleHash);
        }
        assertEq(found, 1, "expected exactly one Decision");
    }
}
