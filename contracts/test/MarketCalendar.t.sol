// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MarketCalendar} from "../src/MarketCalendar.sol";
import {DateLib} from "../src/lib/DateLib.sol";
import {SessionMode} from "../src/Types.sol";

contract MarketCalendarTest is Test {
    MarketCalendar internal cal;

    // UTC timestamps computed with Python datetime on 2026-11-06.
    uint256 internal constant THU_1530_UTC = 1793892600; // 10:30 EST
    uint256 internal constant THU_2130_UTC = 1793914200; // 16:30 EST
    uint256 internal constant THU_1415_UTC = 1793888100; // 09:15 EST
    uint256 internal constant FRI_0639_UTC = 1793947140; // 01:39 EST
    uint256 internal constant SAT_1800_UTC = 1793469600; // Sat 31 Oct
    uint256 internal constant MON_0030_UTC = 1794184200; // Sun 8 Nov 19:30 EST
    uint256 internal constant MON_0130_UTC = 1794187800; // Sun 8 Nov 20:30 EST
    uint256 internal constant SAT_0030_UTC = 1794011400; // Fri 6 Nov 19:30 EST
    uint256 internal constant SAT_0130_UTC = 1794015000; // Fri 6 Nov 20:30 EST
    uint256 internal constant THANKSGIVING_1530_UTC = 1795707000; // Thu 26 Nov
    uint256 internal constant FRI27_1730_UTC = 1795800600; // 12:30 EST, early close 13:00
    uint256 internal constant FRI27_1830_UTC = 1795804200; // 13:30 EST
    uint256 internal constant WED_1345_UTC_EDT = 1793195100; // Wed 28 Oct 09:45 EDT
    uint256 internal constant TUE_DEC1_1530_UTC = 1796139000; // Tue 1 Dec 10:30 EST

    // 2027 closures, 10:30 ET on each date unless named otherwise. UTC timestamps computed with Node
    // (Intl, America/New_York) on 2026-11-16. EDT runs from Sun 14 Mar to Sun 7 Nov 2027.
    uint256 internal constant MLK_2027_1530_UTC = 1800286200; // Mon 18 Jan 2027 15:30 UTC, 10:30 EST
    uint256 internal constant WASHINGTON_2027_1530_UTC = 1802705400; // Mon 15 Feb 2027 15:30 UTC, 10:30 EST
    uint256 internal constant GOOD_FRIDAY_2027_1430_UTC = 1806071400; // Fri 26 Mar 2027 14:30 UTC, 10:30 EDT
    uint256 internal constant MEMORIAL_2027_1430_UTC = 1811773800; // Mon 31 May 2027 14:30 UTC, 10:30 EDT
    uint256 internal constant JUNETEENTH_2027_1430_UTC = 1813329000; // Fri 18 Jun 2027 14:30 UTC, 10:30 EDT
    uint256 internal constant INDEPENDENCE_2027_1430_UTC = 1814797800; // Mon 5 Jul 2027 14:30 UTC, 10:30 EDT
    uint256 internal constant LABOR_2027_1430_UTC = 1820241000; // Mon 6 Sep 2027 14:30 UTC, 10:30 EDT
    uint256 internal constant THANKSGIVING_2027_1530_UTC = 1827156600; // Thu 25 Nov 2027 15:30 UTC, 10:30 EST
    uint256 internal constant CHRISTMAS_2027_1530_UTC = 1829662200; // Fri 24 Dec 2027 15:30 UTC, 10:30 EST
    uint256 internal constant FRI26NOV2027_1730_UTC = 1827250200; // Fri 26 Nov 2027 17:30 UTC, 12:30 EST
    uint256 internal constant FRI26NOV2027_1830_UTC = 1827253800; // Fri 26 Nov 2027 18:30 UTC, 13:30 EST

    function setUp() public {
        cal = new MarketCalendar(address(this));
    }

    function test_daysFromCivil() public pure {
        assertEq(DateLib.daysFromCivil(1970, 1, 1), 0);
        assertEq(DateLib.daysFromCivil(2000, 2, 29), 11016);
        assertEq(DateLib.daysFromCivil(2026, 11, 26), 20783);
    }

    function test_civilFromDaysRoundTrip() public pure {
        (uint256 y, uint256 m, uint256 d) = DateLib.civilFromDays(20783);
        assertEq(y, 2026);
        assertEq(m, 11);
        assertEq(d, 26);
        (y, m, d) = DateLib.civilFromDays(11016);
        assertEq(y, 2000);
        assertEq(m, 2);
        assertEq(d, 29);
    }

    function test_weekdayAndNthSunday() public pure {
        assertEq(DateLib.weekday(20783), 4); // Thursday
        assertEq(DateLib.nthSunday(2026, 3, 2), 20520); // 8 Mar 2026
        assertEq(DateLib.nthSunday(2026, 11, 1), 20758); // 1 Nov 2026
    }

    function test_dstBoundaries() public view {
        assertEq(cal.etOffsetSeconds(1772953140), 5 hours); // 8 Mar 06:59 UTC
        assertEq(cal.etOffsetSeconds(1772953200), 4 hours); // 8 Mar 07:00 UTC
        assertEq(cal.etOffsetSeconds(1793512740), 4 hours); // 1 Nov 05:59 UTC
        assertEq(cal.etOffsetSeconds(1793512800), 5 hours); // 1 Nov 06:00 UTC
    }

    function test_regularSession() public view {
        assertTrue(cal.isOpen(THU_1530_UTC, SessionMode.REGULAR));
        assertFalse(cal.isOpen(THU_2130_UTC, SessionMode.REGULAR));
        assertFalse(cal.isOpen(THU_1415_UTC, SessionMode.REGULAR));
        assertTrue(cal.isOpen(WED_1345_UTC_EDT, SessionMode.REGULAR));
        assertFalse(cal.isOpen(FRI_0639_UTC, SessionMode.REGULAR));
        assertFalse(cal.isOpen(SAT_1800_UTC, SessionMode.REGULAR));
    }

    function test_feed245Session() public view {
        assertTrue(cal.isOpen(THU_2130_UTC, SessionMode.FEED_24_5));
        assertTrue(cal.isOpen(FRI_0639_UTC, SessionMode.FEED_24_5));
        assertFalse(cal.isOpen(SAT_1800_UTC, SessionMode.FEED_24_5));
        assertFalse(cal.isOpen(MON_0030_UTC, SessionMode.FEED_24_5));
        assertTrue(cal.isOpen(MON_0130_UTC, SessionMode.FEED_24_5));
        assertTrue(cal.isOpen(SAT_0030_UTC, SessionMode.FEED_24_5));
        assertFalse(cal.isOpen(SAT_0130_UTC, SessionMode.FEED_24_5));
    }

    function test_holidaysAndEarlyClose() public view {
        assertFalse(cal.isOpen(THANKSGIVING_1530_UTC, SessionMode.REGULAR));
        assertFalse(cal.isOpen(THANKSGIVING_1530_UTC, SessionMode.FEED_24_5));
        assertTrue(cal.isOpen(FRI27_1730_UTC, SessionMode.REGULAR));
        assertFalse(cal.isOpen(FRI27_1830_UTC, SessionMode.REGULAR));
    }

    function test_mlkDay2027IsClosed() public view {
        assertFalse(cal.isOpen(MLK_2027_1530_UTC, SessionMode.REGULAR));
        assertFalse(cal.isOpen(MLK_2027_1530_UTC, SessionMode.FEED_24_5));
    }

    function test_washingtonsBirthday2027IsClosed() public view {
        assertFalse(cal.isOpen(WASHINGTON_2027_1530_UTC, SessionMode.REGULAR));
        assertFalse(cal.isOpen(WASHINGTON_2027_1530_UTC, SessionMode.FEED_24_5));
    }

    function test_goodFriday2027IsClosed() public view {
        assertFalse(cal.isOpen(GOOD_FRIDAY_2027_1430_UTC, SessionMode.REGULAR));
        assertFalse(cal.isOpen(GOOD_FRIDAY_2027_1430_UTC, SessionMode.FEED_24_5));
    }

    function test_memorialDay2027IsClosed() public view {
        assertFalse(cal.isOpen(MEMORIAL_2027_1430_UTC, SessionMode.REGULAR));
        assertFalse(cal.isOpen(MEMORIAL_2027_1430_UTC, SessionMode.FEED_24_5));
    }

    function test_juneteenthObserved2027IsClosed() public view {
        assertFalse(cal.isOpen(JUNETEENTH_2027_1430_UTC, SessionMode.REGULAR));
        assertFalse(cal.isOpen(JUNETEENTH_2027_1430_UTC, SessionMode.FEED_24_5));
    }

    function test_independenceDayObserved2027IsClosed() public view {
        assertFalse(cal.isOpen(INDEPENDENCE_2027_1430_UTC, SessionMode.REGULAR));
        assertFalse(cal.isOpen(INDEPENDENCE_2027_1430_UTC, SessionMode.FEED_24_5));
    }

    function test_laborDay2027IsClosed() public view {
        assertFalse(cal.isOpen(LABOR_2027_1430_UTC, SessionMode.REGULAR));
        assertFalse(cal.isOpen(LABOR_2027_1430_UTC, SessionMode.FEED_24_5));
    }

    function test_thanksgiving2027IsClosed() public view {
        assertFalse(cal.isOpen(THANKSGIVING_2027_1530_UTC, SessionMode.REGULAR));
        assertFalse(cal.isOpen(THANKSGIVING_2027_1530_UTC, SessionMode.FEED_24_5));
    }

    function test_christmasObserved2027IsClosed() public view {
        assertFalse(cal.isOpen(CHRISTMAS_2027_1530_UTC, SessionMode.REGULAR));
        assertFalse(cal.isOpen(CHRISTMAS_2027_1530_UTC, SessionMode.FEED_24_5));
    }

    function test_dayAfterThanksgiving2027ClosesEarly() public view {
        assertTrue(cal.isOpen(FRI26NOV2027_1730_UTC, SessionMode.REGULAR));
        assertFalse(cal.isOpen(FRI26NOV2027_1830_UTC, SessionMode.REGULAR));
    }

    function test_ownerCanOnlyMakeItStricter() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(MarketCalendar.NotOwner.selector);
        cal.addHoliday(2026, 12, 1);

        vm.expectRevert(MarketCalendar.InvalidClose.selector);
        cal.setEarlyClose(2026, 11, 27, 840); // later than the existing 13:00 close
        cal.setEarlyClose(2026, 11, 27, 720); // earlier is fine
        assertEq(cal.earlyCloseMin(DateLib.daysFromCivil(2026, 11, 27)), 720);

        assertTrue(cal.isOpen(TUE_DEC1_1530_UTC, SessionMode.REGULAR));
        cal.addHoliday(2026, 12, 1);
        assertFalse(cal.isOpen(TUE_DEC1_1530_UTC, SessionMode.REGULAR));
    }

    function test_constructorRejectsZeroOwner() public {
        vm.expectRevert(MarketCalendar.ZeroAddress.selector);
        new MarketCalendar(address(0));
    }
}
