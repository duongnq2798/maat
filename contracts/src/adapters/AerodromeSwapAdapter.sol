// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TickMath} from "v4-core/libraries/TickMath.sol";
import {ISwapAdapter} from "./ISwapAdapter.sol";
import {ICLPool, ISwapCallback, IERC20Minimal} from "../interfaces/IExternal.sol";
import {TokenTransfer} from "../lib/TokenTransfer.sol";

/// @notice Exact-input swaps directly against an Aerodrome Slipstream pool (no router).
contract AerodromeSwapAdapter is ISwapAdapter, ISwapCallback {
    using TokenTransfer for address;

    address private transient _activePool;

    error BadCallback();
    error TokenNotInPool();
    error InsufficientOutput(uint256 amountOut, uint256 minOut);

    function swapExactIn(address pool, address tokenIn, uint256 amountIn, uint256 minOut, address recipient)
        external
        returns (uint256 amountOut)
    {
        address t0 = ICLPool(pool).token0();
        address t1 = ICLPool(pool).token1();
        if (tokenIn != t0 && tokenIn != t1) revert TokenNotInPool();
        bool zeroForOne = tokenIn == t0;

        tokenIn.safeTransferFrom(msg.sender, address(this), amountIn);

        _activePool = pool;
        (int256 a0, int256 a1) = ICLPool(pool).swap(
            recipient,
            zeroForOne,
            int256(amountIn),
            zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1,
            abi.encode(tokenIn)
        );
        _activePool = address(0);

        amountOut = uint256(-(zeroForOne ? a1 : a0));
        if (amountOut < minOut) revert InsufficientOutput(amountOut, minOut);

        uint256 leftover = IERC20Minimal(tokenIn).balanceOf(address(this));
        if (leftover != 0) tokenIn.safeTransfer(recipient, leftover);
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        if (msg.sender != _activePool || msg.sender == address(0)) revert BadCallback();
        address tokenIn = abi.decode(data, (address));
        uint256 owed = uint256(amount0Delta > 0 ? amount0Delta : amount1Delta);
        tokenIn.safeTransfer(msg.sender, owed);
    }
}
