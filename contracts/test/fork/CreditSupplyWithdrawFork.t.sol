// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, Vm, console2} from "forge-std/Test.sol";
import {MandateVault} from "../../src/MandateVault.sol";
import {IMandateVaultEvents} from "../../src/IMandateVaultEvents.sol";
import {AaveV4CreditAdapter} from "../../src/adapters/AaveV4CreditAdapter.sol";
import {Action, Reason, Intent} from "../../src/Types.sol";
import {IAaveV4Spoke} from "../../src/interfaces/IAaveV4.sol";
import {IB20Asset} from "../../src/interfaces/IB20Asset.sol";
import {IERC20Minimal, IAggregatorV3} from "../../src/interfaces/IExternal.sol";
import {BaseAddresses as A} from "../../script/BaseAddresses.sol";

/// @notice The Aave V4 Hub views and error this test reads, as declared in aave/aave-v4 src/hub/Hub.sol and
/// src/hub/interfaces/IHub.sol. The test calls them on the deployed Equities Hub, so a mismatch fails it.
interface IAaveV4HubViews {
    struct SpokeConfig {
        uint40 addCap;
        uint40 drawCap;
        uint24 riskPremiumThreshold;
        bool active;
        bool halted;
    }

    struct AssetConfig {
        address feeReceiver;
        uint16 liquidityFee;
        address irStrategy;
        address reinvestmentController;
    }

    error InvalidAmount();

    function getSpokeConfig(uint256 assetId, address spoke) external view returns (SpokeConfig memory);
    function getSpokeAddedAssets(uint256 assetId, address spoke) external view returns (uint256);
    function getAddedAssets(uint256 assetId) external view returns (uint256);
    function getAssetLiquidity(uint256 assetId) external view returns (uint256);
    function previewAddByAssets(uint256 assetId, uint256 assets) external view returns (uint256);
    function getSpokeCount(uint256 assetId) external view returns (uint256);
    function getSpokeAddress(uint256 assetId, uint256 index) external view returns (address);
    function getAssetConfig(uint256 assetId) external view returns (AssetConfig memory);
    function getAssetSwept(uint256 assetId) external view returns (uint256);
}

/// @notice SUPPLY then WITHDRAW_COLLATERAL of $5 of NVDAc on the deployed Base mainnet vault, through its own
/// execute() and the deployed Aave V4 credit adapter, with the minimums the vault and the market enforce and the
/// gas of each step. Fork only: the executor is impersonated with `vm.prank`. The live mandate already names the
/// adapter, so the owner changes nothing on the fork: credit actions are off only in the agent, whose
/// MAAT_CREDIT_ACTIONS setting (agent/src/config.ts) must be "on" for it to suggest or send them.
/// The gas logged is a receipt's gasUsed for plain execute(intent) calldata: the agent's trailing rationale blob
/// and Builder Code suffix add calldata gas on top, and Base's L1 data fee is charged apart from gas.
/// To re-run it at another block, for example after the executor changes or the agent has traded, from contracts/
/// with BASE_RPC_URL set: CREDIT_FORK_BLOCK=<block> forge test --match-path test/fork/CreditSupplyWithdrawFork.t.sol
/// It acts as whatever executor() the vault names at that block, and it fails if anything is supplied there.
contract CreditSupplyWithdrawForkTest is Test {
    /// Records in deployments/README.md (deployed 2026-11-24).
    MandateVault internal constant VAULT = MandateVault(0x3F956072d18ddD20d5eFb74e9CCabf8Deade699b);
    AaveV4CreditAdapter internal constant ADAPTER =
        AaveV4CreditAdapter(0x45dEA6BBeD30c120794115FeC8b01C346564aB2C);
    /// executor() at FORK_BLOCK: the owner's wallet, before the switch to the CDP Server Wallet
    /// (deployments/README.md).
    address internal constant EXECUTOR_AT_FORK_BLOCK = 0x3c3a66f713DAE7e4A03Bbd81dB79FF65F42C1D6a;

    /// Wed 2026-11-25 15:22:01 UTC (10:22 ET, in session), read with `cast block-number` on a public RPC. The vault
    /// holds the 3,311,718 raw NVDAc of the owner's smoke-test BUY and nothing is supplied; the NVDA feed reads
    /// 144.33510181, so $5 is 3,464,160 raw. CREDIT_FORK_BLOCK replaces it.
    uint256 internal constant FORK_BLOCK = 62_148_729;
    uint256 internal constant SUPPLY_USD = 5e6;
    uint256 internal constant TOP_UP_USD = 1e6;
    /// agent/src/exec/calls.ts EXECUTE_GAS_FLOOR: the smallest gas limit the agent sends execute() with.
    uint256 internal constant AGENT_EXECUTE_GAS_FLOOR = 2_500_000;
    /// An address with no code: a call to it spends gas only as a transaction of its own (see _assertIsolated).
    address internal constant NO_CODE = address(uint160(uint256(keccak256("maat.credit-fork.no-code"))));

    /// executor() at the fork block, read in setUp.
    address internal executor;

    struct Decided {
        bool allowed;
        Reason reason;
        uint256 gasUsed;
    }

    struct Holdings {
        uint256 vaultStock;
        uint256 vaultUsdc;
        uint256 adapterStock;
        uint256 hubStock;
        uint256 supplied;
    }

    IB20Asset internal nvdac = IB20Asset(A.NVDAC);
    IAaveV4Spoke internal spoke = IAaveV4Spoke(A.AAVE_MAG7_SPOKE);

    function setUp() public {
        uint256 forkBlock = vm.envOr("CREDIT_FORK_BLOCK", FORK_BLOCK);
        vm.createSelectFork("base", forkBlock);
        executor = VAULT.executor();
        assertTrue(executor != address(0));
        if (forkBlock == FORK_BLOCK) assertEq(executor, EXECUTOR_AT_FORK_BLOCK);
        assertEq(VAULT.mandate().creditAdapter, address(ADAPTER));
        assertFalse(VAULT.paused());
        assertFalse(ADAPTER.hasPosition());
        console2.log(
            string.concat("fork block ", vm.toString(forkBlock), ", executor ", vm.toString(executor))
        );
    }

    /// forge-config: default.isolate = true
    function test_supplyThenWithdrawFiveDollarsOfNvdac() public {
        uint256 amount = _rawForUsd(SUPPLY_USD);
        // At FORK_BLOCK the owner's smoke-test BUY left less than $5 of NVDAc: SUPPLY of $5 is refused as is,
        if (nvdac.balanceOf(address(VAULT)) < amount) {
            vm.prank(executor, executor);
            assertEq(
                uint8(VAULT.previewIntent(_intent("b5-supply", Action.SUPPLY, amount))),
                uint8(Reason.INSUFFICIENT_BALANCE)
            );
            // so the executor buys $1 more first, through the same execute() path
            Decided memory b = _execute(_buy("b5-top-up", TOP_UP_USD));
            assertTrue(b.allowed);
        }
        assertGe(nvdac.balanceOf(address(VAULT)), amount);
        Holdings memory before = _holdings();
        uint256 spentBefore = VAULT.spentOnDay(VAULT.today());

        // SUPPLY: vault -> adapter -> hub, and the adapter's spoke position enables it as collateral
        Decided memory s = _execute(_intent("b5-supply", Action.SUPPLY, amount));
        assertTrue(s.allowed);
        assertEq(uint8(s.reason), uint8(Reason.OK));
        Holdings memory mid = _holdings();
        assertEq(mid.vaultStock, before.vaultStock - amount);
        assertEq(mid.vaultUsdc, before.vaultUsdc);
        assertEq(mid.hubStock, before.hubStock + amount);
        assertEq(mid.adapterStock, 0); // the adapter never rests stock: the hub holds it
        assertEq(mid.supplied, amount);
        assertEq(spoke.getUserSuppliedAssets(A.AAVE_RESERVE_NVDAC, address(ADAPTER)), amount);
        (bool collateral, bool borrowing) = spoke.getUserReserveStatus(A.AAVE_RESERVE_NVDAC, address(ADAPTER));
        assertTrue(collateral);
        assertFalse(borrowing);
        assertEq(ADAPTER.debt(), 0);
        assertEq(ADAPTER.healthFactor(), type(uint256).max);
        assertTrue(ADAPTER.hasPosition());
        assertEq(IERC20Minimal(A.NVDAC).allowance(address(VAULT), address(ADAPTER)), 0);
        assertEq(VAULT.spentOnDay(VAULT.today()), spentBefore); // credit actions are not capped trades

        // Supplied stock is not in the vault's wallet, so it cannot be sold until it is withdrawn.
        vm.prank(executor, executor);
        assertEq(
            uint8(VAULT.previewIntent(_intent("b5-sell", Action.SELL, amount))),
            uint8(Reason.INSUFFICIENT_BALANCE)
        );

        // WITHDRAW_COLLATERAL of everything supplied: hub -> adapter -> vault, with no debt open
        Decided memory w = _execute(_intent("b5-withdraw", Action.WITHDRAW_COLLATERAL, mid.supplied));
        assertTrue(w.allowed);
        assertEq(uint8(w.reason), uint8(Reason.OK));
        Holdings memory last = _holdings();
        assertEq(last.vaultStock, before.vaultStock);
        assertEq(last.vaultUsdc, before.vaultUsdc);
        assertEq(last.hubStock, before.hubStock);
        assertEq(last.adapterStock, 0);
        assertEq(last.supplied, 0);
        assertFalse(ADAPTER.hasPosition());
        assertEq(VAULT.spentOnDay(VAULT.today()), spentBefore);

        // Both fit in the agent's execute gas limit floor (_execute checks that the figures are isolated).
        assertLt(s.gasUsed, AGENT_EXECUTE_GAS_FLOOR);
        assertLt(w.gasUsed, AGENT_EXECUTE_GAS_FLOOR);
    }

    /// The smallest SUPPLY is one raw unit (1e-8 NVDAc): the vault refuses 0, and the hub turns 1 unit into 1 share.
    /// forge-config: default.isolate = true
    function test_minimumSupplyAndWithdrawIsOneRawUnit() public {
        uint256 held = nvdac.balanceOf(address(VAULT));
        uint256 hubBefore = nvdac.balanceOf(A.AAVE_EQUITIES_HUB);

        // just below the minimum: the vault refuses an amount of 0 before the adapter is called
        Decided memory zero = _execute(_intent("b5-supply-0", Action.SUPPLY, 0));
        assertFalse(zero.allowed);
        assertEq(uint8(zero.reason), uint8(Reason.INSUFFICIENT_BALANCE));
        assertEq(nvdac.balanceOf(address(VAULT)), held);
        assertEq(ADAPTER.suppliedOf(A.NVDAC), 0);
        // the adapter passes amounts through unchecked, and the hub refuses 0 itself
        vm.prank(address(VAULT));
        vm.expectRevert(IAaveV4HubViews.InvalidAmount.selector);
        ADAPTER.supply(A.NVDAC, 0);
        // one raw unit is worth one share, so the hub's `shares > 0` check passes at the minimum
        assertEq(IAaveV4HubViews(A.AAVE_EQUITIES_HUB).previewAddByAssets(A.AAVE_RESERVE_NVDAC, 1), 1);

        Decided memory one = _execute(_intent("b5-supply-1", Action.SUPPLY, 1));
        assertTrue(one.allowed);
        assertEq(ADAPTER.suppliedOf(A.NVDAC), 1);
        assertEq(nvdac.balanceOf(A.AAVE_EQUITIES_HUB), hubBefore + 1);

        // WITHDRAW_COLLATERAL needs 0 < amount <= supplied
        Decided memory w0 = _execute(_intent("b5-withdraw-0", Action.WITHDRAW_COLLATERAL, 0));
        assertEq(uint8(w0.reason), uint8(Reason.INSUFFICIENT_BALANCE));
        Decided memory w2 = _execute(_intent("b5-withdraw-2", Action.WITHDRAW_COLLATERAL, 2));
        assertEq(uint8(w2.reason), uint8(Reason.INSUFFICIENT_BALANCE));
        Decided memory w1 = _execute(_intent("b5-withdraw-1", Action.WITHDRAW_COLLATERAL, 1));
        assertTrue(w1.allowed);
        assertEq(nvdac.balanceOf(address(VAULT)), held);
        assertEq(nvdac.balanceOf(A.AAVE_EQUITIES_HUB), hubBefore);
        assertFalse(ADAPTER.hasPosition());
    }

    /// What the market allows at the fork block: the reserve and the spoke are open, there is room under the add
    /// cap, and nothing but a withdrawal can take NVDAc out of the hub, so a withdrawal cannot run short. In
    /// aave/aave-v4 a3ef63ea Hub.sol an asset's liquidity falls only in remove(), draw() and sweep(). draw() needs a
    /// spoke of the asset with a drawCap above 0 (on the MAG7 spoke, also the borrowable flag), and sweep() needs
    /// the asset's reinvestment controller. Either would let remove() revert with InsufficientLiquidity, and the
    /// vault would then return CREDIT_FAILED for a WITHDRAW_COLLATERAL.
    function test_marketLimitsAtTheForkBlock() public view {
        IAaveV4HubViews hub = IAaveV4HubViews(A.AAVE_EQUITIES_HUB);
        IAaveV4Spoke.Reserve memory r = spoke.getReserve(A.AAVE_RESERVE_NVDAC);
        assertEq(r.underlying, A.NVDAC);
        assertEq(r.hub, A.AAVE_EQUITIES_HUB);
        assertEq(r.decimals, 8);
        // ReserveFlagsMap: paused 0x01 and frozen 0x02 block supply, paused blocks withdraw; 0x04 is borrowable
        assertEq(r.flags & 0x01, 0);
        assertEq(r.flags & 0x02, 0);
        assertEq(r.flags & 0x04, 0);

        IAaveV4HubViews.SpokeConfig memory c = hub.getSpokeConfig(r.assetId, A.AAVE_MAG7_SPOKE);
        assertTrue(c.active);
        assertFalse(c.halted);
        uint256 cap = uint256(c.addCap) * 10 ** r.decimals;
        uint256 added = hub.getSpokeAddedAssets(r.assetId, A.AAVE_MAG7_SPOKE);
        assertGt(cap, added + _rawForUsd(SUPPLY_USD));
        assertEq(hub.getAssetLiquidity(r.assetId), hub.getAddedAssets(r.assetId));

        // No spoke of the asset can draw it, and no reinvestment controller can sweep it.
        uint256 spokes = hub.getSpokeCount(r.assetId);
        for (uint256 k; k < spokes; ++k) {
            address s = hub.getSpokeAddress(r.assetId, k);
            assertEq(hub.getSpokeConfig(r.assetId, s).drawCap, 0, "a spoke can draw NVDAc from the hub");
        }
        assertEq(hub.getAssetConfig(r.assetId).reinvestmentController, address(0), "NVDAc can be swept");
        assertEq(hub.getAssetSwept(r.assetId), 0);
        console2.log(string.concat("NVDAc spokes at the hub ", vm.toString(spokes), ", all with drawCap 0"));
        console2.log(
            string.concat(
                "MAG7 spoke NVDAc add cap ",
                vm.toString(uint256(c.addCap)),
                " NVDAc; added ",
                vm.toString(added),
                " raw; room ",
                vm.toString(cap - added),
                " raw; $5 is ",
                vm.toString(_rawForUsd(SUPPLY_USD)),
                " raw"
            )
        );
    }

    /// SUPPLY adds collateral and WITHDRAW_COLLATERAL with no debt takes no risk, so both run while NYSE is closed:
    /// the stock can always come home while nothing is borrowed.
    /// forge-config: default.isolate = true
    function test_supplyAndWithdrawWhileTheMarketIsClosed() public {
        uint256 held = nvdac.balanceOf(address(VAULT));
        uint256 saturday = _nextSaturday1800Utc();
        console2.log(string.concat("warped to ", vm.toString(saturday), " (a Saturday, 18:00 UTC)"));
        vm.warp(saturday);
        vm.prank(executor, executor);
        assertEq(uint8(VAULT.previewIntent(_buy("b5-closed-buy", TOP_UP_USD))), uint8(Reason.MARKET_CLOSED));

        Decided memory s = _execute(_intent("b5-closed-supply", Action.SUPPLY, held));
        assertTrue(s.allowed);
        assertEq(ADAPTER.suppliedOf(A.NVDAC), held);
        assertEq(nvdac.balanceOf(address(VAULT)), 0);
        Decided memory w = _execute(_intent("b5-closed-withdraw", Action.WITHDRAW_COLLATERAL, held));
        assertTrue(w.allowed);
        assertEq(nvdac.balanceOf(address(VAULT)), held);
        assertFalse(ADAPTER.hasPosition());
    }

    // ------------------------------------------------------------------ helpers

    function _holdings() internal view returns (Holdings memory h) {
        h.vaultStock = nvdac.balanceOf(address(VAULT));
        h.vaultUsdc = IERC20Minimal(A.USDC).balanceOf(address(VAULT));
        h.adapterStock = nvdac.balanceOf(address(ADAPTER));
        h.hubStock = nvdac.balanceOf(A.AAVE_EQUITIES_HUB);
        h.supplied = ADAPTER.suppliedOf(A.NVDAC);
    }

    /// USD (6 decimals) to raw NVDAc at the Chainlink price, the conversion execute() uses for a BUY's floor.
    function _rawForUsd(uint256 usd6) internal view returns (uint256) {
        (, int256 answer,,,) = IAggregatorV3(A.NVDA_FEED).latestRoundData();
        return usd6 * 10 ** (uint256(nvdac.decimals()) + 2) / uint256(answer);
    }

    function _buy(string memory salt, uint256 usd6) internal pure returns (Intent memory i) {
        i = _intent(salt, Action.BUY, usd6);
    }

    function _intent(string memory salt, Action action, uint256 amount)
        internal
        pure
        returns (Intent memory)
    {
        return Intent({
            id: keccak256(bytes(salt)),
            action: action,
            token: A.NVDAC,
            amount: amount,
            minOut: 0,
            payee: address(0),
            rationaleHash: keccak256(bytes(salt))
        });
    }

    /// The first Saturday 18:00 UTC after the fork block (Sat 2026-11-28 at FORK_BLOCK), when NYSE is closed.
    function _nextSaturday1800Utc() internal view returns (uint256 t) {
        uint256 day = block.timestamp / 1 days;
        // 1970-01-01, day 0, was a Thursday, so (day + 4) % 7 is 0 on a Sunday and 6 on a Saturday.
        t = (day + (13 - (day + 4) % 7) % 7) * 1 days + 18 hours;
        if (t <= block.timestamp) t += 7 days;
    }

    /// A call to an account with no code spends no gas in its own frame, unless forge runs it as a transaction of
    /// its own (isolation), which pays the 21,000 intrinsic gas. So this fails when the figures are not isolated.
    function _assertIsolated() internal {
        assertEq(NO_CODE.code.length, 0);
        (bool ok,) = NO_CODE.call("");
        assertTrue(ok);
        assertEq(vm.lastFrameGas().gasTotalUsed, 21_000, "gas is not measured under isolation");
    }

    /// Previews, then executes as the executor; the one Decision must match the preview and the return values.
    function _execute(Intent memory i) internal returns (Decided memory d) {
        _assertIsolated();
        vm.prank(executor, executor);
        Reason previewed = VAULT.previewIntent(i);
        vm.recordLogs();
        vm.prank(executor, executor);
        (bool allowed, Reason reason) = VAULT.execute(i);
        Vm.Gas memory g = vm.lastFrameGas();
        d = _onlyDecision(vm.getRecordedLogs(), i);
        assertEq(d.allowed, allowed);
        assertEq(uint8(d.reason), uint8(reason));
        assertEq(uint8(d.reason), uint8(previewed));
        d.gasUsed = _receiptGas(g);
        console2.log(
            string.concat(
                _name(i.action),
                " ",
                vm.toString(i.amount),
                ": reason ",
                vm.toString(uint256(d.reason)),
                ", gas spent ",
                vm.toString(uint256(g.gasTotalUsed)),
                ", refund ",
                vm.toString(int256(g.gasRefunded)),
                ", receipt gasUsed ",
                vm.toString(d.gasUsed)
            )
        );
    }

    /// The gas a receipt shows for the call: gas spent minus the refund, which EIP-3529 caps at a fifth of it.
    /// Under isolation (forge-config above each test) the spent gas includes the intrinsic and calldata gas.
    function _receiptGas(Vm.Gas memory g) internal pure returns (uint256) {
        assertEq(g.gasStateUsed, 0);
        uint256 spent = g.gasTotalUsed;
        uint256 refund = g.gasRefunded > 0 ? uint256(uint64(g.gasRefunded)) : 0;
        if (refund > spent / 5) refund = spent / 5;
        return spent - refund;
    }

    function _name(Action a) internal pure returns (string memory) {
        if (a == Action.BUY) return "BUY";
        if (a == Action.SUPPLY) return "SUPPLY";
        if (a == Action.WITHDRAW_COLLATERAL) return "WITHDRAW_COLLATERAL";
        return "other";
    }

    function _onlyDecision(Vm.Log[] memory logs, Intent memory i) internal pure returns (Decided memory d) {
        uint256 found;
        for (uint256 k; k < logs.length; ++k) {
            Vm.Log memory e = logs[k];
            if (e.emitter != address(VAULT) || e.topics.length == 0) continue;
            if (e.topics[0] != IMandateVaultEvents.Decision.selector) continue;
            ++found;
            assertEq(e.topics[1], i.id);
            assertEq(address(uint160(uint256(e.topics[2]))), i.token);
            (Action action, uint256 amount, bool allowed, Reason reason, bytes32 rh) =
                abi.decode(e.data, (Action, uint256, bool, Reason, bytes32));
            assertEq(uint8(action), uint8(i.action));
            assertEq(amount, i.amount);
            assertEq(rh, i.rationaleHash);
            d = Decided(allowed, reason, 0);
        }
        assertEq(found, 1, "expected exactly one Decision");
    }
}
