// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {GuardLib} from "../src/GuardLib.sol";
import {MarketCalendar} from "../src/MarketCalendar.sol";
import {Reason, SessionMode} from "../src/Types.sol";
import {B20Constants} from "../src/interfaces/IB20Asset.sol";
import {MockB20} from "./mocks/MockB20.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockFeed} from "./mocks/MockFeed.sol";
import {MockPool} from "./mocks/MockPool.sol";
import {MockPolicyRegistry} from "./mocks/MockPolicyRegistry.sol";
import {MockReverter} from "./mocks/MockReverter.sol";

contract GuardHarness {
    function check(GuardLib.MarketCheck memory c) external view returns (Reason, uint256) {
        return GuardLib.checkMarket(c);
    }

    function collateral(GuardLib.CollateralCheck memory c) external view returns (Reason) {
        return GuardLib.collateralHealthy(c);
    }

    function open(address calendar, SessionMode mode) external view returns (bool) {
        return GuardLib.marketOpen(calendar, mode);
    }

    function paused(address token) external view returns (bool) {
        return GuardLib.tokenPaused(token);
    }

    function transferable(
        address token,
        address registry,
        address[] memory senders,
        address[] memory receivers,
        address[] memory executors
    ) external view returns (bool) {
        return GuardLib.transferable(token, registry, senders, receivers, executors);
    }
}

contract GuardLibTest is Test {
    uint256 internal constant THU_1030_ET = 1793892600;
    uint256 internal constant SAT_1800_UTC = 1793469600;
    address internal constant HUB = address(0x4B);
    address internal constant SPOKE = address(0x5B);
    address internal constant VAULT = address(0xA11CE);
    address internal constant ADAPTER = address(0xADA);
    address internal constant ORIGIN = address(0x0816);

    uint64 internal nextPolicyId = 100;

    GuardHarness internal h;
    MockB20 internal nvda;
    MockFeed internal feed;
    MockPool internal pool;
    MockPolicyRegistry internal registry;
    MarketCalendar internal calendar;

    function setUp() public {
        vm.warp(THU_1030_ET);
        h = new GuardHarness();
        nvda = new MockB20("NVDAc");
        MockERC20 usdc = new MockERC20("USDC", 6);
        feed = new MockFeed(200e8);
        pool = new MockPool(address(usdc), address(nvda));
        pool.setTick(-6932, 1800);
        registry = new MockPolicyRegistry();
        calendar = new MarketCalendar(address(this));
    }

    function _c() internal view returns (GuardLib.MarketCheck memory c) {
        c = GuardLib.MarketCheck({
            token: address(nvda),
            feed: address(feed),
            pool: address(pool),
            calendar: address(calendar),
            registry: address(registry),
            vault: VAULT,
            adapter: ADAPTER,
            isBuy: true,
            sessionMode: SessionMode.REGULAR,
            maxStaleness: 3600,
            twapWindow: 1800,
            maxPremiumBps: 50,
            multiplierCooldown: 1 days,
            lastMultiplier: 1e18,
            multiplierChangedAt: 0
        });
    }

    function _expect(GuardLib.MarketCheck memory c, Reason want) internal view {
        (Reason got,) = h.check(c);
        assertEq(uint8(got), uint8(want));
    }

    function test_okReturnsOraclePrice() public view {
        (Reason r, uint256 p) = h.check(_c());
        assertEq(uint8(r), uint8(Reason.OK));
        assertEq(p, 200e8);
    }

    function test_paused() public {
        nvda.setPaused(B20Constants.FEATURE_TRANSFER, true);
        _expect(_c(), Reason.TOKEN_PAUSED);
    }

    function test_pauseIsCheckedBeforeMarketHours() public {
        nvda.setPaused(B20Constants.FEATURE_TRANSFER, true);
        vm.warp(1793469600); // Saturday
        _expect(_c(), Reason.TOKEN_PAUSED);
    }

    function test_policyBlocksVaultAsReceiver() public {
        nvda.setPolicyId(B20Constants.TRANSFER_RECEIVER_POLICY, 7);
        _expect(_c(), Reason.POLICY_BLOCKED);
        registry.setAuthorized(7, VAULT, true);
        _expect(_c(), Reason.OK);
    }

    function test_policyOnSellChecksAdapterAndPool() public {
        GuardLib.MarketCheck memory c = _c();
        c.isBuy = false;
        nvda.setPolicyId(B20Constants.TRANSFER_RECEIVER_POLICY, 9);
        registry.setAuthorized(9, ADAPTER, true);
        _expect(c, Reason.POLICY_BLOCKED); // pool not authorized as receiver
        registry.setAuthorized(9, address(pool), true);
        _expect(c, Reason.OK);
    }

    function test_marketClosed() public {
        vm.warp(1793469600);
        feed.set(200e8, block.timestamp);
        _expect(_c(), Reason.MARKET_CLOSED);
    }

    function test_feedStaleAndBad() public {
        feed.set(200e8, block.timestamp - 3601);
        _expect(_c(), Reason.FEED_STALE);
        feed.set(0, block.timestamp);
        _expect(_c(), Reason.BAD_PRICE);
    }

    function test_multiplierRules() public {
        GuardLib.MarketCheck memory c = _c();
        nvda.setUiMultiplier(1.01e18); // differs from lastMultiplier (legacy path, no effectiveAt)
        _expect(c, Reason.MULTIPLIER_COOLDOWN);

        c.lastMultiplier = 1.01e18;
        c.multiplierChangedAt = block.timestamp - 1 hours;
        _expect(c, Reason.MULTIPLIER_COOLDOWN);
        c.multiplierChangedAt = block.timestamp - 25 hours;
        _expect(c, Reason.OK);

        nvda.setEffectiveAt(block.timestamp + 1 hours); // pending update
        _expect(c, Reason.MULTIPLIER_COOLDOWN);
        nvda.setEffectiveAt(block.timestamp - 1 hours); // just flipped
        _expect(c, Reason.MULTIPLIER_COOLDOWN);
        nvda.setEffectiveAt(block.timestamp - 25 hours);
        _expect(c, Reason.OK);
    }

    function test_premiumTooHigh() public {
        pool.setTick(-7932, 1800); // ~ $221 vs $200 oracle
        _expect(_c(), Reason.PREMIUM_TOO_HIGH);
    }

    // ---------------------------------------------------------------- fail-closed on reverting deps

    function test_revertingIsPausedFailsClosed() public {
        nvda.setReverts(true, false, false, false);
        _expect(_c(), Reason.TOKEN_PAUSED);
    }

    function test_revertingPolicyIdFailsClosed() public {
        nvda.setReverts(false, true, false, false);
        _expect(_c(), Reason.POLICY_BLOCKED);
        GuardLib.MarketCheck memory c = _c();
        c.isBuy = false;
        _expect(c, Reason.POLICY_BLOCKED);
    }

    function test_revertingIsAuthorizedFailsClosed() public {
        nvda.setPolicyId(B20Constants.TRANSFER_RECEIVER_POLICY, 7);
        registry.setAuthorized(7, VAULT, true);
        _expect(_c(), Reason.OK);
        registry.setRevertIsAuthorized(true);
        _expect(_c(), Reason.POLICY_BLOCKED);
    }

    function test_revertingCalendarFailsClosed() public {
        GuardLib.MarketCheck memory c = _c();
        c.calendar = address(new MockReverter());
        _expect(c, Reason.MARKET_CLOSED);
    }

    function test_revertingUiMultiplierFailsClosed() public {
        nvda.setReverts(false, false, true, false);
        _expect(_c(), Reason.MULTIPLIER_COOLDOWN);
    }

    function test_revertingEffectiveAtFailsClosed() public {
        nvda.setReverts(false, false, false, true);
        _expect(_c(), Reason.MULTIPLIER_COOLDOWN);
    }

    // ---------------------------------------------------------------- policy scope legs
    // For each leg: authorize every other leg of the scope, expect POLICY_BLOCKED, then authorize the
    // leg under test and expect OK. Removing any leg from transferPathAuthorized fails the matching test.

    function _leg(bool isBuy, bytes32 scope, address[] memory legs, uint256 missing) internal {
        GuardLib.MarketCheck memory c = _c();
        c.isBuy = isBuy;
        uint64 id = ++nextPolicyId;
        nvda.setPolicyId(scope, id);
        for (uint256 i; i < legs.length; i++) {
            if (i != missing) registry.setAuthorized(id, legs[i], true);
        }
        vm.startPrank(address(this), ORIGIN);
        _expect(c, Reason.POLICY_BLOCKED);
        vm.stopPrank();
        registry.setAuthorized(id, legs[missing], true);
        vm.startPrank(address(this), ORIGIN);
        _expect(c, Reason.OK);
        vm.stopPrank();
    }

    function _two(address a, address b) internal pure returns (address[] memory l) {
        l = new address[](2);
        l[0] = a;
        l[1] = b;
    }

    function _one(address a) internal pure returns (address[] memory l) {
        l = new address[](1);
        l[0] = a;
    }

    function test_buySenderPool() public {
        _leg(true, B20Constants.TRANSFER_SENDER_POLICY, _one(address(pool)), 0);
    }

    function test_buyReceiverVault() public {
        _leg(true, B20Constants.TRANSFER_RECEIVER_POLICY, _one(VAULT), 0);
    }

    function test_buyExecutorPool() public {
        _leg(true, B20Constants.TRANSFER_EXECUTOR_POLICY, _two(address(pool), ORIGIN), 0);
    }

    function test_buyExecutorTxOrigin() public {
        _leg(true, B20Constants.TRANSFER_EXECUTOR_POLICY, _two(address(pool), ORIGIN), 1);
    }

    function test_sellSenderVault() public {
        _leg(false, B20Constants.TRANSFER_SENDER_POLICY, _two(VAULT, ADAPTER), 0);
    }

    function test_sellSenderAdapter() public {
        _leg(false, B20Constants.TRANSFER_SENDER_POLICY, _two(VAULT, ADAPTER), 1);
    }

    function test_sellReceiverAdapter() public {
        _leg(false, B20Constants.TRANSFER_RECEIVER_POLICY, _two(ADAPTER, address(pool)), 0);
    }

    function test_sellReceiverPool() public {
        _leg(false, B20Constants.TRANSFER_RECEIVER_POLICY, _two(ADAPTER, address(pool)), 1);
    }

    function test_sellExecutorAdapter() public {
        _leg(false, B20Constants.TRANSFER_EXECUTOR_POLICY, _two(ADAPTER, ORIGIN), 0);
    }

    function test_sellExecutorTxOrigin() public {
        _leg(false, B20Constants.TRANSFER_EXECUTOR_POLICY, _two(ADAPTER, ORIGIN), 1);
    }

    function test_policyIdZeroIsAlwaysAllowed() public view {
        // all scopes default to policyId 0 and nobody is authorized in the registry
        _expect(_c(), Reason.OK);
        GuardLib.MarketCheck memory c = _c();
        c.isBuy = false;
        _expect(c, Reason.OK);
    }

    // ------------------------------------------------------------------ credit helpers (Plan 2A)

    function _cc() internal view returns (GuardLib.CollateralCheck memory) {
        return GuardLib.CollateralCheck({
            token: address(nvda),
            feed: address(feed),
            maxStaleness: 3600,
            multiplierCooldown: 1 days,
            lastMultiplier: 1e18,
            multiplierChangedAt: 0
        });
    }

    function _expectCollateral(GuardLib.CollateralCheck memory c, Reason want) internal view {
        assertEq(uint8(h.collateral(c)), uint8(want));
    }

    function test_collateralHealthy() public view {
        _expectCollateral(_cc(), Reason.OK);
    }

    function test_collateralPaused() public {
        nvda.setPaused(B20Constants.FEATURE_TRANSFER, true);
        _expectCollateral(_cc(), Reason.TOKEN_PAUSED);
    }

    function test_collateralPauseReadFailsClosed() public {
        nvda.setReverts(true, false, false, false);
        _expectCollateral(_cc(), Reason.TOKEN_PAUSED);
        assertTrue(h.paused(address(nvda)));
    }

    function test_collateralFeedWithoutCodeIsBadPrice() public view {
        GuardLib.CollateralCheck memory c = _cc();
        c.feed = address(0);
        _expectCollateral(c, Reason.BAD_PRICE);
    }

    function test_collateralNegativePriceIsBadPrice() public {
        feed.set(-1, THU_1030_ET);
        _expectCollateral(_cc(), Reason.BAD_PRICE);
    }

    function test_collateralStaleFeed() public {
        feed.set(200e8, THU_1030_ET - 3601);
        _expectCollateral(_cc(), Reason.FEED_STALE);
    }

    function test_collateralMultiplierChange() public {
        nvda.setUiMultiplier(2e18);
        _expectCollateral(_cc(), Reason.MULTIPLIER_COOLDOWN);
    }

    function test_collateralIgnoresMarketHours() public {
        vm.warp(SAT_1800_UTC);
        feed.set(200e8, SAT_1800_UTC);
        _expectCollateral(_cc(), Reason.OK);
    }

    function test_marketOpenInSession() public view {
        assertTrue(h.open(address(calendar), SessionMode.REGULAR));
    }

    function test_marketClosedOnSaturday() public {
        vm.warp(SAT_1800_UTC);
        assertFalse(h.open(address(calendar), SessionMode.REGULAR));
        assertFalse(h.open(address(calendar), SessionMode.FEED_24_5));
    }

    function test_revertingCalendarCountsAsClosed() public {
        assertFalse(h.open(address(new MockReverter()), SessionMode.REGULAR));
    }

    function test_tokenNotPaused() public view {
        assertFalse(h.paused(address(nvda)));
    }

    /// @dev Policy for `scope` that authorizes every account in this test except `blocked`.
    function _blockOnly(bytes32 scope, address blocked) internal {
        uint64 id = nextPolicyId++;
        nvda.setPolicyId(scope, id);
        address[5] memory all = [VAULT, ADAPTER, HUB, SPOKE, ORIGIN];
        for (uint256 i; i < all.length; ++i) {
            registry.setAuthorized(id, all[i], all[i] != blocked);
        }
    }

    /// @dev Supply-shaped path: vault -> adapter -> hub, pulled by the adapter then the spoke.
    function _transferable() internal returns (bool) {
        address[] memory s = new address[](2);
        s[0] = VAULT;
        s[1] = ADAPTER;
        address[] memory r = new address[](2);
        r[0] = ADAPTER;
        r[1] = HUB;
        address[] memory e = new address[](2);
        e[0] = ADAPTER;
        e[1] = SPOKE;
        vm.prank(address(this), ORIGIN);
        return h.transferable(address(nvda), address(registry), s, r, e);
    }

    function test_transferableWhenEveryLegIsAllowed() public {
        assertTrue(_transferable());
    }

    function test_transferableBlockedSender() public {
        _blockOnly(B20Constants.TRANSFER_SENDER_POLICY, ADAPTER);
        assertFalse(_transferable());
    }

    function test_transferableBlockedReceiver() public {
        _blockOnly(B20Constants.TRANSFER_RECEIVER_POLICY, HUB);
        assertFalse(_transferable());
    }

    function test_transferableBlockedExecutor() public {
        _blockOnly(B20Constants.TRANSFER_EXECUTOR_POLICY, SPOKE);
        assertFalse(_transferable());
    }

    function test_transferableChecksTxOrigin() public {
        _blockOnly(B20Constants.TRANSFER_EXECUTOR_POLICY, ORIGIN);
        assertFalse(_transferable());
    }

    function test_transferablePolicyReadFailsClosed() public {
        nvda.setReverts(false, true, false, false);
        assertFalse(_transferable());
    }
}
