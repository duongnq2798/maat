// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MandateVault} from "../../src/MandateVault.sol";
import {MarketCalendar} from "../../src/MarketCalendar.sol";
import {IMandateVaultEvents} from "../../src/IMandateVaultEvents.sol";
import {Action, Reason, SessionMode, Intent, Mandate, TokenConfig} from "../../src/Types.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockB20} from "../mocks/MockB20.sol";
import {MockFeed} from "../mocks/MockFeed.sol";
import {MockPool} from "../mocks/MockPool.sol";
import {MockPolicyRegistry} from "../mocks/MockPolicyRegistry.sol";
import {MockSwapAdapter} from "../mocks/MockSwapAdapter.sol";

abstract contract VaultFixture is Test, IMandateVaultEvents {
    uint256 internal constant THU_1030_ET = 1793892600; // Thu 2026-11-05 15:30 UTC
    uint256 internal constant SAT_1300_ET = 1793469600; // Sat 2026-10-31 18:00 UTC

    address internal owner = makeAddr("owner");
    address internal executor = makeAddr("executor");
    address internal payee = makeAddr("payee");

    MockERC20 internal usdc;
    MockB20 internal nvda;
    MockFeed internal feed;
    MockPool internal pool;
    MockSwapAdapter internal adapter;
    MockPolicyRegistry internal registry;
    MarketCalendar internal calendar;
    MandateVault internal vault;
    uint256 internal nonce;

    function setUp() public virtual {
        vm.warp(THU_1030_ET);
        usdc = new MockERC20("USDC", 6);
        nvda = new MockB20("NVDAc");
        feed = new MockFeed(200e8);
        pool = new MockPool(address(usdc), address(nvda));
        pool.setTick(-6932, 1800); // ~ $200.0036
        adapter = new MockSwapAdapter();
        usdc.mint(address(adapter), 1_000_000e6);
        nvda.mint(address(adapter), 1_000e8);
        registry = new MockPolicyRegistry();
        calendar = new MarketCalendar(owner);

        vault = _deployVault(defaultMandate());
        usdc.mint(address(vault), 200e6);
        vault.notifyRevenue(); // baseline recordedUsdc = 200e6
    }

    /// @dev The fixture's one-token (NVDAc) vault with one payee, under mandate `m`.
    function _deployVault(Mandate memory m) internal returns (MandateVault) {
        address[] memory toks = new address[](1);
        toks[0] = address(nvda);
        TokenConfig[] memory cfgs = new TokenConfig[](1);
        cfgs[0] = TokenConfig({allowed: true, feed: address(feed), pool: address(pool), maxWeightBps: 4000});
        address[] memory payees = new address[](1);
        payees[0] = payee;
        return new MandateVault(owner, executor, address(usdc), address(registry), m, toks, cfgs, payees);
    }

    function defaultMandate() internal view returns (Mandate memory) {
        return Mandate({
            sessionMode: SessionMode.REGULAR,
            maxPremiumBps: 50,
            maxSlippageBps: 100,
            maxStaleness: 3600,
            multiplierCooldown: 1 days,
            twapWindow: 1800,
            perTradeCapUsd: 50e6,
            dailyCapUsd: 100e6,
            calendar: address(calendar),
            swapAdapter: address(adapter),
            creditAdapter: address(0),
            minHealthFactor: 0,
            targetHealthFactor: 0,
            deriskWindow: 0
        });
    }

    function _intent(Action a, uint256 amount) internal returns (Intent memory) {
        return Intent({
            id: keccak256(abi.encode(++nonce)),
            action: a,
            token: address(nvda),
            amount: amount,
            minOut: 0,
            payee: address(0),
            rationaleHash: keccak256("rationale")
        });
    }

    function _exec(Intent memory i) internal returns (bool allowed, Reason reason) {
        vm.prank(executor, executor);
        return vault.execute(i);
    }

    function _assertReason(Reason got, Reason want) internal pure {
        assertEq(uint8(got), uint8(want));
    }

    // ---------------------------------------------------------------- typed timelock helpers

    function _queueMandateAndWait(Mandate memory m) internal {
        vm.prank(owner);
        vault.queueMandate(m);
        vm.warp(vm.getBlockTimestamp() + 24 hours); // via_ir may cache block.timestamp across warps
    }

    function _queueTokenAndWait(address token, TokenConfig memory c) internal {
        vm.prank(owner);
        vault.queueTokenConfig(token, c);
        vm.warp(vm.getBlockTimestamp() + 24 hours); // via_ir may cache block.timestamp across warps
    }

    function _queuePayeeAndWait(address p, bool allowed) internal {
        vm.prank(owner);
        vault.queuePayee(p, allowed);
        vm.warp(vm.getBlockTimestamp() + 24 hours); // via_ir may cache block.timestamp across warps
    }
}
