// Beats 5 to 7 show transactions by hash, from film/txs.json. A hash that is not set yet becomes a card labelled
// PLACEHOLDER; a set hash becomes the tx as text, read from its receipt, beside a Basescan link card. A set hash whose
// receipt cannot be read, or does not show what txs.json expects, stops the render: no row is ever made up.

import { readFileSync } from "node:fs";
import { join } from "node:path";
// The site's own decoder of an execute call's calldata and its maat:v1 blob (Node.js 24 strips its types on import).
import { decodeExecuteInput } from "../../web/lib/chain/rationale.ts";
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
/**
 * A brief as /ask shows it (web/lib/chain/inbox.ts plainBriefText): every control, format and other invisible code
 * point as U+FFFD, so a brief cannot hide text, smuggle ASCII in tag characters or reorder what a reader sees.
 * web/test/film-identity.test.ts holds the two to the same output.
 */
const UNSAFE = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;
export const plainText = (/** @type {string} */ text) => String(text).replace(UNSAFE, "�");

/** Actions whose amount is USDC with 6 decimals (as web/lib/chain/ledger.ts reads them). */
const USDC_AMOUNT = new Set(["BUY", "BORROW", "REPAY", "PAY_EXPENSE"]);

/**
 * Who sent a tx, as the film names it. A Decision takes /ledger's sender label (web/lib/chain/ledger.ts senderLabel,
 * which web/test/film-txcards.test.ts holds this to): "owner, by hand" when the vault's owner sent it, "probe" when its
 * maat:v1 blob says k = "probe" (a fixed-time intent that no Claude call wrote, agent/src/probes.ts), "brief-driven"
 * when the blob adopts a brief (q), and "agent" otherwise. A Brief is "team" when a team wallet sent it (the /proof
 * team list or the vault's owner) and "outside" otherwise.
 */
export const SENDERS = Object.freeze({ Decision: Object.freeze(["agent", "probe", "brief-driven", "owner, by hand"]), Brief: Object.freeze(["outside", "team"]) });

/** /ledger's sender label of a direct execute call to the vault; `blob` is decodeExecuteInput's blob. */
export function senderLabel(/** @type {string} */ from, /** @type {string} */ owner, /** @type {any} */ blob) {
  if (from.toLowerCase() === owner.toLowerCase()) return "owner, by hand";
  if (blob.status === "v1" && blob.fields.k === "probe") return "probe";
  if (blob.status === "v1" && blob.fields.q !== undefined) return "brief-driven";
  return "agent";
}

/** film/txs.json, checked for shape. Every entry names who must have sent its tx (expect.sender, one of SENDERS). */
export function readTxConfig(root) {
  const config = JSON.parse(readFileSync(join(root, "film/txs.json"), "utf8"));
  for (const [key, entry] of Object.entries(config.txs ?? {})) {
    if (entry.hash !== null && !/^0x[0-9a-fA-F]{64}$/.test(entry.hash)) throw new Error(`film/txs.json ${key}: hash must be null or a 0x tx hash`);
    const senders = SENDERS[entry.expect?.event] ?? [];
    if (!senders.includes(entry.expect?.sender)) throw new Error(`film/txs.json ${key}: expect.sender must be one of ${senders.map((s) => `"${s}"`).join(", ")}`);
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
    // The log index, with the tx hash and the id, is how the agent's journal names the brief it answered.
    const logIndex = log.logIndex === undefined ? undefined : Number(BigInt(log.logIndex));
    return { event: "Brief", address, id: BigInt(log.topics[1]), from: addressOf(log.topics[2]), text: Buffer.from(hex, "hex").toString("utf8"), logIndex };
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
      rows.push({ k: "Brief", v: `#${e.id} from ${shortHex(e.from)}: “${plainText(e.text)}”` });
    }
  }
  return {
    kind: "tx",
    key,
    label: entry.label,
    hash: receipt.transactionHash,
    url: `https://basescan.org/tx/${receipt.transactionHash}`,
    // Who sent it, to which address, and in which block: beat 7 checks its pair with them (persuasionProblems).
    from: String(receipt.from).toLowerCase(),
    to: receipt.to ? String(receipt.to).toLowerCase() : null,
    block: Number(receipt.blockNumber),
    date: when.date,
    time: when.time,
    status: receipt.status,
    events,
    rows,
  };
}

/**
 * Who sent a tx model's `event`, as SENDERS names it, or why the film cannot say. `who` holds the tx's calldata
 * (`input`, read with lib/rpc.mjs fetchInput), the vault's owner() (`owner`) and the /proof team list (`team`). A
 * Decision's label counts only for a direct execute call to the vault (through another contract, tx.from says nothing
 * about who sent the intent), and, unless the owner sent it, only when its maat:v1 blob hashes to the Decision's
 * rationaleHash: a label read from a blob the vault did not record would be made up.
 * @param {any} model @param {any} event @param {{ input?: string, owner?: string, team?: string[] } | undefined} who
 * @returns {{ label: string } | { why: string }}
 */
export function txSender(model, event, who) {
  if (typeof who?.owner !== "string") return { why: "the vault's owner() was not read, so the film cannot say who sent it" };
  const owner = lower(who.owner);
  if (event.event === "Brief") {
    const team = new Set([...(who.team ?? []).map(lower), owner]);
    return { label: team.has(lower(event.from)) ? "team" : "outside" };
  }
  if (typeof who.input !== "string") return { why: "its calldata was not read, so the film cannot say who sent it" };
  if (model.to !== event.address) return { why: "its tx is not a direct execute call to MandateVault, so its sender does not say who sent the intent" };
  const call = decodeExecuteInput(/** @type {`0x${string}`} */ (who.input));
  if (call === null) return { why: "its calldata is not an execute call to MandateVault" };
  const label = senderLabel(model.from, owner, call.blob);
  if (label !== "owner, by hand" && (call.blob.status !== "v1" || lower(call.blobHash) !== lower(event.rationaleHash))) {
    return { why: `its calldata carries no maat:v1 blob that hashes to the Decision's rationaleHash (${call.blob.status}), so nothing says who wrote the intent` };
  }
  return { label };
}

/**
 * Why a tx model does not show what its entry expects, one line each; [] when it does. `expect` may name the event,
 * the contract that must emit it (by its name in `contracts`, lowercased address → name from deployments/README.md),
 * the vault's reason, who sent it (`sender`, one of SENDERS, checked with `who`: see txSender), the New York date, and
 * a New York time the tx must come before (etBefore) or at or after (etFrom).
 * @param {any} model @param {any} expect @param {Record<string, string>} [contracts]
 * @param {{ input?: string, owner?: string, team?: string[] }} [who]
 */
export function txProblems(model, expect, contracts = {}, who = undefined) {
  if (model.kind !== "tx") return [];
  const out = [];
  if (model.status !== "0x1") out.push(`${model.key}: the tx reverted`);
  const named = model.events.filter((e) => e.event === expect.event);
  const event = expect.contract ? named.find((e) => contracts[e.address ?? ""] === expect.contract) : named[0];
  if (named.length === 0) out.push(`${model.key}: the receipt has no ${expect.event} event`);
  else if (!event) {
    const from = named[0].address ? (contracts[named[0].address] ?? shortHex(named[0].address)) : "an unnamed address";
    out.push(`${model.key}: its ${expect.event} event comes from ${from}, not the ${expect.contract} of deployments/README.md`);
  } else {
    if (expect.reason && event.reason !== expect.reason) out.push(`${model.key}: the vault answered ${event.reason}, not ${expect.reason}`);
    if (expect.sender) {
      const sent = txSender(model, event, who);
      if ("why" in sent) out.push(`${model.key}: ${sent.why}`);
      else if (sent.label !== expect.sender) out.push(`${model.key}: it was sent as "${sent.label}", not "${expect.sender}"`);
    }
  }
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
      return `<div class="placeholder"><span class="tag ph">PLACEHOLDER</span><div class="label">${esc(m.label)}</div><p>This transaction is not on Base yet.</p></div>`;
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

/**
 * The persuasion beat's pair: the tx whose receipt holds the Brief, and the tx whose receipt holds the vault's
 * Decision, each with that event. Throws when the pair is not one of each.
 * @param {any[]} models
 */
export function persuasionParts(models) {
  /** @param {string} event @param {string} key */
  const find = (event, key) => {
    for (const m of models) {
      const e = m.kind === "tx" ? m.events.find((/** @type {any} */ x) => x.event === event) : undefined;
      if (e) return { model: m, event: e };
    }
    throw new Error(`the persuasion beat needs a ${event} tx: ${key} in film/txs.json must name a tx whose receipt holds one`);
  };
  return { brief: find("Brief", "strangerBrief"), verdict: find("Decision", "vaultAnswer") };
}

/** "0123456789abcdef…" (a journal row's commit, the agent code's) as "0123456", keeping a "-dirty" suffix. */
const shortCommit = (c) => String(c).replace(/^([0-9a-f]{7})[0-9a-f]{33}/, "$1");

/** Beat 7's middle step: Maat's agent's reply as the journal holds it, or a labelled line saying it is not there yet. */
function replyStep(reply) {
  if (reply?.kind !== "reply") {
    return `<li class="step"><div class="k">${esc("2 · Maat's agent's reply")}</div><div class="missing"><span class="tag ph">NOT IN THE JOURNAL YET</span><p>${esc(
      "Maat's agent's reply to this brief is not in the published journal yet. The film shows it once the agent-journal branch holds its row.",
    )}</p></div></li>`;
  }
  // The row's commit is the git commit of the agent code that wrote the row (agent/src/ledger/journal.ts), which
  // /ledger labels "Agent commit"; the row itself is named by its day file, line and hash.
  const at = [`${reply.file} line ${reply.line}`, `row ${shortHex(reply.hash)}`, ...(reply.commit ? [`agent commit ${shortCommit(reply.commit)}`] : [])];
  const persuaded = reply.outcome === "skipped" ? [] : [`Claude persuaded: ${reply.adopted ? "yes, adopted into an intent" : "no"}`];
  const src = `<div class="src mono">${esc([...persuaded, ...at].join(" · "))}</div>`;
  if (reply.outcome === "replied") return `<li class="step"><div class="k">${esc("2 · Maat's agent replied")}</div><blockquote dir="auto">${esc(`“${plainText(reply.text)}”`)}</blockquote>${src}</li>`;
  return `<li class="step"><div class="k">${esc("2 · Maat's agent")}</div><p class="said">${esc(replySaid(reply))}</p>${src}</li>`;
}

/** What the reply step says of a journal row in which Claude gave no reply. */
const replySaid = (/** @type {any} */ reply) =>
  reply.outcome === "unanswered" ? "Sent to Claude, which gave no reply." : `Not sent to Claude: a daily cap was reached (${reply.cap}).`;

/** The verdict in the verdict grammar: "Refused · Market closed (MARKET_CLOSED)". */
const verdictLine = (/** @type {any} */ e) => `${e.allowed ? "Allowed" : "Refused"} · ${REASON_LABELS[e.reason] ?? e.reason} (${e.reason})`;

const lower = (/** @type {unknown} */ a) => String(a ?? "").toLowerCase();

/**
 * Why beat 7's pair is not an outside wallet's brief and the vault's verdict on Maat's agent's answer to it, one line
 * each; [] when it is. The vaultAnswer Decision must be a direct execute call to the vault, which only the vault's
 * executor can make, not sent by its owner, whose maat:v1 blob hashes to the Decision's rationaleHash and adopts the
 * brief by its id (q), in a block after the brief's: /ledger's "brief-driven" sender label, and /ask's brief-to-Decision
 * map. The brief must not come from a team wallet: the /proof team list (web/content/proof-team.ts), the vault's owner,
 * or the executor that sent the Decision. A journal row for the brief must say an intent adopted it. `input` is the
 * Decision's calldata, `owner` the vault's owner(), `team` the team list's addresses, `reply` a lib/journal.mjs
 * briefReply model.
 * @param {any[]} models
 * @param {{ input?: string, owner?: string, team?: string[], reply?: any }} [answer]
 */
export function persuasionProblems(models, { input, owner, team = [], reply } = {}) {
  const { brief, verdict } = persuasionParts(models);
  const id = Number(brief.event.id);
  const sender = lower(brief.event.from);
  const executor = verdict.model.from;
  const out = [];
  if (new Set([...team.map(lower), lower(owner), executor]).has(sender)) out.push(`strangerBrief: brief #${id} comes from ${shortHex(sender)}, a team wallet, not an outside one`);
  const call = verdict.model.to === verdict.event.address ? decodeExecuteInput(/** @type {`0x${string}`} */ (input ?? "0x")) : null;
  if (call === null) out.push("vaultAnswer: its tx is not a direct execute call to MandateVault, so its sender does not say who sent the intent");
  else {
    if (executor === lower(owner)) out.push(`vaultAnswer: the vault's owner ${shortHex(executor)} sent it (owner, by hand), so it is not Maat's agent's answer`);
    if (call.blob.status !== "v1") out.push(`vaultAnswer: its calldata carries no maat:v1 blob (${call.blob.status}), so nothing ties it to brief #${id}`);
    else {
      if (lower(call.blobHash) !== lower(verdict.event.rationaleHash)) out.push("vaultAnswer: keccak256 of its blob is not the Decision's rationaleHash, so the vault did not record that blob");
      const q = call.blob.fields.q ?? [];
      if (!q.includes(id)) out.push(`vaultAnswer: its blob adopts ${q.length === 0 ? "no brief" : `brief ${q.join(", ")}`}, not brief #${id}`);
    }
  }
  const at = (/** @type {number} */ n) => n.toLocaleString("en-US");
  if (!(verdict.model.block > brief.model.block)) out.push(`vaultAnswer: its block ${at(verdict.model.block)} is not after the brief's block ${at(brief.model.block)}`);
  if (reply?.kind === "reply" && reply.adopted !== true) {
    out.push(`the journal's row for brief #${id} (${reply.file} line ${reply.line}) says no intent adopted it, but vaultAnswer's blob adopts it`);
  }
  return out;
}

/** The words beat 7's card asks a viewer to read, in order: the brief, what Maat's agent said, the verdict. */
export function persuasionReading(/** @type {any[]} */ models, /** @type {any} */ reply) {
  const { brief, verdict } = persuasionParts(models);
  const said = reply?.kind !== "reply" ? [] : reply.outcome === "replied" ? [plainText(reply.text)] : [replySaid(reply)];
  return [plainText(brief.event.text), ...said, verdictLine(verdict.event)];
}

/**
 * Beat 7 once both of its txs are on Base: the brief as /ask shows it, then Maat's agent's reply from the published
 * journal (or a labelled line while the journal has none), then the vault's verdict on the intent that adopted the
 * brief, with its Basescan link card. While either tx is a placeholder it is the beat's placeholder card (txCardHtml).
 * `reply` is a lib/journal.mjs briefReply model, and `answer` what persuasionProblems checks the pair with: the card
 * stops on any problem it finds, so it never calls a Decision the answer to a brief it does not answer.
 * @param {any[]} models
 * @param {{ format: string, title: string, fontsDir?: string, reply?: any, answer?: { input: string, owner: string, team: string[] } }} options
 */
export function persuasionCardHtml(models, { format, title, fontsDir, reply, answer }) {
  if (models.some((m) => m.kind !== "tx")) return txCardHtml(models, { format, title, fontsDir });
  const { brief, verdict } = persuasionParts(models);
  if (typeof answer?.input !== "string" || typeof answer.owner !== "string") {
    throw new Error("beat 7's card needs the Decision's calldata and the vault's owner to check that the Decision answers the brief (lib/rpc.mjs fetchInput and fetchOwner)");
  }
  const problems = persuasionProblems(models, { ...answer, reply });
  if (problems.length > 0) throw new Error(`beat 7 would not show the vault's verdict on Maat's agent's answer to an outside brief: ${problems.join("; ")}`);
  const wide = format === "wide";
  const row = (/** @type {any} */ m, /** @type {string} */ k) => m.rows.find((/** @type {any} */ r) => r.k === k)?.v ?? "";
  const css = `.frame{padding:${wide ? 44 : 30}px ${wide ? 140 : 22}px ${CAPTION_BAND[format]}px;justify-content:safe center;gap:${wide ? 22 : 12}px}
.eyebrow{font-size:${wide ? 22 : 12}px}
h2{font-size:${wide ? 48 : 24}px;font-weight:600;letter-spacing:-.02em}
.steps{list-style:none;display:flex;flex-direction:column;gap:${wide ? 16 : 8}px}
.step{border:1px solid var(--line);border-radius:${wide ? 16 : 10}px;padding:${wide ? "16px 26px" : "9px 12px"};background:#fff;display:flex;flex-direction:column;gap:${wide ? 8 : 4}px;min-width:0}
.k{font-family:"Geist Mono",ui-monospace,monospace;font-size:${wide ? 17 : 10}px;letter-spacing:.02em;color:var(--ink2);overflow-wrap:anywhere}
blockquote,.said{font-size:${wide ? 24 : 13}px;line-height:1.35;overflow-wrap:anywhere}
.src{font-size:${wide ? 15 : 9}px;color:var(--ink3);overflow-wrap:anywhere}
.missing{display:flex;flex-direction:column;gap:${wide ? 8 : 4}px}
.missing .tag{font-size:${wide ? 18 : 10}px;padding:${wide ? "3px 10px" : "2px 6px"};align-self:flex-start}
.missing p{font-size:${wide ? 21 : 11}px;color:var(--ink2)}
.step.verdict{display:grid;grid-template-columns:${wide ? "minmax(0,1fr) 440px" : "1fr"};gap:${wide ? 24 : 8}px;align-items:center}
.verdict > div{display:flex;flex-direction:column;gap:${wide ? 8 : 4}px;min-width:0}
.v{font-family:"Geist Mono",ui-monospace,monospace;font-size:${wide ? 30 : 16}px;font-weight:600;overflow-wrap:anywhere}
.v.ok{color:var(--accent)}
.v.no{color:var(--refuse)}
.link-card{border-radius:${wide ? 14 : 10}px;background:var(--soft);border:1px solid var(--line);padding:${wide ? 20 : 10}px;display:flex;flex-direction:column;gap:${wide ? 8 : 4}px}
.link-card b{font-size:${wide ? 22 : 13}px}
.link-card span{font-family:"Geist Mono",ui-monospace,monospace;font-size:${wide ? 16 : 9}px;color:var(--accent);overflow-wrap:anywhere}`;
  const e = verdict.event;
  const steps = [
    `<li class="step"><div class="k">${esc(`1 · ${brief.model.label} · #${brief.event.id} from ${shortHex(brief.event.from)}`)}</div><blockquote dir="auto">${esc(`“${plainText(brief.event.text)}”`)}</blockquote><div class="src mono">${esc(`block ${row(brief.model, "Block")} · tx ${shortHex(brief.model.hash)}`)}</div></li>`,
    replyStep(reply),
    `<li class="step verdict"><div><div class="k">${esc(`3 · ${verdict.model.label}`)}</div><div class="v ${e.allowed ? "ok" : "no"}">${esc(verdictLine(e))}</div><div class="src mono">${esc(
      `${row(verdict.model, "Intent")} · brief-driven, adopts brief #${brief.event.id} · sent by ${shortHex(verdict.model.from)}, the vault's executor · block ${row(verdict.model, "Block")}`,
    )}</div></div><div class="link-card"><b>Open on Basescan ↗</b><span>${esc(verdict.model.url.replace(/^https:\/\//, ""))}</span></div></li>`,
  ];
  return documentHtml({
    format,
    fontsDir,
    css,
    body: `<div class="frame"><div class="eyebrow">Base mainnet · the published journal</div><h2>${esc(title)}</h2><ol class="steps">${steps.join("")}</ol></div>`,
  });
}
