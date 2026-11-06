// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20Minimal} from "../interfaces/IExternal.sol";

/// @notice ERC-20 calls that tolerate missing return values and bubble up the token's revert reason
/// (B20 reverts with typed errors such as PolicyForbids).
library TokenTransfer {
    error TransferFailed(address token);

    function safeTransfer(address token, address to, uint256 amount) internal {
        _call(token, abi.encodeCall(IERC20Minimal.transfer, (to, amount)));
    }

    function safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        _call(token, abi.encodeCall(IERC20Minimal.transferFrom, (from, to, amount)));
    }

    function safeApprove(address token, address spender, uint256 amount) internal {
        _call(token, abi.encodeCall(IERC20Minimal.approve, (spender, amount)));
    }

    /// @notice Non-reverting variants for execute(), which must turn a failing token into a logged Decision.
    function tryTransfer(address token, address to, uint256 amount) internal returns (bool) {
        return _tryCall(token, abi.encodeCall(IERC20Minimal.transfer, (to, amount)));
    }

    function tryApprove(address token, address spender, uint256 amount) internal returns (bool) {
        return _tryCall(token, abi.encodeCall(IERC20Minimal.approve, (spender, amount)));
    }

    /// @dev A revert, a `false` return, malformed return data or a call to an address without code all yield
    /// false; decoding as uint256 (only when >= 32 bytes) cannot revert.
    function _tryCall(address token, bytes memory data) private returns (bool) {
        (bool ok, bytes memory ret) = token.call(data);
        if (!ok) return false;
        if (ret.length == 0) return token.code.length != 0;
        return ret.length >= 32 && abi.decode(ret, (uint256)) == 1;
    }

    function _call(address token, bytes memory data) private {
        (bool ok, bytes memory ret) = token.call(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(ret, 0x20), mload(ret))
            }
        }
        if (ret.length != 0 && !abi.decode(ret, (bool))) revert TransferFailed(token);
    }
}
