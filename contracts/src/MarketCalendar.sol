// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {DateLib} from "./lib/DateLib.sol";
import {SessionMode} from "./Types.sol";

/// @notice US equity session calendar in America/New_York time.
/// The owner can only make it stricter; loosening means deploying a new calendar through the vault timelock.
contract MarketCalendar {
    uint256 internal constant OPEN_MIN = 570; // 09:30
    uint256 internal constant CLOSE_MIN = 960; // 16:00
    uint256 internal constant FEED_EDGE_MIN = 1200; // 20:00

    address public immutable owner;
    mapping(uint256 etDay => bool) public isHoliday;
    mapping(uint256 etDay => uint16) public earlyCloseMin;

    event HolidayAdded(uint256 indexed etDay);
    event EarlyCloseSet(uint256 indexed etDay, uint16 closeMin);

    error NotOwner();
    error InvalidClose();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address owner_) {
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
        _addHoliday(2026, 11, 26); // Thanksgiving
        _addHoliday(2026, 12, 25); // Christmas
        _addHoliday(2027, 1, 1); // New Year
        // 2027 closures from the NYSE holiday calendar on nyse.com, read 2026-11-16.
        _addHoliday(2027, 1, 18); // Martin Luther King Jr. Day
        _addHoliday(2027, 2, 15); // Washington's Birthday
        _addHoliday(2027, 3, 26); // Good Friday
        _addHoliday(2027, 5, 31); // Memorial Day
        _addHoliday(2027, 6, 18); // Juneteenth (observed)
        _addHoliday(2027, 7, 5); // Independence Day (observed)
        _addHoliday(2027, 9, 6); // Labor Day
        _addHoliday(2027, 11, 25); // Thanksgiving
        _addHoliday(2027, 12, 24); // Christmas (observed)
        _setEarlyClose(2026, 11, 27, 780); // 13:00
        _setEarlyClose(2026, 12, 24, 780);
        _setEarlyClose(2027, 11, 26, 780);
    }

    function addHoliday(uint256 y, uint256 m, uint256 d) external onlyOwner {
        _addHoliday(y, m, d);
    }

    function setEarlyClose(uint256 y, uint256 m, uint256 d, uint16 closeMin) external onlyOwner {
        _setEarlyClose(y, m, d, closeMin);
    }

    /// @return seconds to subtract from UTC: 4h during US DST, 5h otherwise
    function etOffsetSeconds(uint256 ts) public pure returns (uint256) {
        (uint256 y,,) = DateLib.civilFromDays(ts / 1 days);
        uint256 dstStart = DateLib.nthSunday(y, 3, 2) * 1 days + 7 hours; // 02:00 EST
        uint256 dstEnd = DateLib.nthSunday(y, 11, 1) * 1 days + 6 hours; // 02:00 EDT
        return (ts >= dstStart && ts < dstEnd) ? 4 hours : 5 hours;
    }

    function localTime(uint256 ts) public pure returns (uint256 etDay, uint256 weekday, uint256 minuteOfDay) {
        uint256 local = ts - etOffsetSeconds(ts);
        etDay = local / 1 days;
        weekday = DateLib.weekday(etDay);
        minuteOfDay = (local % 1 days) / 60;
    }

    function isOpen(uint256 ts, SessionMode mode) external view returns (bool) {
        (uint256 day, uint256 wd, uint256 minute) = localTime(ts);
        if (isHoliday[day]) return false;
        if (mode == SessionMode.REGULAR) {
            if (wd == 0 || wd == 6) return false;
            uint256 close = earlyCloseMin[day] != 0 ? earlyCloseMin[day] : CLOSE_MIN;
            return minute >= OPEN_MIN && minute < close;
        }
        if (wd == 6) return false;
        if (wd == 0) return minute >= FEED_EDGE_MIN;
        if (wd == 5) return minute < FEED_EDGE_MIN;
        return true;
    }

    function _addHoliday(uint256 y, uint256 m, uint256 d) internal {
        uint256 day = DateLib.daysFromCivil(y, m, d);
        isHoliday[day] = true;
        emit HolidayAdded(day);
    }

    function _setEarlyClose(uint256 y, uint256 m, uint256 d, uint16 closeMin) internal {
        if (closeMin <= OPEN_MIN || closeMin >= CLOSE_MIN) revert InvalidClose();
        uint256 day = DateLib.daysFromCivil(y, m, d);
        uint16 current = earlyCloseMin[day];
        if (current != 0 && closeMin >= current) revert InvalidClose();
        earlyCloseMin[day] = closeMin;
        emit EarlyCloseSet(day, closeMin);
    }
}
