// Beats 5 to 7 show transactions by hash, from film/txs.json. A hash that is not set yet becomes a card labelled
// PLACEHOLDER; a set hash becomes the tx as text, read from its receipt, beside a Basescan link card. A set hash whose
// receipt cannot be read, or does not show what txs.json expects, stops the render: no row is ever made up.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CAPTION_BAND, documentHtml, esc, shortHex } from "./cards.mjs";

/** keccak256 of each event's signature; web/test/film-txcards.test.ts checks both against the contracts. */
export const DECISION_TOPIC = "0x31e6f801fe8c4e61fff662a75a05831c8f1341359c56a18463b2a33bfa2df322";
export const BRIEF_TOPIC = "0x6990c09d9f6bf654815df468a70bea4545776ea2b7316f7340b23b30e1d45936";

/** enum Action and enum Reason in contracts/src/Types.sol, in order. */
export const ACTIONS = Object.freeze(["BUY", "SELL", "SUPPLY", "WITHDRAW_COLLATERAL", "BORROW", "REPAY", "PAY_EXPENSE"]);
export const REASON_CODES = Object.freeze([
  "OK",
  "VAULT_PAUSED",
  "ACTION_NOT_SUPPORTED",
  "TOKEN_NOT_ALLOWED",
  "TOKEN_PAUSED",
  "POLICY_BLOCKED",
  "MARKET_CLOSED",
  "FEED_STALE",
  "BAD_PRICE",
  "MULTIPLIER_COOLDOWN",
  "PREMIUM_TOO_HIGH",
  "SIZE_LIMIT",
  "CONCENTRATION",
  "PAYEE_NOT_ALLOWED",
  "INSUFFICIENT_BALANCE",
  "SWAP_FAILED",
  "TRANSFER_FAILED",
  "CREDIT_FAILED",
  "HEALTH_FACTOR_LOW",
  "DERISK_WINDOW",
]);
/** The site's plain label for each reason (web/content/reasons.ts REASON_LABEL). */
export const REASON_LABELS = Object.freeze({
  OK: "All checks passed",
  VAULT_PAUSED: "Vault paused",
  ACTION_NOT_SUPPORTED: "Credit not enabled",
  TOKEN_NOT_ALLOWED: "Token not allowed",
  TOKEN_PAUSED: "Token paused",
  POLICY_BLOCKED: "Blocked by token policy",
  MARKET_CLOSED: "Market closed",
  FEED_STALE: "Price feed out of date",
  BAD_PRICE: "Bad price data",
  MULTIPLIER_COOLDOWN: "Corporate action cooldown",
  PREMIUM_TOO_HIGH: "Pool price too far from oracle",
  SIZE_LIMIT: "Over the size limit",
  CONCENTRATION: "Too much in one stock",
  PAYEE_NOT_ALLOWED: "Payee not approved",
  INSUFFICIENT_BALANCE: "Not enough funds",
  SWAP_FAILED: "Swap failed",
  TRANSFER_FAILED: "Transfer failed",
  CREDIT_FAILED: "Aave call failed",
  HEALTH_FACTOR_LOW: "Health factor too low",
  DERISK_WINDOW: "Pre-pause safety margin",
});
/** Actions whose amount is USDC with 6 decimals (as web/lib/chain/ledger.ts reads them). */
const USDC_AMOUNT = new Set(["BUY", "BORROW", "REPAY", "PAY_EXPENSE"]);

/** film/txs.json, checked for shape. */
export function readTxConfig(root) {
  const config = JSON.parse(readFileSync(join(root, "film/txs.json"), "utf8"));
  for (const [key, entry] of Object.entries(config.txs ?? {})) {
    if (entry.hash !== null && !/^0x[0-9a-fA-F]{64}$/.test(entry.hash)) throw new Error(`film/txs.json ${key}: hash must be null or a 0x tx hash`);
    for (const field of ["etBefore", "etFrom"]) {
      const v = entry.expect?.[field];
      if (v !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new Error(`film/txs.json ${key}: expect.${field} must be a New York time like 13:00`);
    }
  }
  return config;
}

/** The B20 stocks of web/content/generated/base-addresses.json, lowercased address → symbol ("NVDAC" → "NVDAc"). */
export function tokenSymbols(baseAddresses) {
  return Object.fromEntries(
    baseAddresses.filter((a) => a.type === "address" && /^0xb2/i.test(a.value) && /C$/.test(a.name)).map((a) => [a.value.toLowerCase(), `${a.name.slice(0, -1)}c`]),
  );
}

const word = (data, i) => data.slice(2 + i * 64, 2 + (i + 1) * 64);
const addressOf = (topic) => `0x${topic.slice(-40)}`;

/** A Decision or Brief log, decoded, with the address that emitted it (lowercased); null for any other log. */
export function decodeLog(log) {
  const topic = log.topics?.[0];
  const address = log.address?.toLowerCase();
  if (topic === DECISION_TOPIC) {
    const d = log.data;
    return {
      event: "Decision",
      address,
      intentId: log.topics[1],
      token: addressOf(log.topics[2]),
      action: ACTIONS[Number(BigInt(`0x${word(d, 0)}`))] ?? `action ${BigInt(`0x${word(d, 0)}`)}`,
      amount: BigInt(`0x${word(d, 1)}`),
      allowed: BigInt(`0x${word(d, 2)}`) === 1n,
      reason: REASON_CODES[Number(BigInt(`0x${word(d, 3)}`))] ?? `reason ${BigInt(`0x${word(d, 3)}`)}`,
      rationaleHash: `0x${word(log.data, 4)}`,
    };
  }
  if (topic === BRIEF_TOPIC) {
    const d = log.data;
    const offset = Number(BigInt(`0x${word(d, 0)}`)) / 32;
    const length = Number(BigInt(`0x${word(d, offset)}`));
    const hex = d.slice(2 + (offset + 1) * 64, 2 + (offset + 1) * 64 + length * 2);
    return { event: "Brief", address, id: BigInt(log.topics[1]), from: addressOf(log.topics[2]), text: Buffer.from(hex, "hex").toString("utf8") };
  }
  return null;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A block time in New York: its date ("2026-11-24"), its time ("09:28") and the site's label ("Tue 24 Nov 09:28 ET"). */
export function etTime(ts) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(ts * 1000))
      .map((p) => [p.type, p.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}`;
  const day = new Date(`${date}T12:00:00Z`);
  return { date, time, label: `${DAYS[day.getUTCDay()]} ${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]} ${time} ET` };
}

const usd6 = (n) => `$${(Number(n) / 1e6).toFixed(2)}`;

/**
 * The card model of one tx entry of film/txs.json. `data` is { receipt, block } from lib/rpc.mjs; with no hash it is
 * not needed, and with a hash it must be there. `ctx` names tokens and contracts by lowercased address.
 */
export function txCardModel(key, entry, data, ctx = { tokens: {}, contracts: {} }) {
  if (entry.hash === null || entry.hash === undefined) return { kind: "placeholder", key, label: entry.label };
  if (!data?.receipt || !data.block) throw new Error(`${key}: no receipt for ${entry.hash}; the render does not show a tx it could not read`);
  const { receipt, block } = data;
  const when = etTime(Number(block.timestamp));
  const name = (addr) => ctx.contracts?.[addr.toLowerCase()] ?? shortHex(addr);
  const events = receipt.logs.map(decodeLog).filter(Boolean);
  const rows = [
    { k: "Transaction", v: receipt.transactionHash },
    { k: "Block", v: `${Number(receipt.blockNumber).toLocaleString("en-US")} · ${when.label}` },
    { k: "From", v: `${shortHex(receipt.from)} to ${name(receipt.to)}` },
  ];
  if (receipt.status !== "0x1") rows.push({ k: "Status", v: "reverted" });
  for (const e of events) {
    if (e.event === "Decision") {
      const symbol = ctx.tokens?.[e.token.toLowerCase()] ?? shortHex(e.token);
      const amount = USDC_AMOUNT.has(e.action) ? usd6(e.amount) : `${e.amount} raw ${symbol}`;
      rows.push({ k: "Intent", v: `${e.action} ${symbol} · ${amount}` });
      rows.push({ k: "Verdict", v: `${e.allowed ? "Allowed" : "Refused"} · ${REASON_LABELS[e.reason] ?? e.reason} (${e.reason})`, tone: e.allowed ? "ok" : "no" });
    } else if (e.event === "Brief") {
      rows.push({ k: "Brief", v: `#${e.id} from ${shortHex(e.from)}: “${e.text}”` });
    }
  }
  return {
    kind: "tx",
    key,
    label: entry.label,
    hash: receipt.transactionHash,
    url: `https://basescan.org/tx/${receipt.transactionHash}`,
    date: when.date,
    time: when.time,
    status: receipt.status,
    events,
    rows,
  };
}

/**
 * Why a tx model does not show what its entry expects, one line each; [] when it does. `expect` may name the event,
 * the contract that must emit it (by its name in `contracts`, lowercased address → name from deployments/README.md),
 * the vault's reason, the New York date, and a New York time the tx must come before (etBefore) or at or after (etFrom).
 */
export function txProblems(model, expect, contracts = {}) {
  if (model.kind !== "tx") return [];
  const out = [];
  if (model.status !== "0x1") out.push(`${model.key}: the tx reverted`);
  const named = model.events.filter((e) => e.event === expect.event);
  const event = expect.contract ? named.find((e) => contracts[e.address ?? ""] === expect.contract) : named[0];
  if (named.length === 0) out.push(`${model.key}: the receipt has no ${expect.event} event`);
  else if (!event) {
    const from = named[0].address ? (contracts[named[0].address] ?? shortHex(named[0].address)) : "an unnamed address";
    out.push(`${model.key}: its ${expect.event} event comes from ${from}, not the ${expect.contract} of deployments/README.md`);
  } else if (expect.reason && event.reason !== expect.reason) out.push(`${model.key}: the vault answered ${event.reason}, not ${expect.reason}`);
  if (expect.etDate && model.date !== expect.etDate) out.push(`${model.key}: the tx is on ${model.date} ET, not ${expect.etDate}`);
  if (expect.etBefore && !(model.time < expect.etBefore)) out.push(`${model.key}: the tx is at ${model.time} ET, not before ${expect.etBefore}`);
  if (expect.etFrom && model.time < expect.etFrom) out.push(`${model.key}: the tx is at ${model.time} ET, before ${expect.etFrom}`);
  return out;
}

/**
 * One card holding the beat's txs: each a placeholder block, or its rows as text with a link card. The stack is centred
 * in the frame above the caption band, so the caption burned in over the card never covers a row.
 * @param {any[]} models
 * @param {{ format: string, title: string, fontsDir?: string }} options
 */
export function txCardHtml(models, { format, title, fontsDir }) {
  const wide = format === "wide";
  const css = `.frame{padding:${wide ? 48 : 32}px ${wide ? 140 : 22}px ${CAPTION_BAND[format]}px;justify-content:safe center;gap:${wide ? 28 : 14}px}
.eyebrow{font-size:${wide ? 22 : 12}px}
h2{font-size:${wide ? 52 : 26}px;font-weight:600;letter-spacing:-.02em}
.txs{display:flex;flex-direction:column;gap:${wide ? 24 : 12}px}
.tx{border:1px solid var(--line);border-radius:${wide ? 18 : 12}px;padding:${wide ? "22px 28px" : "12px 14px"};display:grid;grid-template-columns:${wide ? "minmax(0,1fr) 440px" : "1fr"};gap:${wide ? 28 : 10}px;background:#fff}
.label{font-size:${wide ? 26 : 14}px;font-weight:600;margin-bottom:${wide ? 10 : 6}px}
dl{display:grid;grid-template-columns:${wide ? "170px 1fr" : "78px 1fr"};row-gap:${wide ? 6 : 3}px;font-size:${wide ? 21 : 11}px}
dt{color:var(--ink2)}
dd{font-family:"Geist Mono",ui-monospace,monospace;overflow-wrap:anywhere}
dd.ok{color:var(--accent);font-weight:600}
dd.no{color:var(--refuse);font-weight:600}
.link-card{align-self:center;border-radius:${wide ? 14 : 10}px;background:var(--soft);border:1px solid var(--line);padding:${wide ? 22 : 10}px;display:flex;flex-direction:column;gap:${wide ? 8 : 4}px}
.link-card b{font-size:${wide ? 24 : 13}px}
.link-card span{font-family:"Geist Mono",ui-monospace,monospace;font-size:${wide ? 16 : 9}px;color:var(--accent);overflow-wrap:anywhere}
.placeholder{padding:${wide ? "34px 30px" : "16px 14px"};display:flex;flex-direction:column;gap:${wide ? 12 : 6}px}
.placeholder .tag{font-size:${wide ? 22 : 12}px;padding:${wide ? "4px 12px" : "2px 6px"};align-self:flex-start}
.placeholder p{font-size:${wide ? 24 : 13}px;color:var(--ink2)}`;
  const block = (m) => {
    if (m.kind === "placeholder") {
      return `<div class="placeholder"><span class="tag ph">PLACEHOLDER</span><div class="label">${esc(m.label)}</div><p>This transaction is not on Base yet. The film shows it once its hash is in film/txs.json.</p></div>`;
    }
    const dl = m.rows.map((r) => `<dt>${esc(r.k)}</dt><dd${r.tone ? ` class="${r.tone}"` : ""}>${esc(r.v)}</dd>`).join("");
    return `<div class="tx"><div><div class="label">${esc(m.label)}</div><dl>${dl}</dl></div><div class="link-card"><b>Open on Basescan ↗</b><span>${esc(m.url.replace(/^https:\/\//, ""))}</span></div></div>`;
  };
  return documentHtml({
    format,
    fontsDir,
    css,
    body: `<div class="frame"><div class="eyebrow">Base mainnet</div><h2>${esc(title)}</h2><div class="txs">${models.map(block).join("")}</div></div>`,
  });
}
