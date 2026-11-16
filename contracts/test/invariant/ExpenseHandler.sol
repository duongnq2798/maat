// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VaultHandler, Env, Ghosts, spread} from "./VaultHandler.sol";
import {Action, Intent} from "../../src/Types.sol";

/// @notice PAY_EXPENSE to an allowlisted payee three times in four, to an address off the allowlist otherwise.
contract ExpenseHandler is VaultHandler {
    address internal constant NOT_A_PAYEE = address(0xB111);

    constructor(Env memory env_, Ghosts ghosts_) VaultHandler(env_, ghosts_) {}

    function payExpense(uint256 seed, uint256 usdc) external {
        seed = spread(seed);
        Intent memory i = _intent(
            Action.PAY_EXPENSE, address(env.usdc), _size(seed >> 8, usdc, env.vault.mandate().perTradeCapUsd)
        );
        i.payee = seed % 4 == 0 ? NOT_A_PAYEE : env.payees[(seed >> 2) % 2];
        _send(i, seed >> 32);
    }
}
