// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice A public inbox of short briefs for the Maat agent. Each brief is a log; the only storage is the id counter.
/// No owner, no pause, no funds: `brief` is not payable and there is no receive or fallback, so a call with ether reverts.
/// The agent reads briefs as untrusted data; the vault, not this contract, decides what is allowed.
contract MaatInbox {
    uint256 public constant MAX_BYTES = 280;

    /// @notice The last id given, so also the number of briefs: ids start at 1 and grow by 1 across all senders.
    uint256 public lastId;

    event Brief(uint256 indexed id, address indexed from, string text);

    error BadLength(uint256 length);

    /// @notice Sends `text` (1 to 280 bytes, not checked as UTF-8) to the agent and returns its id.
    /// @dev Calldata after the ABI-encoded string, such as an ERC-8021 Builder Code suffix, is ignored.
    function brief(string calldata text) external returns (uint256 id) {
        uint256 n = bytes(text).length;
        if (n == 0 || n > MAX_BYTES) revert BadLength(n);
        id = ++lastId;
        emit Brief(id, msg.sender, text);
    }
}
