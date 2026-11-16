// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MarketCalendar} from "../src/MarketCalendar.sol";
import {SessionMode} from "../src/Types.sol";

/// @notice MarketCalendar against vectors computed outside Solidity, with the IANA time zone data in Node's Intl
/// (test/vectors/gen-vectors.mjs says how to regenerate them).
/// @dev vm.parseJson decodes a JSON object's keys in alphabetical order, so each struct lists its fields that way.
contract MarketCalendarVectorsTest is Test {
    string internal constant DST_VECTORS = "test/vectors/us-eastern-dst.json";
    string internal constant NYSE_VECTORS = "test/vectors/nyse-calendar.json";

    struct DstTransition {
        uint256 end;
        string endUtc;
        uint256 start;
        string startUtc;
        uint256 year;
    }

    struct Holiday {
        string date;
        uint256 etDay;
        string name;
    }

    struct EarlyClose {
        uint256 closeMin;
        string date;
        uint256 etDay;
    }

    struct SessionCheck {
        string date;
        string et;
        uint256 etDay;
        bool feedOpen;
        uint256 minute;
        bool regularOpen;
        uint256 ts;
    }

    MarketCalendar internal cal;

    function setUp() public {
        cal = new MarketCalendar(address(this));
    }

    function test_etOffsetMatchesEveryDstTransitionFrom2007To2100() public view {
        DstTransition[] memory t =
            abi.decode(vm.parseJson(vm.readFile(DST_VECTORS), ".transitions"), (DstTransition[]));
        assertEq(t.length, 2100 - 2007 + 1);
        for (uint256 i; i < t.length; ++i) {
            assertEq(t[i].year, 2007 + i);
            assertEq(cal.etOffsetSeconds(t[i].start - 1), 5 hours, t[i].startUtc);
            assertEq(cal.etOffsetSeconds(t[i].start), 4 hours, t[i].startUtc);
            assertEq(cal.etOffsetSeconds(t[i].end - 1), 4 hours, t[i].endUtc);
            assertEq(cal.etOffsetSeconds(t[i].end), 5 hours, t[i].endUtc);
        }
    }

    function test_preloadedClosuresMatchTheNyseVectors() public view {
        string memory json = vm.readFile(NYSE_VECTORS);
        Holiday[] memory holidays = abi.decode(vm.parseJson(json, ".holidays"), (Holiday[]));
        EarlyClose[] memory early = abi.decode(vm.parseJson(json, ".earlyCloses"), (EarlyClose[]));
        assertEq(holidays.length, 12);
        assertEq(early.length, 3);
        for (uint256 i; i < holidays.length; ++i) {
            assertTrue(cal.isHoliday(holidays[i].etDay), holidays[i].date);
            assertEq(cal.earlyCloseMin(holidays[i].etDay), 0, holidays[i].date);
        }
        for (uint256 i; i < early.length; ++i) {
            assertFalse(cal.isHoliday(early[i].etDay), early[i].date);
            assertEq(cal.earlyCloseMin(early[i].etDay), early[i].closeMin, early[i].date);
        }
    }

    /// @dev The preload is exactly the vectors: no other day of 2026 or 2027 is a holiday or closes early.
    function test_noOtherClosureIsPreloaded() public view {
        string memory json = vm.readFile(NYSE_VECTORS);
        Holiday[] memory holidays = abi.decode(vm.parseJson(json, ".holidays"), (Holiday[]));
        EarlyClose[] memory early = abi.decode(vm.parseJson(json, ".earlyCloses"), (EarlyClose[]));
        uint256 first = vm.parseJsonUint(json, ".firstDay");
        uint256 last = vm.parseJsonUint(json, ".lastDay");
        uint256 holidayCount;
        uint256 earlyCount;
        for (uint256 day = first; day <= last; ++day) {
            if (cal.isHoliday(day)) {
                assertTrue(_listed(day, holidays), vm.toString(day));
                ++holidayCount;
            }
            if (cal.earlyCloseMin(day) != 0) {
                assertTrue(_listedEarly(day, early), vm.toString(day));
                ++earlyCount;
            }
        }
        assertEq(holidayCount, holidays.length);
        assertEq(earlyCount, early.length);
    }

    function test_isOpenAtFixedEtTimesOnEachClosureDate() public view {
        SessionCheck[] memory checks =
            abi.decode(vm.parseJson(vm.readFile(NYSE_VECTORS), ".sessionChecks"), (SessionCheck[]));
        assertEq(checks.length, 15 * 7);
        for (uint256 i; i < checks.length; ++i) {
            string memory at = string.concat(checks[i].date, " ", checks[i].et, " ET");
            (uint256 day,, uint256 minute) = cal.localTime(checks[i].ts);
            assertEq(day, checks[i].etDay, at);
            assertEq(minute, checks[i].minute, at);
            assertEq(cal.isOpen(checks[i].ts, SessionMode.REGULAR), checks[i].regularOpen, at);
            assertEq(cal.isOpen(checks[i].ts, SessionMode.FEED_24_5), checks[i].feedOpen, at);
        }
    }

    function _listed(uint256 day, Holiday[] memory holidays) internal pure returns (bool) {
        for (uint256 i; i < holidays.length; ++i) {
            if (holidays[i].etDay == day) return true;
        }
        return false;
    }

    function _listedEarly(uint256 day, EarlyClose[] memory early) internal pure returns (bool) {
        for (uint256 i; i < early.length; ++i) {
            if (early[i].etDay == day) return true;
        }
        return false;
    }
}
