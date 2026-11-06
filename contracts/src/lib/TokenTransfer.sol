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
