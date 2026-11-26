// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VaultHandler, Env, Ghosts, spread} from "./VaultHandler.sol";
import {Action, Mandate} from "../../src/Types.sol";
import {MockB20} from "../mocks/MockB20.sol";

/// @notice SUPPLY, BORROW, REPAY and WITHDRAW_COLLATERAL on the MockCreditAdapter, whose health factors are
/// scripted per call: mostly above the target, sometimes between the floor and the target, sometimes below.
contract CreditHandler is VaultHandler {
    constructor(Env memory env_, Ghosts ghosts_) VaultHandler(env_, ghosts_) {}

    function supply(uint256 seed, uint256 raw) external {
        seed = spread(seed);
        (MockB20 token,) = _pick(seed);
        uint256 amount = _upTo(seed >> 8, raw, token.balanceOf(address(env.vault)));
        _send(_intent(Action.SUPPLY, address(token), amount), seed >> 32);
    }

    function withdrawCollateral(uint256 seed, uint256 raw) external {
        seed = spread(seed);
        (MockB20 token,) = _pick(seed);
        uint256 amount = _upTo(seed >> 8, raw, env.credit.suppliedOf(address(token)));
        env.credit.setNextHf(_healthFactor(seed >> 16));
        _send(_intent(Action.WITHDRAW_COLLATERAL, address(token), amount), seed >> 32);
    }

    function borrow(uint256 seed, uint256 usdc) external {
        seed = spread(seed);
        uint256 amount = (seed >> 8) % 16 == 0 ? 0 : _bound(usdc, 1e6, 100e6);
        uint256 projected = _healthFactor(seed >> 16);
        env.credit.setProjectedHf(projected);
        // the venue's check after the borrow agrees with the projection, except one time in eight
        env.credit.setNextHf((seed >> 24) % 8 == 0 ? projected * 4 / 5 : projected);
        _send(_intent(Action.BORROW, address(env.usdc), amount), seed >> 32);
    }

    function repay(uint256 seed, uint256 usdc) external {
        seed = spread(seed);
        uint256 debt = env.credit.debt();
        uint256 amount = (seed >> 8) % 16 == 0 ? 0 : _bound(usdc, 1, debt > 1e6 ? debt : 1e6);
        _send(_intent(Action.REPAY, address(env.usdc), amount), seed >> 32);
    }

    /// @dev Up to `held`, and one time in sixteen one more than that (INSUFFICIENT_BALANCE).
    function _upTo(uint256 seed, uint256 x, uint256 held) internal pure returns (uint256) {
        if (seed % 16 == 0) return held + 1;
        return _bound(x, 1, held == 0 ? 1 : held);
    }

    /// @dev Above the target five times in eight, between the floor and the target two in eight, below the floor
    /// one in eight.
    function _healthFactor(uint256 seed) internal view returns (uint256) {
        Mandate memory m = env.vault.mandate();
        uint256 k = seed % 8;
        if (k == 0) return _bound(seed >> 8, 1e18, uint256(m.minHealthFactor) - 1);
        if (k < 3) return _bound(seed >> 8, m.minHealthFactor, uint256(m.targetHealthFactor) - 1);
        return _bound(seed >> 8, m.targetHealthFactor, 4e18);
    }
}
