// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Reason, SessionMode} from "./Types.sol";
import {MarketCalendar} from "./MarketCalendar.sol";
import {PriceLib} from "./lib/PriceLib.sol";
import {IB20Asset, IPolicyRegistry, B20Constants} from "./interfaces/IB20Asset.sol";

/// @notice Market-safety checks for one B20 trade. Pure function of onchain state plus the caller's
/// multiplier bookkeeping, so the vault and the off-chain Guard Service agree on every verdict.
/// @dev Fail-closed: a dependency that reverts (token, policy registry, calendar) yields a rejecting
/// Reason instead of bubbling the revert. try/catch does not cover calls to addresses without code
/// (Solidity's extcodesize check reverts in the caller), so token/registry/calendar/feed/pool must be
/// validated as contracts at config time (vault task), not here.
library GuardLib {
    struct MarketCheck {
        address token;
        address feed;
        address pool;
        address calendar;
        address registry;
        address vault;
        address adapter;
        bool isBuy;
        SessionMode sessionMode;
        uint32 maxStaleness;
        uint32 twapWindow;
        uint16 maxPremiumBps;
        uint32 multiplierCooldown;
        uint256 lastMultiplier;
        uint256 multiplierChangedAt;
    }

    function checkMarket(MarketCheck memory c) internal view returns (Reason, uint256) {
        IB20Asset t = IB20Asset(c.token);
        try t.isPaused(B20Constants.FEATURE_TRANSFER) returns (bool paused) {
            if (paused) return (Reason.TOKEN_PAUSED, 0);
        } catch {
            return (Reason.TOKEN_PAUSED, 0);
        }
        if (!transferPathAuthorized(c)) return (Reason.POLICY_BLOCKED, 0);
        try MarketCalendar(c.calendar).isOpen(block.timestamp, c.sessionMode) returns (bool open) {
            if (!open) return (Reason.MARKET_CLOSED, 0);
        } catch {
            return (Reason.MARKET_CLOSED, 0);
        }

        (bool ok, uint256 oracle, uint256 age) = PriceLib.readFeed(c.feed);
        if (!ok) return (Reason.BAD_PRICE, 0);
        if (age > c.maxStaleness) return (Reason.FEED_STALE, 0);

        if (multiplierBlocked(t, c.lastMultiplier, c.multiplierChangedAt, c.multiplierCooldown)) {
            return (Reason.MULTIPLIER_COOLDOWN, 0);
        }

        (bool tok, uint256 dex) = PriceLib.twapPrice(c.pool, c.token, c.twapWindow);
        if (!tok) return (Reason.BAD_PRICE, 0);
        if (PriceLib.premiumBps(dex, oracle) > c.maxPremiumBps) return (Reason.PREMIUM_TOO_HIGH, 0);
        return (Reason.OK, oracle);
    }

    /// @dev Fail-closed: a reverting uiMultiplier()/effectiveAt() counts as blocked.
    function multiplierBlocked(IB20Asset t, uint256 last, uint256 changedAt, uint32 cooldown)
        internal
        view
        returns (bool)
    {
        if (last != 0) {
            try t.uiMultiplier() returns (uint256 m) {
                if (m != last) return true;
            } catch {
                return true;
            }
        }
        // forge-lint: disable-next-line(block-timestamp)
        if (changedAt != 0 && block.timestamp < changedAt + cooldown) return true;
        uint256 eff = 0;
        try t.effectiveAt() returns (uint256 e) {
            eff = e;
        } catch {
            return true;
        }
        // forge-lint: disable-next-line(block-timestamp)
        if (eff > block.timestamp) return true; // scheduled update pending
        // forge-lint: disable-next-line(block-timestamp)
        return eff != 0 && block.timestamp < eff + cooldown;
    }

    /// BUY: pool -> vault (pool executes). SELL: vault -> adapter, adapter -> pool (adapter executes).
    function transferPathAuthorized(MarketCheck memory c) internal view returns (bool) {
        bytes32 s = B20Constants.TRANSFER_SENDER_POLICY;
        bytes32 r = B20Constants.TRANSFER_RECEIVER_POLICY;
        bytes32 e = B20Constants.TRANSFER_EXECUTOR_POLICY;
        if (c.isBuy) {
            return authorized(c.token, c.registry, s, c.pool) && authorized(c.token, c.registry, r, c.vault)
                && authorized(c.token, c.registry, e, c.pool) && authorized(c.token, c.registry, e, tx.origin);
        }
        return authorized(c.token, c.registry, s, c.vault) && authorized(c.token, c.registry, s, c.adapter)
            && authorized(c.token, c.registry, r, c.adapter) && authorized(c.token, c.registry, r, c.pool)
            && authorized(c.token, c.registry, e, c.adapter) && authorized(c.token, c.registry, e, tx.origin);
    }

    /// @dev Fail-closed: a reverting policyId()/isAuthorized() counts as not authorized.
    function authorized(address token, address registry, bytes32 scope, address account)
        internal
        view
        returns (bool)
    {
        try IB20Asset(token).policyId(scope) returns (uint64 id) {
            if (id == 0) return true; // ALWAYS_ALLOW
            try IPolicyRegistry(registry).isAuthorized(id, account) returns (bool ok) {
                return ok;
            } catch {
                return false;
            }
        } catch {
            return false;
        }
    }
}
