// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {MandateVault} from "../../src/MandateVault.sol";
import {IMandateVaultEvents} from "../../src/IMandateVaultEvents.sol";
import {Action, Reason, Intent} from "../../src/Types.sol";
import {IB20Asset} from "../../src/interfaces/IB20Asset.sol";
import {IERC20Minimal, IAggregatorV3} from "../../src/interfaces/IExternal.sol";
import {ICreditAdapter} from "../../src/adapters/ICreditAdapter.sol";
import {BaseAddresses as A} from "../../script/BaseAddresses.sol";
import {QueueReserveCaps, LIVE_VAULT, RESERVE_CAP_BPS} from "../../script/QueueReserveCaps.s.sol";

/// @notice Rehearses the reserve-cap change on the live Base mainnet vault: the owner queues and, one TIMELOCK
/// later, applies maxWeightBps = 2,500 on all three tokens with exactly the configs QueueReserveCaps prints; then
/// the executor trades against the new cap. No mocks: real feeds, pools, calendar and B20 tokens.
contract QueueReserveCapsForkTest is Test, IMandateVaultEvents {
    /// Tue 2026-11-24 17:29:03 UTC (12:29 ET), in session. The vault holds 15 USDC plus the 3,311,718 raw NVDAc
    /// of the owner's in-session BUY (block 61,745,836) and has emitted no event since. Feed ages here: NVDA
    /// 400 s, GOOGL 1,098 s, AAPL 481 s, so one TIMELOCK later (Wed 2026-11-25 17:29:03 UTC, also in session)
    /// all three answers are still within maxStaleness (25 h).
    uint256 internal constant BLOCK = 61_754_837;
    /// agent/src/policy.ts: each token's target is floor((10,000 - cashReserveBps 3,000) / 3 tokens) bps.
    uint256 internal constant AGENT_TARGET_BPS = 2333;
    uint256 internal constant BPS = 10_000;
    bytes32 internal constant RATIONALE = keccak256("reserve-caps-fork");

    MandateVault internal vault = MandateVault(LIVE_VAULT);
    IERC20Minimal internal usdc = IERC20Minimal(A.USDC);
    QueueReserveCaps internal script;
    address internal owner;
    address internal executor;
    uint256 internal nonce;

    function setUp() public {
        vm.createSelectFork("base", BLOCK);
        script = new QueueReserveCaps();
        owner = vault.owner();
        executor = vault.executor();
        // _equity() counts wallet balances only: nothing is supplied or borrowed through the credit adapter
        ICreditAdapter ca = ICreditAdapter(vault.mandate().creditAdapter);
        assertEq(ca.debt(), 0);
        address[] memory toks = vault.tokens();
        for (uint256 i; i < toks.length; ++i) {
            assertEq(ca.suppliedOf(toks[i]), 0);
        }
    }

    // ------------------------------------------------------------------ the change itself

    function test_scriptChangesOnlyTheCapAndAppliesAfterTheTimelock() public {
        address[3] memory toks = [A.NVDAC, A.GOOGLC, A.AAPLC];
        address[3] memory feeds = [A.NVDA_FEED, A.GOOGL_FEED, A.AAPL_FEED];
        address[3] memory pools = [A.NVDAC_USDC_POOL, A.GOOGLC_USDC_POOL, A.AAPLC_USDC_POOL];
        QueueReserveCaps.Change[] memory c = script.changes(vault);
        assertEq(c.length, 3);
        for (uint256 i; i < 3; ++i) {
            assertEq(c[i].token, toks[i]);
            assertTrue(c[i].current.allowed && c[i].next.allowed);
            assertEq(c[i].current.feed, feeds[i]);
            assertEq(c[i].next.feed, feeds[i]);
            assertEq(c[i].current.pool, pools[i]);
            assertEq(c[i].next.pool, pools[i]);
            assertEq(c[i].current.maxWeightBps, 4000);
            assertEq(c[i].next.maxWeightBps, RESERVE_CAP_BPS);
            assertEq(c[i].changeHash, vault.tokenChangeHash(toks[i], c[i].next));
            assertEq(c[i].queuedAt, 0);
        }
        bytes32 policyBefore = vault.policyHash();

        _queueAndApply();

        for (uint256 i; i < 3; ++i) {
            (bool allowed, address feed, address pool, uint16 w) = vault.tokenConfig(toks[i]);
            assertTrue(allowed);
            assertEq(feed, feeds[i]);
            assertEq(pool, pools[i]);
            assertEq(w, RESERVE_CAP_BPS);
            assertEq(vault.queuedAt(c[i].changeHash), 0); // consumed by the apply
        }
        assertTrue(vault.policyHash() != policyBefore);

        // The lines the owner pastes carry exactly these fields.
        assertEq(
            script.queueCommand(address(vault), A.NVDAC, c[0].next),
            "cast send 0x3F956072d18ddD20d5eFb74e9CCabf8Deade699b"
            " \"queueTokenConfig(address,(bool,address,address,uint16))\" 0xb20000000000000000000078ee7ce2fE4908108C"
            " \"(true,0x04689a41629776563E6822F76f2e57D148d28513,0xF668e21993f0ACd7ab00BB1cFbAeD0df28A3C8EC,2500)\""
            " --account maat-owner --rpc-url https://mainnet.base.org"
        );
        assertEq(
            script.applyCommand(address(vault), A.AAPLC, c[2].next),
            "cast send 0x3F956072d18ddD20d5eFb74e9CCabf8Deade699b"
            " \"applyTokenConfig(address,(bool,address,address,uint16))\" 0xb200000000000000000000C2e324d24d7eEcd1fb"
            " \"(true,0x787f13dEa48Db0897CbCDD985de77809D837F988,0xF5FCB9CDAFcE67d50AfEf298F88E709d2B946BA6,2500)\""
            " --account maat-owner --rpc-url https://mainnet.base.org"
        );
    }

    function test_onlyTheOwnerCanQueue() public {
        QueueReserveCaps.Change[] memory c = script.changes(vault);
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(MandateVault.NotOwner.selector);
        vault.queueTokenConfig(c[0].token, c[0].next);
    }

    // ------------------------------------------------------------------ trading against the new cap

    function test_buysToTheAgentTargetPassAndAbove25PctIsConcentration() public {
        // Under the old 4,000 cap a GOOGLc BUY to 26% of equity is allowed; after the apply it is not.
        uint256 to26Pct = _equity() * 2600 / BPS;
        _assertReason(_preview(A.GOOGLC, to26Pct), Reason.OK, "GOOGLc to 26%, 4,000 cap");
        // NVDAc already sits above 25% here: the owner's $5 BUY was 25.00% of $20 at the NVDA answer of
        // 150.99, which reads 152.70 at this block. A $1 top-up passes the 4,000 cap; once the cap is 2,500 any
        // NVDAc BUY is refused until the weight falls back under it.
        assertGt(_weightBps(A.NVDAC), RESERVE_CAP_BPS);
        _assertReason(_preview(A.NVDAC, 1e6), Reason.OK, "NVDAc $1, 4,000 cap");
        console2.log("equity at the fork block (USDC, 6 decimals)", _equity());
        console2.log("NVDAc weight at the fork block (bps)", _weightBps(A.NVDAC));

        _queueAndApply();
        _assertReason(_preview(A.GOOGLC, to26Pct), Reason.CONCENTRATION, "GOOGLc to 26%, 2,500 cap");
        _assertReason(_preview(A.NVDAC, 1e6), Reason.CONCENTRATION, "NVDAc $1, 2,500 cap");

        // The agent sizes a BUY to its target: AGENT_TARGET_BPS of equity for a token it does not hold yet, so
        // the weight the vault checks, (value + usdIn) * BPS / equity, is at most the target.
        uint256 buy = _equity() * AGENT_TARGET_BPS / BPS;
        assertLe(_weightAfterBuyBps(A.GOOGLC, buy), AGENT_TARGET_BPS);
        _assertReason(_preview(A.GOOGLC, buy), Reason.OK, "GOOGLc to target, preview");
        _assertReason(_buy(A.GOOGLC, buy), Reason.OK, "GOOGLc to target, execute");

        buy = _equity() * AGENT_TARGET_BPS / BPS;
        assertLe(_weightAfterBuyBps(A.AAPLC, buy), AGENT_TARGET_BPS);
        _assertReason(_preview(A.AAPLC, buy), Reason.OK, "AAPLc to target, preview");
        _assertReason(_buy(A.AAPLC, buy), Reason.OK, "AAPLc to target, execute");

        // Valued at the oracle after the swap, a holding reads a little off the target, by the pool's price
        // against the oracle (GOOGLc reads 2,334 bps at this block). Both stay under the cap.
        assertLt(_weightBps(A.GOOGLC), RESERVE_CAP_BPS);
        assertLt(_weightBps(A.AAPLC), RESERVE_CAP_BPS);
        console2.log("GOOGLc weight after its BUY (bps)", _weightBps(A.GOOGLC));
        console2.log("AAPLc weight after its BUY (bps)", _weightBps(A.AAPLC));
        console2.log("cash weight after both BUYs (bps)", usdc.balanceOf(address(vault)) * BPS / _equity());

        // The largest GOOGLc top-up the cap allows ends at exactly 25.00%; one more micro-USDC is refused.
        uint256 maxIn = _maxBuyUnderCap(A.GOOGLC);
        _assertReason(_preview(A.GOOGLC, maxIn), Reason.OK, "GOOGLc to 25.00%");
        _assertReason(_preview(A.GOOGLC, maxIn + 1), Reason.CONCENTRATION, "GOOGLc above 25%, preview");

        uint256 usdcBefore = usdc.balanceOf(address(vault));
        uint256 googlBefore = IB20Asset(A.GOOGLC).balanceOf(address(vault));
        Intent memory over = _intent(Action.BUY, A.GOOGLC, maxIn + 1);
        vm.expectEmit(address(vault));
        emit Decision(over.id, Action.BUY, A.GOOGLC, maxIn + 1, false, Reason.CONCENTRATION, RATIONALE);
        vm.prank(executor, executor);
        (bool allowed, Reason r) = vault.execute(over);
        assertFalse(allowed);
        _assertReason(r, Reason.CONCENTRATION, "GOOGLc above 25%, execute");
        assertEq(usdc.balanceOf(address(vault)), usdcBefore);
        assertEq(IB20Asset(A.GOOGLC).balanceOf(address(vault)), googlBefore);
    }

    /// The cap bounds the bought token's weight at the moment of each BUY; it is not a floor on cash. At this
    /// block NVDAc is already above 25% from its price alone, so BUYs of GOOGLc and AAPLc to exactly 25.00% each,
    /// both allowed, leave cash under 25% of equity. The agent's own targets (23.3% a token, 30% cash) stop
    /// before that; a price rise or a PAY_EXPENSE can also lift a weight, or lower cash, with no BUY at all.
    function test_theCapBoundsEachBuyNotTheCashLeft() public {
        _queueAndApply();
        assertGt(_weightBps(A.NVDAC), RESERVE_CAP_BPS);
        _assertReason(_buy(A.GOOGLC, _maxBuyUnderCap(A.GOOGLC)), Reason.OK, "GOOGLc to 25.00%");
        _assertReason(_buy(A.AAPLC, _maxBuyUnderCap(A.AAPLC)), Reason.OK, "AAPLc to 25.00%");
        uint256 cashBps = usdc.balanceOf(address(vault)) * BPS / _equity();
        console2.log("cash weight after BUYs of GOOGLc and AAPLc to the cap (bps)", cashBps);
        assertLt(cashBps, RESERVE_CAP_BPS);
    }

    // ------------------------------------------------------------------ a held token's feed goes stale

    /// What the cap does when ANOTHER held token's feed is stale. For every holding other than the token being
    /// bought, _weightAfterBuyBps (MandateVault.sol:512) prices it with _latestPrice (:547-553), which returns 0
    /// once the feed's answer is older than maxStaleness. The stale holding then counts for nothing, the vault's
    /// equity shrinks, and the bought token's weight after the BUY grows. The agent values every holding at its
    /// feed's last answer whatever its age (agent/src/chain/state.ts), so a BUY it sizes to its 23.3% target is
    /// refused with CONCENTRATION: at this block it reads 2,332 bps in the agent's view and 3,043 in the vault's.
    /// The difference only ever goes one way: the bought token's own price must be fresh (or the BUY is
    /// FEED_STALE before the weight check), so a stale holding can only lower the vault's equity, and the vault
    /// is stricter than the agent, never looser. The refusal lasts until the stale feed publishes again.
    function test_staleHoldingIsValuedAtZeroSoATargetBuyIsRefused() public {
        _queueAndApply();
        (uint256 buy, uint256 agentEquity, uint256 googlValue) = _holdGooglcThenAgeItsFeed();

        // GOOGL's answer is now one second past maxStaleness: the vault prices the GOOGLc holding at 0.
        uint256 agentViewBps = buy * BPS / agentEquity;
        uint256 vaultViewBps = buy * BPS / (agentEquity - googlValue);
        console2.log("AAPLc weight after the BUY, agent's view (bps)", agentViewBps);
        console2.log("AAPLc weight after the BUY, vault's view with GOOGLc at 0 (bps)", vaultViewBps);
        assertLe(agentViewBps, AGENT_TARGET_BPS);
        assertGt(vaultViewBps, RESERVE_CAP_BPS);

        _assertReason(_preview(A.AAPLC, buy), Reason.CONCENTRATION, "AAPLc to target, GOOGL stale, preview");
        Intent memory i = _intent(Action.BUY, A.AAPLC, buy);
        vm.expectEmit(address(vault));
        emit Decision(i.id, Action.BUY, A.AAPLC, buy, false, Reason.CONCENTRATION, RATIONALE);
        vm.prank(executor, executor);
        (bool allowed, Reason r) = vault.execute(i);
        assertFalse(allowed);
        _assertReason(r, Reason.CONCENTRATION, "AAPLc to target, GOOGL stale, execute");
        assertEq(IB20Asset(A.AAPLC).balanceOf(address(vault)), 0);

        // The stale token itself can be neither bought nor sold until its feed publishes again.
        _assertReason(_preview(A.GOOGLC, 1e6), Reason.FEED_STALE, "GOOGLc BUY, GOOGL stale");
        uint256 held = IB20Asset(A.GOOGLC).balanceOf(address(vault));
        _assertReason(
            vault.previewIntent(_intent(Action.SELL, A.GOOGLC, held)), Reason.FEED_STALE, "GOOGLc SELL"
        );
    }

    /// The same stale holding under the old 4,000 cap: the vault still prices GOOGLc at 0 and reads the AAPLc
    /// BUY above 25%, but under 40%, so it passes. The 2,500 cap is what makes the refusal above reachable.
    function test_staleHoldingUnderTheOldCapStillPasses() public {
        vm.warp(vm.getBlockTimestamp() + vault.TIMELOCK()); // the same clock as the capped test, no apply
        (uint256 buy, uint256 agentEquity, uint256 googlValue) = _holdGooglcThenAgeItsFeed();
        uint256 vaultViewBps = buy * BPS / (agentEquity - googlValue);
        assertGt(vaultViewBps, RESERVE_CAP_BPS);
        assertLt(vaultViewBps, 4000);
        _assertReason(_preview(A.AAPLC, buy), Reason.OK, "AAPLc to target, GOOGL stale, 4,000 cap");
    }

    // ------------------------------------------------------------------ helpers

    /// As the owner: queue the three changes the script prints, check an apply one second early reverts
    /// ChangeNotReady, then warp to the eta and apply them.
    function _queueAndApply() internal {
        QueueReserveCaps.Change[] memory c = script.changes(vault);
        uint256 timelock = vault.TIMELOCK();
        uint256 eta = vm.getBlockTimestamp() + timelock;
        vm.startPrank(owner);
        for (uint256 i; i < c.length; ++i) {
            vm.expectEmit(address(vault));
            emit TokenConfigChangeQueued(c[i].changeHash, eta, c[i].token, c[i].next);
            assertEq(vault.queueTokenConfig(c[i].token, c[i].next), c[i].changeHash);
        }
        vm.warp(eta - 1);
        for (uint256 i; i < c.length; ++i) {
            vm.expectRevert(
                abi.encodeWithSelector(MandateVault.ChangeNotReady.selector, c[i].changeHash, eta)
            );
            vault.applyTokenConfig(c[i].token, c[i].next);
        }
        vm.warp(eta);
        for (uint256 i; i < c.length; ++i) {
            vm.expectEmit(address(vault));
            emit TokenConfigApplied(c[i].token, c[i].next);
            vault.applyTokenConfig(c[i].token, c[i].next);
        }
        vm.stopPrank();
    }

    /// BUY GOOGLc to the agent's target, size an AAPLc BUY to the target the way the agent would, check it
    /// passes in the last second GOOGL's answer is fresh, then warp one second further so it is stale.
    /// The NVDA and AAPL answers stay fresh throughout (asserted), so only the GOOGLc holding is affected.
    function _holdGooglcThenAgeItsFeed()
        internal
        returns (uint256 buy, uint256 agentEquity, uint256 googlValue)
    {
        _assertReason(_buy(A.GOOGLC, _equity() * AGENT_TARGET_BPS / BPS), Reason.OK, "GOOGLc to target");
        agentEquity = _equity();
        googlValue = _value(A.GOOGLC);
        buy = agentEquity * AGENT_TARGET_BPS / BPS;

        uint256 maxStaleness = vault.mandate().maxStaleness;
        (,,, uint256 googlUpdatedAt,) = IAggregatorV3(A.GOOGL_FEED).latestRoundData();
        uint256 staleAt = googlUpdatedAt + maxStaleness + 1;

        vm.warp(staleAt - 1);
        assertEq(_age(A.GOOGL_FEED), maxStaleness);
        _assertReason(_preview(A.AAPLC, buy), Reason.OK, "AAPLc to target, last fresh second");

        vm.warp(staleAt);
        assertGt(_age(A.GOOGL_FEED), maxStaleness);
        assertLe(_age(A.NVDA_FEED), maxStaleness);
        assertLe(_age(A.AAPL_FEED), maxStaleness);
        // nothing else moved: the agent's equity (every holding at its last answer) is unchanged
        assertEq(_equity(), agentEquity);
    }

    function _intent(Action a, address token, uint256 amount) internal returns (Intent memory) {
        return Intent({
            id: keccak256(abi.encode("reserve-caps-fork", ++nonce)),
            action: a,
            token: token,
            amount: amount,
            minOut: 0,
            payee: address(0),
            rationaleHash: RATIONALE
        });
    }

    function _preview(address token, uint256 usdIn) internal returns (Reason) {
        return vault.previewIntent(_intent(Action.BUY, token, usdIn));
    }

    function _buy(address token, uint256 usdIn) internal returns (Reason r) {
        Intent memory i = _intent(Action.BUY, token, usdIn);
        vm.prank(executor, executor);
        (, r) = vault.execute(i);
    }

    function _price(address token) internal view returns (uint256) {
        (, address feed,,) = vault.tokenConfig(token);
        (, int256 answer,,,) = IAggregatorV3(feed).latestRoundData();
        return uint256(answer);
    }

    /// Same scaling as MandateVault._valueUsd: raw amount x 8-decimal price -> USDC (6 decimals).
    function _value(address token) internal view returns (uint256) {
        uint256 raw = IB20Asset(token).balanceOf(address(vault));
        return raw * _price(token) / 10 ** (uint256(IB20Asset(token).decimals()) + 2);
    }

    /// Equity with every holding at its feed's last answer, whatever its age: the agent's equityUsd6 (no credit
    /// position, checked in setUp). While all feeds are fresh it is also the vault's own total.
    function _equity() internal view returns (uint256 e) {
        e = usdc.balanceOf(address(vault));
        address[] memory toks = vault.tokens();
        for (uint256 i; i < toks.length; ++i) {
            e += _value(toks[i]);
        }
    }

    function _weightBps(address token) internal view returns (uint256) {
        return _value(token) * BPS / _equity();
    }

    /// The largest BUY of `token` the cap allows. MandateVault._weightAfterBuyBps rounds
    /// (value + usdIn) * BPS / equity down and refuses above RESERVE_CAP_BPS, so value + usdIn may reach
    /// ((RESERVE_CAP_BPS + 1) * equity - 1) / BPS. Valid while every feed is fresh.
    function _maxBuyUnderCap(address token) internal view returns (uint256) {
        return ((uint256(RESERVE_CAP_BPS) + 1) * _equity() - 1) / BPS - _value(token);
    }

    /// MandateVault._weightAfterBuyBps while every feed is fresh and nothing is supplied or borrowed.
    function _weightAfterBuyBps(address token, uint256 usdIn) internal view returns (uint256) {
        return (_value(token) + usdIn) * BPS / _equity();
    }

    function _age(address feed) internal view returns (uint256) {
        (,,, uint256 updatedAt,) = IAggregatorV3(feed).latestRoundData();
        return vm.getBlockTimestamp() - updatedAt;
    }

    function _assertReason(Reason got, Reason want, string memory what) internal pure {
        assertEq(uint8(got), uint8(want), what);
    }
}
