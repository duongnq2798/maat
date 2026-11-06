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

contract GuardHarness {
    function check(GuardLib.MarketCheck memory c) external view returns (Reason, uint256) {
        return GuardLib.checkMarket(c);
    }
}

contract GuardLibTest is Test {
    uint256 internal constant THU_1030_ET = 1793892600;
    address internal constant VAULT = address(0xA11CE);
    address internal constant ADAPTER = address(0xADA);

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
}

