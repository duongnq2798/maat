// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VaultHandler, Env, Ghosts, spread} from "./VaultHandler.sol";
import {Action, Intent, Mandate} from "../../src/Types.sol";
import {MockB20} from "../mocks/MockB20.sol";
import {MockFeed} from "../mocks/MockFeed.sol";

/// @notice BUY and SELL across the listed tokens (and now and then the unlisted one), with the mock swap set to
/// pay out around the vault's slippage floor.
contract TradeHandler is VaultHandler {
    uint256 internal constant BPS = 10_000;

    constructor(Env memory env_, Ghosts ghosts_) VaultHandler(env_, ghosts_) {}

    function buy(uint256 seed, uint256 usdcIn) external {
        seed = spread(seed);
        Mandate memory m = env.vault.mandate();
        (MockB20 token, MockFeed feed) = _pick(seed);
        Intent memory i = _intent(Action.BUY, address(token), _size(seed >> 8, usdcIn, m.perTradeCapUsd));
        if (address(feed) != address(0) && i.amount != 0) {
            uint256 expected = i.amount * 10 ** (uint256(token.decimals()) + 2) / _price(feed);
            _setSwapOut(i, expected, m.maxSlippageBps, seed >> 16);
        }
        _send(i, seed >> 32);
    }

    function sell(uint256 seed, uint256 raw) external {
        seed = spread(seed);
        Mandate memory m = env.vault.mandate();
        (MockB20 token, MockFeed feed) = _pick(seed);
        uint256 scale = 10 ** (uint256(token.decimals()) + 2);
        // the per-trade cap in raw stock at the oracle price; an unlisted token is refused before any price is read
        uint256 capRaw = address(feed) == address(0) ? 1e8 : uint256(m.perTradeCapUsd) * scale / _price(feed);
        Intent memory i = _intent(Action.SELL, address(token), _size(seed >> 8, raw, capRaw));
        if (address(feed) != address(0) && i.amount != 0) {
            _setSwapOut(i, i.amount * _price(feed) / scale, m.maxSlippageBps, seed >> 16);
        }
        _send(i, seed >> 32);
    }

    /// @dev Most swaps pay between the floor and the oracle-implied amount. One in 32 pays under the floor and one
    /// in 32 carries a minOut above what the swap pays: both must end as SWAP_FAILED.
    function _setSwapOut(Intent memory i, uint256 expected, uint256 slippageBps, uint256 seed) internal {
        uint256 floor = expected * (BPS - slippageBps) / BPS;
        uint256 k = seed % 32;
        uint256 out = k == 0 ? floor * 99 / 100 : _bound(seed >> 8, floor, expected);
        if (k == 1) i.minOut = out + 1;
        env.swap.setNextOut(out);
    }
}
