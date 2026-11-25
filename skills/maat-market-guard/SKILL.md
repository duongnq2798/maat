---
name: maat-market-guard
description: Ask Maat's onchain guard on Base, read-only, before trading a tokenized US stock (Coinbase B20 stocks such as NVDAc, GOOGLc and AAPLc). Two checks. `market` asks the MarketCalendar contract whether the NYSE session is open now, with weekends, holidays, early closes and New York daylight saving. `preview` asks Maat's live MandateVault whether it would accept a given intent now, through previewIntent, the verdict execute() reaches before it acts. Every answer is a typed reason, OK or one of 19 refusal codes such as MARKET_CLOSED, FEED_STALE or PREMIUM_TOO_HIGH. Use before an agent buys or sells a tokenized stock on Base, before it sends an intent to a Maat vault, or when the user asks whether the US stock market is open. A zero-dependency Node script makes plain eth_call reads to a public Base RPC. NOT a price quote, NOT investment advice; it needs no key or wallet, and it never sends a transaction.
---

# maat-market-guard: ask the vault before you trade

[Maat](https://maatonbase.xyz) is a treasury agent on Base. Its trades go through a vault contract, `MandateVault`,
that checks every intent against a mandate and records the verdict onchain as a `Decision` with a typed reason. This
skill asks the same contracts the same questions, read-only, so any agent can use the guard before it trades.

**Division of labor.** `scripts/check.mjs` (plain Node.js with its built-in fetch, zero dependencies) does the chain reads and
prints one JSON object. You relay the answer. Do not work out market hours yourself, and do not trade unless the exit
code is 0. A refusal is an answer, not an error: change the plan (wait for the open, size down, pick another stock)
instead of retrying for an OK.

## When to call it

- **Before you buy or sell a tokenized stock on Base**, run `market`. Outside the session the Chainlink equity feeds
  can go hours without an update while the pools keep trading.
- **Before you send an intent to a Maat vault**, run `preview` with the same intent. `execute()` reaches the same
  verdict before it acts.
- **To screen a trade of your own**, preview a small BUY (for example `--amount 1`) of the stock. For a BUY or a SELL
  the vault checks in a fixed order: the token's pause and transfer policy, the calendar, the Chainlink feed, the
  multiplier and the pool's TWAP premium come before Maat's own balance, caps and weights. Only `TOKEN_PAUSED` is a
  fact about the token itself, for anyone. `POLICY_BLOCKED` applies the token's transfer policy to Maat's own path (its
  vault, pool, adapter and executor), and the Market group measures the stock against Maat's mandate: its session,
  feed-staleness, multiplier-cooldown and premium limits, with the vault's own record of the last multiplier. So an
  `OK` or a `FEED_STALE` says whether the stock meets Maat's limits at that block, not yours. A BUY refused with
  `INSUFFICIENT_BALANCE`, `SIZE_LIMIT` or `CONCENTRATION` passed every market check before it; those three describe
  Maat's own balance, caps and weights.

## Commands

Run them from this skill's folder.

```bash
# Is the session open now (at the latest Base block), on the calendar the vault's mandate names?
node scripts/check.mjs market

# At another time: unix seconds, or ISO 8601 with a zone
node scripts/check.mjs market --at 2026-11-27T18:30:00Z

# Is the Chainlink equity feed window (Sun 20:00 ET to Fri 20:00 ET) open? `open` answers it; `allowed`, the
# reason and the exit code stay the verdict for the session the vault's mandate checks (REGULAR, the NYSE session)
node scripts/check.mjs market --session feed

# Would the vault accept a BUY of $5 of NVDAc now?
node scripts/check.mjs preview --action BUY --token NVDAc --amount 5

# Every typed reason with its id, label, group and meaning (no network)
node scripts/check.mjs reasons

# All flags
node scripts/check.mjs --help
```

`preview` flags:

| Flag | Meaning |
| --- | --- |
| `--action` | `BUY`, `SELL`, `SUPPLY`, `WITHDRAW_COLLATERAL`, `BORROW`, `REPAY` or `PAY_EXPENSE` |
| `--token` | `NVDAc`, `GOOGLc`, `AAPLc`, `USDC` or an address. `BORROW`, `REPAY` and `PAY_EXPENSE` default to `USDC` |
| `--amount` | A decimal: USDC for `BUY`, `BORROW`, `REPAY` and `PAY_EXPENSE`; stock units for `SELL`, `SUPPLY` and `WITHDRAW_COLLATERAL` (the script reads the token's decimals) |
| `--raw` | The onchain integer instead of `--amount` |
| `--payee` | Required for `PAY_EXPENSE`: the address to pay |
| `--from` | The caller of the `eth_call`. Default: the vault's executor, so the token policy check sees the same `tx.origin` as `execute()` |
| `--min-out`, `--id`, `--rationale-hash` | The other `Intent` fields; default 0. The verdict does not depend on them |

Flags for both checks: `--block <number|latest>` (default `latest`), `--vault <address>` (another `MandateVault`
deployed from the same code), `--rpc <url>`.

## Output

One JSON object on stdout. A real answer, read from Base mainnet at block 62087947 for 10:00 ET on Thanksgiving:

```console
$ node scripts/check.mjs market --block 62087947 --at 2026-11-26T15:00:00Z
{
  "check": "market",
  "allowed": false,
  "open": false,
  "reason": 6,
  "reasonName": "MARKET_CLOSED",
  "meaning": "The market is closed for the mandate's session (a weekend, a holiday or outside its hours), or the calendar can't be read.",
  "closedBecause": "holiday",
  "session": "REGULAR",
  "mandateSession": "REGULAR",
  "at": {
    "unix": 1795705200,
    "utc": "2026-11-26T15:00:00.000Z",
    "et": "2026-11-26 10:00",
    "weekday": "Thu"
  },
  "holiday": true,
  "earlyClose": null,
  "calendar": "0x9bfe055323101245a644af162287c4c38708adb1",
  "vault": "0x3f956072d18ddd20d5efb74e9ccabf8deade699b",
  "block": {
    "number": 62087947,
    "timestamp": 1795607965
  },
  "rpc": "mainnet.base.org"
}
```

| Field | In | Meaning |
| --- | --- | --- |
| `allowed` | both | `true` only for OK: for `market`, the session the vault's mandate checks is open. Trade on nothing else |
| `reason`, `reasonName` | both | The onchain `Reason` value and its name; see the table below. `null` and `UNKNOWN` when there was no answer |
| `meaning` | both | One plain sentence for the user |
| `label`, `group` | `preview` | The short label and the group of the reason |
| `open`, `closedBecause` | `market` | Whether `session` is open. `closedBecause` is `holiday`, `weekend`, `before-open`, `after-close` or `early-close` when closed, else `null` |
| `session`, `mandateSession` | `market` | The session asked about (`--session`, else the mandate's), and the one the vault's mandate checks, which `allowed` and `reason` are for. `REGULAR` is NYSE 09:30 to 16:00 ET |
| `at`, `holiday`, `earlyClose` | `market` | The time in UTC and New York, and that day's calendar entries |
| `intent`, `from` | `preview` | The intent as sent, amounts as onchain integers, and the caller |
| `vault`, `calendar`, `block`, `rpc` | both | What was read, at which block, through which RPC host |
| `error` | no answer | Why there is no verdict |

Addresses in the output are lowercase hex.

**Exit codes:** `0` allowed; `1` refused, with a typed reason; `2` no answer (bad input, an RPC failure or data that
does not decode). Fail closed: treat `2` as a refusal. The codes are the same when the skill folder is linked into an
agent's skills directory instead of copied.

## Typed reasons

The values of `enum Reason` in the vault's `Types.sol`. `market` returns only `OK` or `MARKET_CLOSED`.

| id | reasonName | group | meaning |
| --- | --- | --- | --- |
| 0 | `OK` | | Every check passed: execute() would act on this intent now. |
| 1 | `VAULT_PAUSED` | Token and policy | The owner paused the vault. Only repaying debt still goes through. |
| 2 | `ACTION_NOT_SUPPORTED` | Token and policy | Credit actions are off: this vault has no credit adapter. |
| 3 | `TOKEN_NOT_ALLOWED` | Token and policy | This token can't be used for this action. |
| 4 | `TOKEN_PAUSED` | Token and policy | The token's transfers are paused, or their state can't be read. |
| 5 | `POLICY_BLOCKED` | Token and policy | The token's own transfer policy does not allow this path. |
| 6 | `MARKET_CLOSED` | Market | The market is closed for the mandate's session (a weekend, a holiday or outside its hours), or the calendar can't be read. |
| 7 | `FEED_STALE` | Market | The Chainlink price is older than the mandate allows. |
| 8 | `BAD_PRICE` | Market | The Chainlink answer is zero, negative, undated or from the future, or the feed or the pool's TWAP could not be read. |
| 9 | `MULTIPLIER_COOLDOWN` | Market | The token's multiplier changed recently or has a change scheduled, as around a split, or can't be read. |
| 10 | `PREMIUM_TOO_HIGH` | Market | The pool price is too far above or below Chainlink. |
| 11 | `SIZE_LIMIT` | Limits | Over the per-trade cap or the daily cap. |
| 12 | `CONCENTRATION` | Limits | The buy would push one stock past its maximum weight, or its weight can't be measured. |
| 13 | `PAYEE_NOT_ALLOWED` | Limits | The payee is not on the allowlist, which the deploy sets and the owner changes only through the timelock. |
| 14 | `INSUFFICIENT_BALANCE` | Limits | Not enough funds for the amount, or an amount of zero. |
| 15 | `SWAP_FAILED` | Execution | The swap reverted, for example on slippage past the limit. |
| 16 | `TRANSFER_FAILED` | Execution | A token transfer or approval failed. |
| 17 | `CREDIT_FAILED` | Credit | An Aave call failed, or its account data couldn't be read. |
| 18 | `HEALTH_FACTOR_LOW` | Credit | The move would leave the Aave health factor under the floor. |
| 19 | `DERISK_WINDOW` | Credit | Before the feed pauses for a weekend or holiday, the target health factor applies, not just the floor. |

## Configuration

- **RPC:** `--rpc <url>`, else the `MAAT_GUARD_RPC_URL` environment variable, else `https://mainnet.base.org`, Base's
  public endpoint, which limits its rate. The output names only the RPC's host, never its path, so a key in the URL
  stays out of logs. A past `--block` needs an RPC that still holds that block's state.
- **Addresses:** Base mainnet (chain 8453), copied into `scripts/check.mjs` from the Maat repository: the vault and the
  calendar from the deployment table in `deployments/README.md`, the tokens from `contracts/script/BaseAddresses.sol`.

| Contract | Address |
| --- | --- |
| `MandateVault` | `0x3F956072d18ddD20d5eFb74e9CCabf8Deade699b` |
| `MarketCalendar` | `0x9bfe055323101245a644AF162287C4C38708aDB1` |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| NVDAc | `0xb20000000000000000000078ee7ce2fE4908108C` |
| GOOGLc | `0xb2000000000000000000002D0BA3164cc74f58B7` |
| AAPLc | `0xb200000000000000000000C2e324d24d7eEcd1fb` |

`market` reads the calendar address and the session from the vault's mandate, so it follows the calendar the vault
actually checks.

## Limits

- `preview` cannot predict `SWAP_FAILED`, `TRANSFER_FAILED` or `CREDIT_FAILED`, nor the credit adapter's own health
  check on `WITHDRAW_COLLATERAL` against debt, and it does not check whether an intent id was already used.
- An answer holds for the block it was read at. Prices and the clock move on.
- `market` is the calendar check alone, not the whole verdict; `preview` runs every check.
- The calendar was deployed with the NYSE holidays and early closes from 2026-11-26 to 2027-12-24. Its owner can add
  closures but never remove one.

## Test

```bash
node scripts/selftest.mjs           # offline: recorded Base mainnet answers, no network
node scripts/selftest.mjs --record  # live and read-only: runs the same cases and rewrites scripts/fixtures/rpc.json
```

The selftest covers an open session, a holiday, an early close, a weekend, the feed window, previewIntent OKs for a BUY
and a SUPPLY, five typed refusals, RPC failures, bad input, and the script run as a program, also through a linked
skill folder.

## Source

The contracts, their tests and this skill: [github.com/duongnq2798/maat](https://github.com/duongnq2798/maat)
(`contracts/src/MandateVault.sol`, `contracts/src/MarketCalendar.sol`, `contracts/src/Types.sol`). The same file is
served at [maatonbase.xyz/skill.md](https://maatonbase.xyz/skill.md).
