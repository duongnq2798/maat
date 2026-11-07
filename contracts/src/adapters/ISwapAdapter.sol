// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface ISwapAdapter {
    /// @notice Pulls `amountIn` of `tokenIn` from msg.sender, swaps it in `pool`, sends the output and any
    /// unused input to `recipient`. Reverts if the output is below `minOut`.
    function swapExactIn(address pool, address tokenIn, uint256 amountIn, uint256 minOut, address recipient)
        external
        returns (uint256 amountOut);
}
