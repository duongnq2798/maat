// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Contract whose every call reverts. Stands in for a dependency that reverts (not for a non-contract address).
contract MockReverter {
    fallback() external payable {
        revert("MockReverter");
    }
}
