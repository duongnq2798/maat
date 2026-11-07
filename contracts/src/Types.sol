// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

enum Action {
    BUY,
    SELL,
    SUPPLY,
    WITHDRAW_COLLATERAL,
    BORROW,
    REPAY,
    PAY_EXPENSE
}

enum Reason {
    OK,
    VAULT_PAUSED,
    ACTION_NOT_SUPPORTED,
    TOKEN_NOT_ALLOWED,
    TOKEN_PAUSED,
    POLICY_BLOCKED,
    MARKET_CLOSED,
    FEED_STALE,
    BAD_PRICE,
    MULTIPLIER_COOLDOWN,
    PREMIUM_TOO_HIGH,
    SIZE_LIMIT,
    CONCENTRATION,
    PAYEE_NOT_ALLOWED,
    INSUFFICIENT_BALANCE,
    SWAP_FAILED,
    TRANSFER_FAILED // appended: token transfer/approve failed inside execute(); never reorder this enum
}

enum SessionMode {
    REGULAR, // NYSE 09:30-16:00 ET
    FEED_24_5 // Chainlink equity feed window: Sun 20:00 ET -> Fri 20:00 ET
}

/// @notice BUY: amount = USDC in (6 decimals). SELL: amount = stock raw amount. PAY_EXPENSE: USDC to `payee`.
struct Intent {
    bytes32 id;
    Action action;
    address token;
    uint256 amount;
    uint256 minOut;
    address payee;
    bytes32 rationaleHash;
}

/// @notice USD amounts are USDC units (6 decimals).
struct Mandate {
    SessionMode sessionMode;
    uint16 maxPremiumBps;
    uint16 maxSlippageBps;
    uint32 maxStaleness;
    uint32 multiplierCooldown;
    uint32 twapWindow;
    uint128 perTradeCapUsd;
    uint128 dailyCapUsd;
    address calendar;
    address swapAdapter;
}

struct TokenConfig {
    bool allowed;
    address feed;
    address pool;
    uint16 maxWeightBps;
}
