// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISwapCallback, IERC20Minimal} from "../../src/interfaces/IExternal.sol";

/// @notice Fills only half of the exact-input amount, like a pool that hits its price limit.
contract MockPartialPool {
    address public immutable token0;
    address public immutable token1;
    uint256 public outAmount;

    constructor(address token0_, address token1_) {
        token0 = token0_;
        token1 = token1_;
    }

    function setOut(uint256 o) external {
        outAmount = o;
    }

    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160, bytes calldata data)
        external
        returns (int256 a0, int256 a1)
    {
        int256 used = amountSpecified / 2;
        address tokenIn = zeroForOne ? token0 : token1;
        address tokenOut = zeroForOne ? token1 : token0;
        IERC20Minimal(tokenOut).transfer(recipient, outAmount);
        if (zeroForOne) (a0, a1) = (used, -int256(outAmount));
        else (a0, a1) = (-int256(outAmount), used);
        uint256 before = IERC20Minimal(tokenIn).balanceOf(address(this));
        ISwapCallback(msg.sender).uniswapV3SwapCallback(a0, a1, data);
        require(IERC20Minimal(tokenIn).balanceOf(address(this)) >= before + uint256(used), "NOT_PAID");
    }
}
