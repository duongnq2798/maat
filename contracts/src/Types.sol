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
    TRANSFER_FAILED, // appended: token transfer/approve failed inside execute(); never reorder this enum
    CREDIT_FAILED, // appended (Plan 2A): credit adapter call reverted or a credit view was unreadable
    HEALTH_FACTOR_LOW, // appended (Plan 2A): health factor after the action would be below minHealthFactor
    DERISK_WINDOW // appended (Plan 2A): inside the Friday derisk window, below targetHealthFactor
}

enum SessionMode {
    REGULAR, // NYSE 09:30-16:00 ET
    FEED_24_5 // Chainlink equity feed window: Sun 20:00 ET -> Fri 20:00 ET
}

/// @notice BUY: amount = USDC in (6 decimals). SELL / SUPPLY / WITHDRAW_COLLATERAL: token = stock, amount = raw
/// stock amount. BORROW / REPAY: token = USDC, amount = USDC. PAY_EXPENSE: USDC to `payee`.
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
    /// Credit venue; address(0) disables SUPPLY / WITHDRAW_COLLATERAL / BORROW / REPAY.
    address creditAdapter;
    uint64 minHealthFactor; // WAD; risk-increasing credit actions must leave HF >= this
    uint64 targetHealthFactor; // WAD; required instead of minHealthFactor inside the derisk window
    uint32 deriskWindow; // seconds before Fri 20:00 ET (Chainlink equity feeds stop); 0 = no window
}

struct TokenConfig {
    bool allowed;
    address feed;
    address pool;
    uint16 maxWeightBps;
}
