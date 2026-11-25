#!/usr/bin/env node
// maat-market-guard: ask Maat's onchain guard on Base, read-only, before a tokenized-stock trade.
//
//   node scripts/check.mjs market   is the US equity session open now, on the calendar the Maat vault uses?
//   node scripts/check.mjs preview  would the live MandateVault accept this intent now? (its previewIntent)
//   node scripts/check.mjs reasons  the typed reasons, offline
//
// Prints one JSON object: {allowed, reason, reasonName, ...}. Exit 0 = allowed (or open), 1 = refused with a typed
// reason, 2 = no answer (bad input or an RPC failure): fail closed and do not trade on a 2.
// Plain JSON-RPC over fetch (eth_call and eth_getBlockByNumber only): no key, no signature, no transaction, no gas.
// Zero dependencies: Node.js built-ins only.

import process from "node:process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_RPC = "https://mainnet.base.org";
/** Overrides DEFAULT_RPC; the --rpc flag overrides both. */
export const RPC_ENV = "MAAT_GUARD_RPC_URL";

// Base mainnet (chain 8453). Copied from https://github.com/duongnq2798/maat so the skill runs on its own:
// the vault and its calendar from the deployment table in deployments/README.md (deployed 2026-11-24),
// the tokens from contracts/script/BaseAddresses.sol.
export const ADDRESSES = Object.freeze({
  MandateVault: "0x3F956072d18ddD20d5eFb74e9CCabf8Deade699b",
  MarketCalendar: "0x9bfe055323101245a644AF162287C4C38708aDB1",
});
export const TOKENS = Object.freeze({
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  NVDAc: "0xb20000000000000000000078ee7ce2fE4908108C",
  GOOGLc: "0xb2000000000000000000002D0BA3164cc74f58B7",
  AAPLc: "0xb200000000000000000000C2e324d24d7eEcd1fb",
});
const USDC_DECIMALS = 6;

/** enum Action in contracts/src/Types.sol, in order: the index is the onchain value. */
export const ACTIONS = Object.freeze(["BUY", "SELL", "SUPPLY", "WITHDRAW_COLLATERAL", "BORROW", "REPAY", "PAY_EXPENSE"]);
/** Actions whose amount is USDC (6 decimals). The others (SELL, SUPPLY, WITHDRAW_COLLATERAL) take a raw stock amount. */
const USDC_AMOUNT = new Set(["BUY", "BORROW", "REPAY", "PAY_EXPENSE"]);
/** Actions whose token is USDC itself. */
const USDC_TOKEN = new Set(["BORROW", "REPAY", "PAY_EXPENSE"]);

/** enum SessionMode in contracts/src/Types.sol. */
export const SESSIONS = Object.freeze(["REGULAR", "FEED_24_5"]);

/**
 * enum Reason in contracts/src/Types.sol, in order: the index is the onchain value. Each refusal has the short label,
 * the group and the one-line meaning that the Maat site and docs give it (web/content/reasons.ts).
 */
export const REASONS = Object.freeze([
  { name: "OK", label: "All checks passed", group: null, meaning: "Every check passed: execute() would act on this intent now." },
  { name: "VAULT_PAUSED", label: "Vault paused", group: "Token and policy", meaning: "The owner paused the vault. Only repaying debt still goes through." },
  { name: "ACTION_NOT_SUPPORTED", label: "Credit not enabled", group: "Token and policy", meaning: "Credit actions are off: this vault has no credit adapter." },
  { name: "TOKEN_NOT_ALLOWED", label: "Token not allowed", group: "Token and policy", meaning: "This token can't be used for this action." },
  { name: "TOKEN_PAUSED", label: "Token paused", group: "Token and policy", meaning: "The token's transfers are paused, or their state can't be read." },
  { name: "POLICY_BLOCKED", label: "Blocked by token policy", group: "Token and policy", meaning: "The token's own transfer policy does not allow this path." },
  {
    name: "MARKET_CLOSED",
    label: "Market closed",
    group: "Market",
    meaning: "The market is closed for the mandate's session (a weekend, a holiday or outside its hours), or the calendar can't be read.",
  },
  { name: "FEED_STALE", label: "Price feed out of date", group: "Market", meaning: "The Chainlink price is older than the mandate allows." },
  {
    name: "BAD_PRICE",
    label: "Bad price data",
    group: "Market",
    meaning: "The Chainlink answer is zero, negative, undated or from the future, or the feed or the pool's TWAP could not be read.",
  },
  {
    name: "MULTIPLIER_COOLDOWN",
    label: "Corporate action cooldown",
    group: "Market",
    meaning: "The token's multiplier changed recently or has a change scheduled, as around a split, or can't be read.",
  },
  { name: "PREMIUM_TOO_HIGH", label: "Pool price too far from oracle", group: "Market", meaning: "The pool price is too far above or below Chainlink." },
  { name: "SIZE_LIMIT", label: "Over the size limit", group: "Limits", meaning: "Over the per-trade cap or the daily cap." },
  {
    name: "CONCENTRATION",
    label: "Too much in one stock",
    group: "Limits",
    meaning: "The buy would push one stock past its maximum weight, or its weight can't be measured.",
  },
  {
    name: "PAYEE_NOT_ALLOWED",
    label: "Payee not approved",
    group: "Limits",
    meaning: "The payee is not on the allowlist, which the deploy sets and the owner changes only through the timelock.",
  },
  { name: "INSUFFICIENT_BALANCE", label: "Not enough funds", group: "Limits", meaning: "Not enough funds for the amount, or an amount of zero." },
  { name: "SWAP_FAILED", label: "Swap failed", group: "Execution", meaning: "The swap reverted, for example on slippage past the limit." },
  { name: "TRANSFER_FAILED", label: "Transfer failed", group: "Execution", meaning: "A token transfer or approval failed." },
  { name: "CREDIT_FAILED", label: "Aave call failed", group: "Credit", meaning: "An Aave call failed, or its account data couldn't be read." },
  { name: "HEALTH_FACTOR_LOW", label: "Health factor too low", group: "Credit", meaning: "The move would leave the Aave health factor under the floor." },
  {
    name: "DERISK_WINDOW",
    label: "Pre-pause safety margin",
    group: "Credit",
    meaning: "Before the feed pauses for a weekend or holiday, the target health factor applies, not just the floor.",
  },
]);
const MARKET_CLOSED = 6;

/** The 4-byte selector of each function the checks call, by canonical signature. */
export const SELECTORS = Object.freeze({
  "mandate()": "0x39b1b96d",
  "executor()": "0xc34c08e5",
  "previewIntent((bytes32,uint8,address,uint256,uint256,address,bytes32))": "0x0ee774db",
  "isOpen(uint256,uint8)": "0x3fef6f98",
  "localTime(uint256)": "0x55688aef",
  "isHoliday(uint256)": "0x7597eede",
  "earlyCloseMin(uint256)": "0xc829aa23",
  "decimals()": "0x313ce567",
});
/** MandateVault.mandate() returns the Mandate struct as 14 static words; these are the two the market check reads. */
export const MANDATE_WORDS = Object.freeze({ count: 14, sessionMode: 0, calendar: 8 });

/** MarketCalendar's OPEN_MIN, CLOSE_MIN and FEED_EDGE_MIN: minutes of the New York day. */
export const CALENDAR_MINUTES = Object.freeze({ OPEN_MIN: 570, CLOSE_MIN: 960, FEED_EDGE_MIN: 1200 });
const { OPEN_MIN, CLOSE_MIN, FEED_EDGE_MIN } = CALENDAR_MINUTES;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]; // DateLib.weekday: 0 = Sunday

export const USAGE = `maat-market-guard: ask Maat's onchain guard on Base, read-only.

  node scripts/check.mjs market  [--at <time>] [--session regular|feed] [common flags]
  node scripts/check.mjs preview --action <ACTION> [--token <symbol|address>] (--amount <decimal> | --raw <integer>)
                                 [--payee <address>] [--min-out <integer>] [--id <bytes32>] [--rationale-hash <bytes32>]
                                 [--from <address>] [common flags]
  node scripts/check.mjs reasons
  node scripts/check.mjs --help

  market    asks the MarketCalendar the vault's mandate names whether its session is open at --at (default: the
            block's time). --session overrides the mandate's session.
  preview   eth_call MandateVault.previewIntent(intent) from the vault's executor (or --from).
            ACTION: ${ACTIONS.join(", ")}.
            --amount is USDC for BUY, BORROW, REPAY and PAY_EXPENSE, and stock units for SELL, SUPPLY and
            WITHDRAW_COLLATERAL; --raw gives the onchain integer instead. Tokens: ${Object.keys(TOKENS).join(", ")} or an address.
  reasons   prints every typed reason with its id, label, group and meaning. No network.

  common flags: --block <number|latest>  --vault <address>  --rpc <url> (else $${RPC_ENV}, else ${DEFAULT_RPC})
  --at takes unix seconds or an ISO 8601 time with a zone, such as 2026-11-27T18:30:00Z.

Exit 0 = allowed or open, 1 = refused with a typed reason, 2 = no answer (bad input or RPC failure): do not trade.
`;

// ------------------------------------------------------------------ errors

/** Bad input: the check never reached the chain. */
export class UsageError extends Error {}
/** The chain gave no usable answer: a transport failure, a JSON-RPC error or data that does not decode. */
export class RpcError extends Error {}

const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 200);

// ------------------------------------------------------------------ ABI encoding (static types only)

const HEX40 = /^0x[0-9a-fA-F]{40}$/;
const HEX64 = /^0x[0-9a-fA-F]{64}$/;
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;
const ZERO_BYTES32 = `0x${"0".repeat(64)}`;

const uintWord = (n) => {
  const v = BigInt(n);
  if (v < 0n || v >= 1n << 256n) throw new UsageError(`${n} does not fit in a uint256`);
  return v.toString(16).padStart(64, "0");
};
const addressWord = (a) => a.slice(2).toLowerCase().padStart(64, "0");
const bytes32Word = (b) => b.slice(2).toLowerCase();

/**
 * Calldata for MandateVault.previewIntent(Intent). Intent is a struct of static fields only, so it encodes in place:
 * the selector, then id, action, token, amount, minOut, payee and rationaleHash as one word each.
 */
export function encodePreviewIntent(intent) {
  return (
    SELECTORS["previewIntent((bytes32,uint8,address,uint256,uint256,address,bytes32))"] +
    bytes32Word(intent.id) +
    uintWord(intent.action) +
    addressWord(intent.token) +
    uintWord(intent.amount) +
    uintWord(intent.minOut) +
    addressWord(intent.payee) +
    bytes32Word(intent.rationaleHash)
  );
}

/** The 32-byte words of an eth_call result. */
function words(hex, what) {
  if (typeof hex !== "string" || !/^0x([0-9a-fA-F]{64})+$/.test(hex)) {
    throw new RpcError(`${what} returned ${hex === "0x" ? "no data (is the address a contract?)" : "data that does not decode"}`);
  }
  return hex.slice(2).match(/.{64}/g);
}
const wordUint = (w) => BigInt(`0x${w}`);
function wordBool(w, what) {
  const v = wordUint(w);
  if (v > 1n) throw new RpcError(`${what} returned ${v}, not a bool`);
  return v === 1n;
}
function wordAddress(w, what) {
  if (!/^0{24}/.test(w)) throw new RpcError(`${what} returned a word that is not an address`);
  return `0x${w.slice(24)}`;
}

// ------------------------------------------------------------------ JSON-RPC

/**
 * A JSON-RPC transport over fetch: (method, params) => result. Its errors never quote the URL, which can carry a key.
 * `fetchImpl` is for tests.
 */
export function httpTransport(url, { fetchImpl = globalThis.fetch, timeoutMs = 15_000 } = {}) {
  let id = 0;
  return async (method, params) => {
    let res;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new RpcError(`${method}: the request failed (${e?.name === "TimeoutError" ? `no answer in ${timeoutMs} ms` : oneLine(e?.name ?? "error")})`);
    }
    if (!res.ok) throw new RpcError(`${method}: HTTP ${res.status}`);
    let body;
    try {
      body = await res.json();
    } catch {
      throw new RpcError(`${method}: the answer is not JSON`);
    }
    if (body?.error) throw new RpcError(`${method}: JSON-RPC error ${oneLine(body.error.code)}: ${oneLine(body.error.message)}`);
    if (body === null || typeof body !== "object" || !("result" in body)) throw new RpcError(`${method}: the answer has no result`);
    return body.result;
  };
}

const quantity = (n) => `0x${BigInt(n).toString(16)}`;

async function getBlock(rpc, tag) {
  const b = await rpc("eth_getBlockByNumber", [tag === "latest" ? "latest" : quantity(tag), false]);
  if (!b || typeof b.number !== "string" || typeof b.timestamp !== "string") throw new RpcError(`eth_getBlockByNumber: no block ${tag}`);
  return { number: Number(BigInt(b.number)), timestamp: Number(BigInt(b.timestamp)) };
}

async function ethCall(rpc, { from, to, data }, block, what) {
  const tx = from === undefined ? { to: to.toLowerCase(), data } : { from: from.toLowerCase(), to: to.toLowerCase(), data };
  return words(await rpc("eth_call", [tx, quantity(block.number)]), what);
}

// ------------------------------------------------------------------ input

const FLAGS = new Set(["rpc", "block", "vault", "at", "session", "action", "token", "amount", "raw", "min-out", "payee", "id", "rationale-hash", "from"]);
const COMMAND_FLAGS = {
  market: new Set(["rpc", "block", "vault", "at", "session"]),
  preview: new Set(["rpc", "block", "vault", "action", "token", "amount", "raw", "min-out", "payee", "id", "rationale-hash", "from"]),
  reasons: new Set(),
};

function address(value, flag) {
  if (!HEX40.test(value)) throw new UsageError(`--${flag} must be a 0x address of 40 hex digits, got ${JSON.stringify(value)}`);
  return value.toLowerCase();
}
function bytes32(value, flag) {
  if (!HEX64.test(value)) throw new UsageError(`--${flag} must be 0x and 64 hex digits, got ${JSON.stringify(value)}`);
  return value.toLowerCase();
}
function integer(value, flag) {
  if (!/^\d+$/.test(value)) throw new UsageError(`--${flag} must be a whole number, got ${JSON.stringify(value)}`);
  return BigInt(value);
}

/** A decimal string in units of `decimals` places, as the onchain integer. */
export function parseUnits(value, decimals, flag = "amount") {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!m) throw new UsageError(`--${flag} must be a non-negative decimal such as 5 or 0.25, got ${JSON.stringify(value)}`);
  const frac = m[2] ?? "";
  if (frac.length > decimals) throw new UsageError(`--${flag} ${value} has more decimals than the token's ${decimals}`);
  return BigInt(m[1]) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

/** Unix seconds, or an ISO 8601 time that names its zone (Z or +hh:mm), so a time never reads in the local zone. */
function time(value) {
  if (/^\d+$/.test(value)) return Number(value);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return Math.floor(ms / 1000);
  }
  throw new UsageError(`--at must be unix seconds or an ISO 8601 time with a zone (2026-11-27T18:30:00Z), got ${JSON.stringify(value)}`);
}

function token(value) {
  if (value.startsWith("0x")) {
    const a = address(value, "token");
    const symbol = Object.keys(TOKENS).find((s) => TOKENS[s].toLowerCase() === a) ?? null;
    return { address: a, symbol };
  }
  const symbol = Object.keys(TOKENS).find((s) => s.toLowerCase() === value.toLowerCase());
  if (!symbol) throw new UsageError(`--token ${value} is not one of ${Object.keys(TOKENS).join(", ")}; pass its address instead`);
  return { address: TOKENS[symbol].toLowerCase(), symbol };
}

/** argv (without node and the script) as {command, flags}. Throws UsageError. */
export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command === "--help" || command === "-h" || command === "help") return { command: "help", flags: {} };
  if (command === undefined) throw new UsageError("no command: use market, preview or reasons (--help for the flags)");
  if (!(command in COMMAND_FLAGS)) throw new UsageError(`unknown command ${JSON.stringify(command)}: use market, preview or reasons`);
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith("--")) throw new UsageError(`unexpected argument ${JSON.stringify(arg)}`);
    const eq = arg.indexOf("=");
    const name = arg.slice(2, eq < 0 ? undefined : eq);
    if (!FLAGS.has(name)) throw new UsageError(`unknown flag --${name}`);
    if (!COMMAND_FLAGS[command].has(name)) throw new UsageError(`--${name} does not apply to ${command}`);
    let value = eq < 0 ? rest[i + 1] : arg.slice(eq + 1);
    if (eq < 0) {
      if (value === undefined || value.startsWith("--")) throw new UsageError(`--${name} needs a value`);
      i++;
    }
    if (name in flags) throw new UsageError(`--${name} is given twice`);
    flags[name] = value;
  }
  return { command, flags };
}

function common(flags, env) {
  const rpc = flags.rpc ?? (env[RPC_ENV] || DEFAULT_RPC);
  let url;
  try {
    url = new URL(rpc);
  } catch {
    url = null;
  }
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) {
    throw new UsageError(`--rpc (or ${RPC_ENV}) must be an http or https URL`);
  }
  let block = "latest";
  if (flags.block !== undefined && flags.block !== "latest") {
    if (!/^(\d+|0x[0-9a-fA-F]+)$/.test(flags.block)) throw new UsageError(`--block must be latest or a block number, got ${JSON.stringify(flags.block)}`);
    block = BigInt(flags.block);
  }
  return { rpcUrl: rpc, rpcHost: url.host, block, vault: flags.vault === undefined ? ADDRESSES.MandateVault.toLowerCase() : address(flags.vault, "vault") };
}

function marketInput(flags) {
  let session = null;
  if (flags.session !== undefined) {
    const s = flags.session.toLowerCase();
    if (s === "regular") session = 0;
    else if (s === "feed" || s === "feed_24_5") session = 1;
    else throw new UsageError(`--session must be regular or feed, got ${JSON.stringify(flags.session)}`);
  }
  return { session, at: flags.at === undefined ? null : time(flags.at) };
}

function previewInput(flags) {
  if (flags.action === undefined) throw new UsageError("--action is required: one of " + ACTIONS.join(", "));
  const action = ACTIONS.find((a) => a === flags.action.toUpperCase());
  if (!action) throw new UsageError(`--action ${flags.action} is not one of ${ACTIONS.join(", ")}`);
  let tok;
  if (flags.token !== undefined) tok = token(flags.token);
  else if (USDC_TOKEN.has(action)) tok = { address: TOKENS.USDC.toLowerCase(), symbol: "USDC" };
  else throw new UsageError(`--token is required for ${action}: ${Object.keys(TOKENS).filter((s) => s !== "USDC").join(", ")} or an address`);
  if (flags.amount === undefined && flags.raw === undefined) throw new UsageError("--amount (or --raw) is required");
  if (flags.amount !== undefined && flags.raw !== undefined) throw new UsageError("give --amount or --raw, not both");
  let payee = ZERO_ADDRESS;
  if (action === "PAY_EXPENSE") {
    if (flags.payee === undefined) throw new UsageError("--payee is required for PAY_EXPENSE");
    payee = address(flags.payee, "payee");
  } else if (flags.payee !== undefined) {
    payee = address(flags.payee, "payee");
  }
  return {
    action,
    token: tok,
    // A USDC amount converts now; a stock amount needs the token's decimals from the chain.
    amount: flags.raw !== undefined ? integer(flags.raw, "raw") : USDC_AMOUNT.has(action) ? parseUnits(flags.amount, USDC_DECIMALS) : null,
    amountText: flags.amount,
    minOut: flags["min-out"] === undefined ? 0n : integer(flags["min-out"], "min-out"),
    payee,
    id: flags.id === undefined ? ZERO_BYTES32 : bytes32(flags.id, "id"),
    rationaleHash: flags["rationale-hash"] === undefined ? ZERO_BYTES32 : bytes32(flags["rationale-hash"], "rationale-hash"),
    from: flags.from === undefined ? null : address(flags.from, "from"),
  };
}

// ------------------------------------------------------------------ the checks

const hhmm = (minute) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const etDate = (etDay) => new Date(etDay * 86_400_000).toISOString().slice(0, 10);

/** Why the calendar says closed, from the same rules as MarketCalendar.isOpen. */
function closedBecause(session, { holiday, weekday, minute, earlyCloseMin }) {
  if (holiday) return "holiday";
  if (session === 0) {
    if (weekday === 0 || weekday === 6) return "weekend";
    if (minute < OPEN_MIN) return "before-open";
    if (minute >= CLOSE_MIN) return "after-close";
    if (earlyCloseMin !== 0 && minute >= earlyCloseMin) return "early-close";
    return "closed";
  }
  if (weekday === 6 || (weekday === 0 && minute < FEED_EDGE_MIN) || (weekday === 5 && minute >= FEED_EDGE_MIN)) return "weekend";
  return "closed";
}

async function market(rpc, c, input) {
  const block = await getBlock(rpc, c.block);
  const m = await ethCall(rpc, { to: c.vault, data: SELECTORS["mandate()"] }, block, "MandateVault.mandate()");
  if (m.length < MANDATE_WORDS.count) throw new RpcError("MandateVault.mandate() returned too few words");
  const mandateSession = Number(wordUint(m[MANDATE_WORDS.sessionMode]));
  if (SESSIONS[mandateSession] === undefined) throw new RpcError(`MandateVault.mandate() has an unknown session mode ${mandateSession}`);
  const calendar = wordAddress(m[MANDATE_WORDS.calendar], "MandateVault.mandate()");
  const session = input.session ?? mandateSession;
  const ts = input.at ?? block.timestamp;
  const [openWords, local] = await Promise.all([
    ethCall(rpc, { to: calendar, data: SELECTORS["isOpen(uint256,uint8)"] + uintWord(ts) + uintWord(session) }, block, "MarketCalendar.isOpen"),
    ethCall(rpc, { to: calendar, data: SELECTORS["localTime(uint256)"] + uintWord(ts) }, block, "MarketCalendar.localTime"),
  ]);
  const open = wordBool(openWords[0], "MarketCalendar.isOpen");
  if (local.length < 3) throw new RpcError("MarketCalendar.localTime returned too few words");
  const etDay = wordUint(local[0]);
  const weekday = Number(wordUint(local[1]));
  const minute = Number(wordUint(local[2]));
  const [holidayWords, earlyWords] = await Promise.all([
    ethCall(rpc, { to: calendar, data: SELECTORS["isHoliday(uint256)"] + uintWord(etDay) }, block, "MarketCalendar.isHoliday"),
    ethCall(rpc, { to: calendar, data: SELECTORS["earlyCloseMin(uint256)"] + uintWord(etDay) }, block, "MarketCalendar.earlyCloseMin"),
  ]);
  const holiday = wordBool(holidayWords[0], "MarketCalendar.isHoliday");
  const earlyCloseMin = Number(wordUint(earlyWords[0]));
  const reason = open ? 0 : MARKET_CLOSED;
  return {
    check: "market",
    allowed: open,
    open,
    reason,
    reasonName: REASONS[reason].name,
    meaning: open
      ? "The session is open on the vault's calendar. The vault's other checks still apply: run preview for a verdict on one intent."
      : REASONS[MARKET_CLOSED].meaning,
    closedBecause: open ? null : closedBecause(session, { holiday, weekday, minute, earlyCloseMin }),
    session: SESSIONS[session],
    at: { unix: ts, utc: new Date(ts * 1000).toISOString(), et: `${etDate(Number(etDay))} ${hhmm(minute)}`, weekday: WEEKDAYS[weekday] ?? String(weekday) },
    holiday,
    earlyClose: earlyCloseMin === 0 ? null : hhmm(earlyCloseMin),
    calendar,
    vault: c.vault,
    block,
  };
}

async function preview(rpc, c, input) {
  const block = await getBlock(rpc, c.block);
  const from =
    input.from ?? wordAddress((await ethCall(rpc, { to: c.vault, data: SELECTORS["executor()"] }, block, "MandateVault.executor()"))[0], "MandateVault.executor()");
  let amount = input.amount;
  if (amount === null) {
    const d = Number(wordUint((await ethCall(rpc, { to: input.token.address, data: SELECTORS["decimals()"] }, block, `${input.token.symbol ?? input.token.address}.decimals()`))[0]));
    amount = parseUnits(input.amountText, d);
  }
  const intent = {
    id: input.id,
    action: ACTIONS.indexOf(input.action),
    token: input.token.address,
    amount,
    minOut: input.minOut,
    payee: input.payee,
    rationaleHash: input.rationaleHash,
  };
  const out = await ethCall(rpc, { from, to: c.vault, data: encodePreviewIntent(intent) }, block, "MandateVault.previewIntent");
  const id = wordUint(out[0]);
  const r = REASONS[Number(id)];
  if (id >= BigInt(REASONS.length) || r === undefined) throw new RpcError(`MandateVault.previewIntent returned an unknown reason id ${id}`);
  return {
    check: "preview",
    allowed: id === 0n,
    reason: Number(id),
    reasonName: r.name,
    label: r.label,
    group: r.group,
    meaning: r.meaning,
    intent: {
      id: intent.id,
      action: input.action,
      actionId: intent.action,
      token: intent.token,
      symbol: input.token.symbol,
      amount: String(intent.amount),
      minOut: String(intent.minOut),
      payee: intent.payee,
      rationaleHash: intent.rationaleHash,
    },
    from,
    vault: c.vault,
    block,
  };
}

const noAnswer = (command, error, rpcHost) => ({
  check: command,
  allowed: false,
  reason: null,
  reasonName: "UNKNOWN",
  error,
  ...(rpcHost === undefined ? {} : { rpc: rpcHost }),
});

/**
 * Runs one command. Resolves to {exitCode, result} (the JSON to print) or {exitCode, text} for --help.
 * `transport` replaces the HTTP transport (the selftest passes recorded answers); `env` replaces process.env.
 */
export async function check(argv, { transport, env = process.env } = {}) {
  let parsed;
  let c;
  let input;
  try {
    parsed = parseArgs(argv);
    if (parsed.command === "help") return { exitCode: 0, text: USAGE };
    if (parsed.command === "reasons") {
      return { exitCode: 0, result: { check: "reasons", reasons: REASONS.map((r, id) => ({ id, ...r })) } };
    }
    c = common(parsed.flags, env);
    input = parsed.command === "market" ? marketInput(parsed.flags) : previewInput(parsed.flags);
  } catch (e) {
    if (e instanceof UsageError) return { exitCode: 2, result: noAnswer(parsed?.command ?? argv[0] ?? null, e.message) };
    throw e;
  }
  const rpc = transport ?? httpTransport(c.rpcUrl);
  try {
    const result = parsed.command === "market" ? await market(rpc, c, input) : await preview(rpc, c, input);
    return { exitCode: result.allowed ? 0 : 1, result: { ...result, rpc: c.rpcHost } };
  } catch (e) {
    if (e instanceof RpcError || e instanceof UsageError) return { exitCode: 2, result: noAnswer(parsed.command, e.message, c.rpcHost) };
    throw e;
  }
}

// ------------------------------------------------------------------ CLI

const invoked = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  let out;
  try {
    out = await check(process.argv.slice(2));
  } catch (e) {
    out = { exitCode: 2, result: noAnswer(process.argv[2] ?? null, `internal error: ${oneLine(e?.message ?? e)}`) };
  }
  process.stdout.write(out.text ?? `${JSON.stringify(out.result, null, 2)}\n`);
  process.exitCode = out.exitCode;
}
