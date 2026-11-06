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

    /// @notice A token held as lending collateral: checks 2, 5 and 6 only (no trade, so no premium or path).
    struct CollateralCheck {
        address token;
        address feed;
        uint32 maxStaleness;
        uint32 multiplierCooldown;
        uint256 lastMultiplier;
        uint256 multiplierChangedAt;
    }

    function checkMarket(MarketCheck memory c) internal view returns (Reason, uint256) {
        IB20Asset t = IB20Asset(c.token);
        if (tokenPaused(c.token)) return (Reason.TOKEN_PAUSED, 0);
        if (!transferPathAuthorized(c)) return (Reason.POLICY_BLOCKED, 0);
        if (!marketOpen(c.calendar, c.sessionMode)) return (Reason.MARKET_CLOSED, 0);

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

    /// @dev Fail-closed: a reverting isPaused() counts as paused.
    function tokenPaused(address token) internal view returns (bool) {
        try IB20Asset(token).isPaused(B20Constants.FEATURE_TRANSFER) returns (bool p) {
            return p;
        } catch {
            return true;
        }
    }

    /// @dev Fail-closed: a reverting calendar counts as closed.
    function marketOpen(address calendar, SessionMode mode) internal view returns (bool) {
        try MarketCalendar(calendar).isOpen(block.timestamp, mode) returns (bool open) {
            return open;
        } catch {
            return false;
        }
    }

    /// @notice Collateral is safe to borrow against: not paused, live price, no multiplier change pending.
    /// @dev A feed address without code (a token whose market was removed) is BAD_PRICE, never a revert.
    function collateralHealthy(CollateralCheck memory c) internal view returns (Reason) {
        if (tokenPaused(c.token)) return Reason.TOKEN_PAUSED;
        if (c.feed.code.length == 0) return Reason.BAD_PRICE;
        (bool ok,, uint256 age) = PriceLib.readFeed(c.feed);
        if (!ok) return Reason.BAD_PRICE;
        if (age > c.maxStaleness) return Reason.FEED_STALE;
        if (multiplierBlocked(IB20Asset(c.token), c.lastMultiplier, c.multiplierChangedAt, c.multiplierCooldown)) {
            return Reason.MULTIPLIER_COOLDOWN;
        }
        return Reason.OK;
    }

    /// @notice Every sender, receiver and executor leg of a multi-hop B20 transfer is authorized. tx.origin is
    /// always checked as an executor too, as in transferPathAuthorized.
    function transferable(
        address token,
        address registry,
        address[] memory senders,
        address[] memory receivers,
        address[] memory executors
    ) internal view returns (bool) {
        for (uint256 i; i < senders.length; ++i) {
            if (!authorized(token, registry, B20Constants.TRANSFER_SENDER_POLICY, senders[i])) return false;
        }
        for (uint256 i; i < receivers.length; ++i) {
            if (!authorized(token, registry, B20Constants.TRANSFER_RECEIVER_POLICY, receivers[i])) return false;
        }
        for (uint256 i; i < executors.length; ++i) {
            if (!authorized(token, registry, B20Constants.TRANSFER_EXECUTOR_POLICY, executors[i])) return false;
        }
        return authorized(token, registry, B20Constants.TRANSFER_EXECUTOR_POLICY, tx.origin);
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
