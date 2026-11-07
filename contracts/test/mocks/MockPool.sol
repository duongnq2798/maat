// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

contract MockPool {
    address public immutable token0;
    address public immutable token1;
    int56 internal _c0;
    int56 internal _c1;

    constructor(address token0_, address token1_) {
        token0 = token0_;
        token1 = token1_;
    }

    /// @notice Makes observe([window, 0]) report a constant `tick` over the window.
    function setTick(int24 tick, uint32 window) external {
        _c0 = 0;
        _c1 = int56(tick) * int56(uint56(window));
    }

    function setCumulatives(int56 c0, int56 c1) external {
        _c0 = c0;
        _c1 = c1;
    }

    function observe(uint32[] calldata) external view returns (int56[] memory cum, uint160[] memory spl) {
        cum = new int56[](2);
        spl = new uint160[](2);
        cum[0] = _c0;
        cum[1] = _c1;
    }
}
