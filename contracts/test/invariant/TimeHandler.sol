// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CommonBase} from "forge-std/Base.sol";
import {StdUtils} from "forge-std/StdUtils.sol";
import {MarketCalendar} from "../../src/MarketCalendar.sol";
import {SessionMode} from "../../src/Types.sol";
import {MockFeed} from "../mocks/MockFeed.sol";
import {spread} from "./VaultHandler.sol";

/// @notice Moves the clock forward: into regular sessions most often, and across nights, weekends, holidays and
/// UTC midnight. Each move refreshes the feeds, except one feed in 32, which keeps its last answer and may go
/// stale; one refreshed answer in 32 is off the pool by more than the premium limit.
contract TimeHandler is CommonBase, StdUtils {
    uint256 internal constant OPEN_MIN = 570; // 09:30 ET
    uint256 internal constant CLOSE_MIN = 960; // 16:00 ET
    int256 internal constant PRICE = 200e8; // the mock pools' TWAP is ~$200.0036

    MarketCalendar internal immutable calendar;
    MockFeed[2] internal feeds;

    /// Coverage, read by MandateVaultInvariants.afterInvariant.
    uint256 public openLandings; // landed inside a regular session

    constructor(MarketCalendar calendar_, MockFeed[2] memory feeds_) {
        calendar = calendar_;
        feeds = feeds_;
    }

    /// @dev A random minute of a regular session: later today if the session is still ahead, else on the next
    /// Monday to Friday. Holidays and early closes are not skipped, so some landings find the market closed.
    function nextSession(uint256 seed) external {
        seed = spread(seed);
        uint256 now_ = vm.getBlockTimestamp(); // via_ir may cache block.timestamp across warps
        (uint256 day,,) = calendar.localTime(now_);
        uint256 minute = OPEN_MIN + seed % (CLOSE_MIN - OPEN_MIN);
        uint256 target = _etToUtc(day, minute);
        while (target <= now_ || _weekday(day) == 0 || _weekday(day) == 6) {
            target = _etToUtc(++day, minute);
        }
        _moveTo(target, seed >> 16);
    }

    /// @dev Mostly a short step; otherwise a landing just before or just after UTC midnight, or one to three days
    /// ahead.
    function warp(uint256 seed) external {
        seed = spread(seed);
        uint256 now_ = vm.getBlockTimestamp();
        uint256 r = (seed >> 8) % 1 days;
        uint256 midnight = (now_ / 1 days + 1) * 1 days;
        uint256 k = seed % 8;
        uint256 target;
        if (k < 6) target = now_ + 1 minutes + r % 30 minutes;
        else if (k == 6 && r % 2 == 0) target = midnight - 1 - r % 10 minutes; // the next step crosses it
        else if (k == 6) target = midnight + r % 10 minutes;
        else target = now_ + 1 days + r % 2 days;
        if (target <= now_) target = now_ + 1;
        _moveTo(target, seed >> 64);
    }

    function _moveTo(uint256 target, uint256 seed) internal {
        vm.warp(target);
        if (calendar.isOpen(target, SessionMode.REGULAR)) ++openLandings;
        for (uint256 f; f < 2; ++f) {
            uint256 s = seed >> (32 * f);
            if (s % 32 == 0) continue; // keeps its last answer, which may go stale
            // within 30 bps of the pool, or 60 to 90 bps off it one time in 32 (the mandates allow 50); bit 4 picks
            // the side, apart from bits 5 to 9, which pick the band
            uint256 bps = (s >> 5) % 32 == 0 ? _bound(s >> 10, 60, 90) : _bound(s >> 10, 0, 30);
            int256 drift = int256(bps) * PRICE / 10_000;
            feeds[f].set((s >> 4) % 2 == 0 ? PRICE + drift : PRICE - drift, target);
        }
    }

    /// @dev Unix time of an ET wall-clock minute; session minutes are never near a DST change (02:00 ET).
    function _etToUtc(uint256 etDay, uint256 minute) internal view returns (uint256) {
        uint256 local = etDay * 1 days + minute * 1 minutes;
        return local + calendar.etOffsetSeconds(local + 5 hours);
    }

    function _weekday(uint256 etDay) internal pure returns (uint256) {
        return (etDay + 4) % 7; // DateLib.weekday: 0 = Sunday
    }
}
