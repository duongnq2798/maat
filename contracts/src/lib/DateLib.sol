// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Proleptic Gregorian calendar helpers (Howard Hinnant's algorithms). Day 0 = 1970-01-01.
library DateLib {
    function daysFromCivil(uint256 y, uint256 m, uint256 d) internal pure returns (uint256) {
        int256 yy = int256(y) - (m <= 2 ? int256(1) : int256(0));
        int256 era = (yy >= 0 ? yy : yy - 399) / 400;
        int256 yoe = yy - era * 400;
        int256 mp = (int256(m) + 9) % 12; // March = 0
        int256 doy = (153 * mp + 2) / 5 + int256(d) - 1;
        int256 doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        return uint256(era * 146097 + doe - 719468);
    }

    function civilFromDays(uint256 dayNumber) internal pure returns (uint256 y, uint256 m, uint256 d) {
        int256 z = int256(dayNumber) + 719468;
        int256 era = z / 146097;
        int256 doe = z - era * 146097;
        int256 yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        int256 yy = yoe + era * 400;
        int256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        int256 mp = (5 * doy + 2) / 153;
        d = uint256(doy - (153 * mp + 2) / 5 + 1);
        m = uint256(mp < 10 ? mp + 3 : mp - 9);
        y = uint256(m <= 2 ? yy + 1 : yy);
    }

    /// @return 0 = Sunday ... 6 = Saturday
    function weekday(uint256 dayNumber) internal pure returns (uint256) {
        return (dayNumber + 4) % 7;
    }

    /// @return day number of the n-th (1-based) Sunday of month `m` in year `y`
    function nthSunday(uint256 y, uint256 m, uint256 n) internal pure returns (uint256) {
        uint256 first = daysFromCivil(y, m, 1);
        uint256 offset = (7 - weekday(first)) % 7;
        return first + offset + (n - 1) * 7;
    }
}
