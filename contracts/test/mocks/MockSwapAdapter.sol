// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISwapAdapter} from "../../src/adapters/ISwapAdapter.sol";
import {ICLPool, IERC20Minimal} from "../../src/interfaces/IExternal.sol";

/// @notice Pays a preset output from its own balance. Must be pre-funded with output tokens.
contract MockSwapAdapter is ISwapAdapter {
    uint256 public nextOut;
    bool public shouldRevert;

    error MockRevert();
    error InsufficientOutput(uint256 amountOut, uint256 minOut);

    function setNextOut(uint256 o) external {
        nextOut = o;
    }

    function setRevert(bool r) external {
        shouldRevert = r;
    }

    function swapExactIn(address pool, address tokenIn, uint256 amountIn, uint256 minOut, address recipient)
        external
        returns (uint256)
    {
        if (shouldRevert) revert MockRevert();
        IERC20Minimal(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        address t0 = ICLPool(pool).token0();
        address tokenOut = tokenIn == t0 ? ICLPool(pool).token1() : t0;
        if (nextOut < minOut) revert InsufficientOutput(nextOut, minOut);
        IERC20Minimal(tokenOut).transfer(recipient, nextOut);
        return nextOut;
    }
}
