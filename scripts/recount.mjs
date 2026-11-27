#!/usr/bin/env node
// Rebuilds the brief and Decision lines of the site's /proof page from Base mainnet alone, by the counting rule of
// docs/superpowers/specs/2026-11-25-maat-inbox-design.md, section 5. It reads the deployments table from
// deployments/README.md and the five lists from web/content/ (the team list, the team sends that no vault or inbox log
// the trace reads gives, the hop stops, the hide-list and the bounty claimants), then every Brief log of the inbox, the
// team set traced at the block counted to, the vault's Decision logs that trace reads, each labelled by the rule, and
// the Coinbase Verified Account of each outside wallet, over a keyless JSON-RPC.
//
//   node scripts/recount.mjs [--rpc <url>] [--logs-rpc <url>] [--to-block <n>] [--root <dir>] [--snapshot] [--csv]
//   node scripts/recount.mjs --sends <wallet> --rpc <archive url> [--logs-rpc <url>] [--to-block <n>] [--root <dir>]
//
// No dependency: Node's built-ins and fetch only. It reads the TypeScript lists, and the team trace
// web/app/(site)/proof/team.ts that the page runs too, with Node's own type stripping, which Node.js 24 has on by
// default. web/app/(site)/proof/count.ts is the page's copy of the counting steps, and web/test/proof-recount.test.ts
// runs the page and this script on one fixture and wants the same lines.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const DEFAULT_RPC = "https://base-rpc.publicnode.com";
export const BASE_CHAIN_ID = 8453;
/** web/lib/chain/config.ts SCAN_FLOOR_BLOCK: where the scan starts when the inbox's deploy tx is not recorded. */
export const SCAN_FLOOR_BLOCK = 59_735_280n;
/** keccak256("Brief(uint256,address,string)"), the inbox's only event. Node has no keccak, so it is written here. */
export const BRIEF_TOPIC = "0x6990c09d9f6bf654815df468a70bea4545776ea2b7316f7340b23b30e1d45936";

// Coinbase Verifications on Base, from the official repository, https://github.com/coinbase/verifications: the Base
// mainnet table of its README gives the Coinbase Indexer, the EAS predeploy and the "Verified Account" schema, and
// src/interfaces/IAttestationIndexer.sol gives getAttestationUid(address recipient, bytes32 schemaUid). The page
// reads the same three (web/app/(site)/proof/verified.ts).
export const COINBASE_INDEXER = "0x2c7ee1e5f416dff40054c27a62f7b357c4e8619c";
export const EAS = "0x4200000000000000000000000000000000000021";
export const VERIFIED_ACCOUNT_SCHEMA = "0xf8b05c79f090979bf4a80270aba232dff11a10d9ca55c4f88de95317970f0de9";
/** The selector of getAttestationUid(address,bytes32). */
export const GET_ATTESTATION_UID = "0xab2717dd";
/** The selector of getAttestation(bytes32). */
export const GET_ATTESTATION = "0xa3112a64";

const RATE_LIMIT = /rate.?limit|too many requests/i;
const RETRIES = 5;
/** The longest a rate-limited call waits in all, and between two tries, before it gives up (rpcClient). */
const RATE_LIMIT_WAIT_MS = 120_000;
const RATE_LIMIT_BACKOFF_MS = 8_000;
const ZERO32 = `0x${"0".repeat(64)}`;
const RULE = "docs/superpowers/specs/2026-11-25-maat-inbox-design.md, section 5";
/** The committed snapshot of the vault's logs (web/lib/chain/snapshot.ts), which --snapshot reads. */
const SNAPSHOT_FILE = "web/content/generated/decisions-snapshot.json";
/** The header row of --csv. */
export const CSV_HEAD = "line,count,allowed,refused";

const USAGE = `Rebuilds the /proof brief and Decision lines from Base mainnet alone.

  node scripts/recount.mjs [--rpc <url>] [--logs-rpc <url>] [--to-block <n>] [--root <dir>] [--snapshot] [--csv]
  node scripts/recount.mjs --sends <wallet> --rpc <archive url> [--logs-rpc <url>] [--to-block <n>] [--root <dir>]

  --rpc <url>        a Base mainnet JSON-RPC (default ${DEFAULT_RPC}); when it rate-limits, fewer requests go
                     out at once and each waits as its Retry-After header says, for up to ${RATE_LIMIT_WAIT_MS / 60_000} minutes in all
  --logs-rpc <url>   read eth_getLogs from this Base mainnet RPC instead of --rpc (default: --rpc)
  --to-block <n>     count to block n, the block /proof says it counted to, as it prints it or as digits (default: the head)
  --root <dir>       read deployments/README.md and web/content/ from this checkout (default: this script's)
  --snapshot         take the vault's logs below the committed snapshot's reorg window from
                     ${SNAPSHOT_FILE}, as /proof does, once the RPC gives the file's block the hash it
                     records and each log's transaction receipt holds it, and read only the other blocks; when a team
                     wallet then has fewer sends than its nonce, read the file's blocks from the RPC as well. Without
                     it, every log is read from the RPC, from the vault's deploy block on, and the recount depends on
                     no file but the deployments table and the five lists.
  --csv              print only the ten lines of the rule, as CSV with the columns ${CSV_HEAD}: count
                     is a number, or the word the line gives in place of one; allowed and refused are filled
                     on the Decision lines once they are read. The exit code is the same as without it.
  --sends <wallet>   print the entry of web/content/proof-sends.ts the wallet needs at block n: the transactions it
                     sent that left no vault log the team trace reads (it skips RevenueReceived, which anyone can
                     make the vault emit) and no Brief of MaatInbox, in nonce order. It reads the wallet's nonce at
                     past blocks, which takes an archive RPC such as https://mainnet.base.org, and the vault's logs,
                     which that RPC serves 200 blocks at a time: --logs-rpc ${DEFAULT_RPC} reads them 50,000
                     at a time.
`;

/** The team trace the page runs, from this script's own checkout. */
const TEAM_MODULE = new URL("../web/app/(site)/proof/team.ts", import.meta.url);

// ---------------------------------------------------------------------------------------------------------------
// deployments/README.md, read as web/lib/docs/docs-data.ts parseDeployments reads it.

const DEPLOYMENTS_FILE = "deployments/README.md";
const DEPLOYMENT_HEAD = ["Network", "Contract", "Address", "Tx", "Date"];
const DEPLOYMENT_NETWORK = "Base mainnet";
const FULL_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const FULL_HASH = /^0x[0-9a-fA-F]{64}$/;

const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** The rows of the first table in deployments/README.md, with the checks of parseDeployments. */
export function parseDeployments(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const isRow = (line) => line.trimStart().startsWith("|");
  const cells = (line) =>
    line
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) =>
        c
          .trim()
          .replace(/^\[([^\]]*)\]\([^)]*\)$/, "$1")
          .replace(/^`([^`]*)`$/, "$1"),
      );
  const start = lines.findIndex(isRow);
  if (start < 0) throw new Error(`${DEPLOYMENTS_FILE} has no table`);
  const head = cells(lines[start] ?? "");
  if (head.join(" | ") !== DEPLOYMENT_HEAD.join(" | ")) {
    throw new Error(`${DEPLOYMENTS_FILE}: the table's columns are ${head.join(" | ")}, not ${DEPLOYMENT_HEAD.join(" | ")}`);
  }
  const out = [];
  for (const line of lines.slice(start + 2)) {
    if (!isRow(line)) break;
    const row = cells(line);
    if (row.length !== DEPLOYMENT_HEAD.length) throw new Error(`${DEPLOYMENTS_FILE}: the row ${line.trim()} has ${row.length} cells, not ${DEPLOYMENT_HEAD.length}`);
    const [network = "", contract = "", address = "", tx = "", date = ""] = row;
    if (address !== "" && !FULL_ADDRESS.test(address)) throw new Error(`${DEPLOYMENTS_FILE}: the row ${line.trim()} has the address ${address}, not an empty cell or 0x and 40 hex digits`);
    if (network !== DEPLOYMENT_NETWORK) throw new Error(`${DEPLOYMENTS_FILE}: the row ${line.trim()} is on the network ${network}, not ${DEPLOYMENT_NETWORK}`);
    if (tx !== "" && !FULL_HASH.test(tx)) throw new Error(`${DEPLOYMENTS_FILE}: the row ${line.trim()} has the transaction ${tx}, not an empty cell or 0x and 64 hex digits`);
    if (date !== "" && !isDay(date)) throw new Error(`${DEPLOYMENTS_FILE}: the row ${line.trim()} has the date ${date}, not an empty cell or a calendar day as YYYY-MM-DD`);
    out.push({ network, contract, address, tx, date });
  }
  return out;
}

/** The Base mainnet MaatInbox of the table, lowercased, or null while it has no such row or its address is empty. */
export function inboxRecord(rows) {
  const row = rows.find((r) => r.network === DEPLOYMENT_NETWORK && r.contract === "MaatInbox");
  const address = row?.address.trim() ?? "";
  if (!row || address === "") return null;
  const tx = row.tx.trim();
  return { inbox: address.toLowerCase(), deployTx: tx === "" ? null : tx.toLowerCase() };
}

// ---------------------------------------------------------------------------------------------------------------
// The counting rule: the same steps as web/app/(site)/proof/count.ts.

function addresses(list, name) {
  if (!Array.isArray(list)) throw new Error(`the ${name} list is not an array`);
  return list.map((entry) => {
    const address = entry?.address;
    if (typeof address !== "string" || !FULL_ADDRESS.test(address)) throw new Error(`the ${name} list has "${address}", not 0x and 40 hex digits`);
    return address.toLowerCase();
  });
}

function wallets(briefs) {
  const by = new Map();
  for (const b of briefs) by.set(b.from, (by.get(b.from) ?? 0) + 1);
  return [...by.entries()].map(([address, n]) => ({ address, briefs: n }));
}

/**
 * Team briefs apart; every other brief is an outside brief, hidden or not; bounty claimants from their list alone.
 * `lists.team` is the whole team set: the members of the team trace.
 */
export function countBriefs(briefs, lists) {
  const team = new Set(addresses(lists.team, "team"));
  const claimants = addresses(lists.bounty, "bounty");
  if (!Array.isArray(lists.hidden) || !lists.hidden.every((id) => Number.isSafeInteger(id))) throw new Error("the hide-list is not a list of brief ids");
  const hidden = new Set(lists.hidden);
  const sorted = briefs.map((b) => ({ id: b.id, from: b.from.toLowerCase() })).sort((a, b) => a.id - b.id);
  const outside = sorted.filter((b) => !team.has(b.from));
  const inside = sorted.filter((b) => team.has(b.from));
  const seen = new Set();
  const bounty = lists.bounty.flatMap((c, i) => {
    const address = claimants[i];
    if (seen.has(address)) return [];
    seen.add(address);
    return [{ address, evidence: String(c.evidence) }];
  });
  return {
    outsideBriefs: outside.length,
    outsideWallets: wallets(outside),
    teamBriefs: inside.length,
    teamWallets: wallets(inside),
    hidden: outside.filter((b) => hidden.has(b.id)),
    bounty,
  };
}

const formatCount = (n) => n.toLocaleString("en-US");
const briefsText = (n) => `${formatCount(n)} ${n === 1 ? "brief" : "briefs"}`;

/** What a brief line says in place of a number when the count is incomplete or the inbox is not recorded. */
const STATE_TEXT = { incomplete: "incomplete", "not-deployed": "not deployed" };

/**
 * The ten lines of the rule, in the order its table lists them, each with its number `n` or, when it has none, the
 * `word` it gives: a brief line the state's word, a Decision line "not read" until `decisions` is given. `split` is a
 * Decision line's Decisions the vault allowed and refused, once read. The same lines as count.ts proofLines.
 */
export function countLines(count, verified, state = "counted", decisions = null) {
  const counted = state === "counted";
  const brief = (label, n) => (counted ? { label, n, word: null, split: null } : { label, n: null, word: STATE_TEXT[state], split: null });
  const decision = (label, t) => (t ? { label, n: t.allowed + t.refused, word: null, split: t } : { label, n: null, word: "not read", split: null });
  const t = decisions?.tally;
  return [
    decision("Owner by hand Decisions", t?.["owner, by hand"]),
    decision("Agent Decisions", t?.agent),
    decision("Probe Decisions", t?.probe),
    brief("Outside briefs", count.outsideBriefs),
    brief("Outside wallets", count.outsideWallets.length),
    brief("Outside wallets with a Verified Account", count.outsideWallets.filter((w) => verified.get(w.address)).length),
    decision("Brief-driven Decisions", t?.["brief-driven"]),
    brief("Team briefs", count.teamBriefs),
    brief("Hidden briefs", count.hidden.length),
    { label: "Bounty claimants", n: count.bounty.length, word: null, split: null },
  ];
}

/** Each label in the rule's words, as a Decision's row in the report gives it (count.ts ROW_LABEL). */
const ROW_LABEL = { "owner, by hand": "owner by hand", agent: "agent", probe: "probe", "brief-driven": "brief-driven" };

/**
 * The lines /proof shows, in its words: the ten lines; every Decision with its label; when `state` is "counted", the
 * rows behind the brief lines; the bounty claimants; then `teamText`, the trace's lines. Otherwise each brief line gives
 * the state's word in place of a number.
 */
export function reportLines(count, verified, state = "counted", teamText = [], decisions = null) {
  const counted = state === "counted";
  return [
    ...countLines(count, verified, state, decisions).map((l) => {
      const value = l.n === null ? l.word : formatCount(l.n);
      return `${l.label}: ${l.split ? `${value} (${formatCount(l.split.allowed)} allowed, ${formatCount(l.split.refused)} refused)` : value}`;
    }),
    ...(decisions?.rows ?? []).map((r) => {
      const cites = r.briefs.length > 0 ? ` citing ${r.briefs.map((id) => `#${id}`).join(", ")}` : "";
      return `Decision ${r.txHash} log ${r.logIndex} in block ${r.block.toLocaleString("en-US")}: ${ROW_LABEL[r.label]}${cites}, vault ${r.allowed ? "allowed" : "refused"}`;
    }),
    ...(counted ? count.outsideWallets : []).map((w) => {
      const uid = verified.get(w.address);
      return `Outside wallet ${w.address}: ${briefsText(w.briefs)}, ${uid ? `Verified Account ${uid}` : "no Verified Account"}`;
    }),
    ...(counted ? count.teamWallets : []).map((w) => `Team wallet ${w.address}: ${briefsText(w.briefs)}`),
    ...(counted ? count.hidden : []).map((h) => `Hidden brief #${h.id} from ${h.from}`),
    ...count.bounty.map((c) => `Bounty claimant ${c.address}: ${c.evidence}`),
    ...teamText,
  ];
}

/** A CSV cell: quoted, with its quotes doubled, when it holds a comma, a quote or a line break. */
const csvCell = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** --csv: CSV_HEAD, then the ten lines of countLines, with plain digits for a number and the line's word for none. */
export function csvLines(count, verified, state = "counted", decisions = null) {
  return [
    CSV_HEAD,
    ...countLines(count, verified, state, decisions).map((l) =>
      [l.label, l.n === null ? l.word : String(l.n), l.split ? String(l.split.allowed) : "", l.split ? String(l.split.refused) : ""].map(csvCell).join(","),
    ),
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// The Decision lines: each Decision log of the vault gets the label /ledger gives it (web/lib/chain/ledger.ts
// senderLabel), first match wins, from its transaction's sender and the maat:v1 blob that web/lib/chain/rationale.ts
// decodes from the calldata of a transaction sent to the vault, by
// docs/superpowers/specs/2026-11-25-maat-v1-rationale-blob-design.md (§1 the calldata, §2.6 the validation, §4 the
// labels). Node has no keccak, and a label needs none: only whether the blob is v1, and its k and q.
// web/test/proof-recount.test.ts checks this decoder against the page's on the spec's vectors and broken blobs.

/** The selector of execute((bytes32,uint8,address,uint256,uint256,address,bytes32)). */
export const EXECUTE_SELECTOR = "0x4ad3993f";
/** `execute(Intent)` calldata is always this long: the selector and seven static words. */
const EXECUTE_BYTES = 228;
const BLOB_PREFIX = "maat:v1:";
const MAX_BLOB_BYTES = 1024;
/** The 16 bytes that end an ERC-8021 suffix. */
const ERC8021_MARKER = "80218021802180218021802180218021";
const PROBE_TEXT_PREFIX = "PROBE v1, not a Claude proposal";
const BILL_TEXT_PREFIX = "Compute bill: ";
const BLOB_KEYS = new Set(["b", "c", "j", "k", "m", "q", "r", "s", "t"]);
const COMMIT_RE = /^(?:[0-9a-f]{40}(?:-dirty)?|unknown)$/;
const HASH_RE = /^0x[0-9a-f]{64}$/;
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/;
const RUN_RE = /^[A-Za-z0-9._:-]{1,64}$/;
// The spec's URL_RE and KEY_RE (§2.3), without the g flag so that test() keeps no state between calls.
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/\S*|\bwww\.\S*|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b(?:\/\S*)?/i;
const KEY_RE = /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bAKIA[0-9A-Z]{16}\b|-----BEGIN[A-Z ]*-----/;
const denied = (v) => URL_RE.test(v) || KEY_RE.test(v);
const SYM_RE = /^(?:[A-Za-z0-9]{1,16}|0x[0-9a-f]{40})$/;
const ROUND_RE = /^(?:0|[1-9][0-9]{0,24})$/;
const isNat = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** The spec's canonical JSON (§2.2). Throws on a number that is not a safe integer. */
function canon(v) {
  if (v === null || typeof v === "string" || typeof v === "boolean") return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new Error("integers only");
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (typeof v !== "object") throw new Error(`no canonical form for a ${typeof v}`);
  const keys = Object.keys(v)
    .filter((k) => v[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;
}

/** One `s` entry (§2.1): [symbol, round id, updatedAt, premium]. */
function isSource(e) {
  if (!Array.isArray(e) || e.length !== 4) return false;
  const [sym, roundId, updatedAt, premiumBps] = e;
  if (typeof sym !== "string" || !SYM_RE.test(sym)) return false;
  if (roundId !== null && (typeof roundId !== "string" || !ROUND_RE.test(roundId))) return false;
  if (updatedAt !== null && !isNat(updatedAt)) return false;
  return premiumBps === null || (typeof premiumBps === "number" && Number.isSafeInteger(premiumBps));
}

/** The §2.1 rules for the parsed object: its `k` and `q` when it keeps them all, or null. */
function blobFields(o) {
  if (Object.keys(o).some((k) => !BLOB_KEYS.has(k))) return null;
  if (!isNat(o.b)) return null;
  if (typeof o.c !== "string" || !COMMIT_RE.test(o.c)) return null;
  if (typeof o.j !== "string" || !HASH_RE.test(o.j)) return null;
  const hasK = "k" in o;
  if (hasK && o.k !== "probe" && o.k !== "bill") return null;
  if (hasK && "m" in o) return null;
  if (!hasK && (typeof o.m !== "string" || !MODEL_RE.test(o.m) || denied(o.m))) return null;
  if ("q" in o) {
    const v = o.q;
    if (hasK || !Array.isArray(v) || v.length < 1 || v.length > 3 || !v.every(isNat) || v.some((x, i) => i > 0 && x <= v[i - 1])) return null;
  }
  if (typeof o.r !== "string" || !RUN_RE.test(o.r) || denied(o.r)) return null;
  if (!Array.isArray(o.s) || o.s.length > 16 || !o.s.every(isSource)) return null;
  if (typeof o.t !== "string" || o.t.length < 1 || o.t.length > 600) return null;
  if (o.k === "probe" && !o.t.startsWith(PROBE_TEXT_PREFIX)) return null;
  if (o.k === "bill" && !o.t.startsWith(BILL_TEXT_PREFIX)) return null;
  return { ...(hasK ? { k: o.k } : {}), ...("q" in o ? { q: [...o.q] } : {}) };
}

/** The bytes of a blob that starts with `maat:v1:`, validated (§2.6): v1 with its `k` and `q`, or invalid. */
function validateBlob(bytes) {
  const invalid = { status: "invalid" };
  if (bytes.length > MAX_BLOB_BYTES || bytes.some((x) => x < 0x20 || x > 0x7e)) return invalid;
  const text = bytes.toString("latin1");
  let parsed;
  try {
    parsed = JSON.parse(text.slice(BLOB_PREFIX.length));
  } catch {
    return invalid;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return invalid;
  const fields = blobFields(parsed);
  if (fields === null) return invalid;
  try {
    if (BLOB_PREFIX + canon(parsed) !== text) return invalid;
  } catch {
    return invalid;
  }
  return { status: "v1", fields };
}

/**
 * The blob in the input of a transaction sent to the vault (§1): { status: "none" }, { status: "v1", fields: { k?, q? } },
 * { status: "invalid" } or { status: "foreign" }; null when the input is not a direct `execute` call, which carries no
 * blob. The end of the blob is the start of the ERC-8021 suffix, read from the end of the input.
 */
export function decisionBlob(input) {
  let hex = String(input).replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]*$/.test(hex)) return null;
  // As viem's hexToBytes, which the page decodes with, reads an odd number of digits.
  if (hex.length % 2 === 1) hex = `0${hex}`;
  const d = Buffer.from(hex, "hex");
  const len = d.length;
  if (len < EXECUTE_BYTES || `0x${d.subarray(0, 4).toString("hex")}` !== EXECUTE_SELECTOR) return null;
  let end = len;
  if (len >= EXECUTE_BYTES + 18 && d.subarray(len - 16).toString("hex") === ERC8021_MARKER && d[len - 17] === 0) {
    const start = len - 18 - d[len - 18];
    if (start >= EXECUTE_BYTES) end = start;
  }
  const b = d.subarray(EXECUTE_BYTES, end);
  if (b.length === 0) return { status: "none" };
  return b.length >= BLOB_PREFIX.length && b.subarray(0, BLOB_PREFIX.length).toString("latin1") === BLOB_PREFIX ? validateBlob(b) : { status: "foreign" };
}

/** §4, first match wins: as web/lib/chain/ledger.ts senderLabel. */
export function senderLabel(from, owner, blob) {
  if (from.toLowerCase() === owner.toLowerCase()) return "owner, by hand";
  if (blob.status === "v1" && blob.fields.k === "probe") return "probe";
  if (blob.status === "v1" && blob.fields.q !== undefined) return "brief-driven";
  return "agent";
}

/**
 * The Decision lines from the trace's Decisions (team.ts VaultDecision): each labelled, the blob read only from a
 * transaction sent to the vault, and tallied as the vault allowed or refused it. Null when the trace read no vault. The
 * same steps as count.ts countDecisions.
 */
export function countDecisions(trace) {
  if (trace.vault === null || trace.owner === null) return null;
  const tally = Object.fromEntries(["owner, by hand", "agent", "probe", "brief-driven"].map((l) => [l, { allowed: 0, refused: 0 }]));
  const rows = trace.decisions.map((d) => {
    const blob = (d.to === trace.vault ? decisionBlob(d.input) : null) ?? { status: "none" };
    const label = senderLabel(d.from, trace.owner, blob);
    tally[label][d.allowed ? "allowed" : "refused"] += 1;
    const briefs = label === "brief-driven" ? [...blob.fields.q] : [];
    return { txHash: d.txHash, logIndex: d.logIndex, block: d.block, label, allowed: d.allowed, briefs };
  });
  return { tally, rows };
}

// ---------------------------------------------------------------------------------------------------------------
// JSON-RPC over fetch.

class RpcError extends Error {
  constructor(method, code, message) {
    super(`${method}: ${message}`);
    this.code = code;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex = (n) => `0x${n.toString(16)}`;

/** The milliseconds a Retry-After header asks for (seconds or an HTTP date), or null when it gives none. */
function retryAfter(res) {
  const value = res.headers.get("retry-after")?.trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

/**
 * One RPC. An HTTP 5xx or a network error is retried with backoff RETRIES times; any other error is thrown, but a
 * rate limit. A keyless RPC rate-limits by the request: then the client lets out at most half the requests that were in
 * flight when the refused one went out, one more after each that many answers, and the refused call waits as long as
 * the RPC's Retry-After says or backs off up to RATE_LIMIT_BACKOFF_MS, for up to RATE_LIMIT_WAIT_MS in all.
 */
export function rpcClient(url) {
  let id = 0;
  // Requests in flight, those waiting for a turn, and how many may be in flight: no cap until the first rate limit.
  let active = 0;
  let cap = Infinity;
  let answered = 0;
  const queue = [];
  const turn = () => {
    if (active < cap) {
      active += 1;
      return Promise.resolve(active);
    }
    return new Promise((resolve) => queue.push(resolve));
  };
  const done = () => {
    active -= 1;
    while (active < cap && queue.length > 0) {
      active += 1;
      queue.shift()(active);
    }
  };
  // Requests sent together are refused together, so each cut halves what was in flight when they went out, once.
  const limited = (inFlight) => {
    const half = Math.max(1, Math.floor(inFlight / 2));
    if (half < cap) {
      cap = half;
      answered = 0;
    }
  };
  const answer = () => {
    if (cap !== Infinity && ++answered >= cap) {
      cap += 1;
      answered = 0;
    }
  };
  return async function call(method, params) {
    let failures = 0;
    let limits = 0;
    let waited = 0;
    const fail = async (why) => {
      if (failures >= RETRIES) throw new Error(`${method}: ${why}, ${RETRIES + 1} times`);
      await sleep(300 * 2 ** failures++);
    };
    const rateLimited = async (why, inFlight, asked) => {
      limited(inFlight);
      limits += 1;
      const backoff = Math.min(RATE_LIMIT_BACKOFF_MS, 500 * 2 ** (limits - 1)) * (0.5 + Math.random() / 2);
      const wait = Math.min(asked ?? backoff, RATE_LIMIT_WAIT_MS - waited);
      if (wait <= 0) throw new Error(`${method}: ${why}, ${limits} times in ${Math.round(waited / 1000)} s`);
      waited += wait;
      await sleep(wait);
    };
    for (;;) {
      const inFlight = await turn();
      let res;
      let body;
      try {
        res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
        body = res.ok ? await res.json() : null;
      } catch (e) {
        done();
        await fail(e instanceof Error ? e.message : String(e));
        continue;
      }
      done();
      if (res.status === 429) {
        await rateLimited("HTTP 429", inFlight, retryAfter(res));
        continue;
      }
      if (res.status >= 500) {
        await fail(`HTTP ${res.status}`);
        continue;
      }
      if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
      if (body.error) {
        const message = String(body.error.message ?? body.error.code);
        if (RATE_LIMIT.test(message) || body.error.code === -32005 || body.error.code === -32016) {
          await rateLimited(message, inFlight, null);
          continue;
        }
        throw new RpcError(method, body.error.code, message);
      }
      answer();
      return body.result;
    }
  };
}

const word = (data, i) => `0x${data.slice(2 + 64 * i, 2 + 64 * (i + 1))}`;

/** A Brief log as the page's reader keeps it (web/lib/chain/inbox.ts), or null for a log it would drop. */
export function decodeBrief(log, inbox) {
  if (log.blockNumber == null || log.transactionHash == null || log.logIndex == null) return null;
  if (String(log.address).toLowerCase() !== inbox) return null;
  const topics = log.topics ?? [];
  if (topics.length !== 3 || String(topics[0]).toLowerCase() !== BRIEF_TOPIC) return null;
  // The text: one ABI-encoded string, its offset, its length and its bytes padded to 32.
  const data = String(log.data);
  const size = (data.length - 2) / 2;
  if (!/^0x([0-9a-fA-F]{2})*$/.test(data) || size < 64 || BigInt(word(data, 0)) !== 32n) return null;
  const length = BigInt(word(data, 1));
  if (64n + ((length + 31n) / 32n) * 32n > BigInt(size)) return null;
  const id = BigInt(topics[1]);
  if (id > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return {
    id: Number(id),
    from: `0x${String(topics[2]).slice(-40)}`.toLowerCase(),
    txHash: String(log.transactionHash).toLowerCase(),
    logIndex: Number(log.logIndex),
  };
}

/** The rule's test for one UID, as web/app/(site)/proof/verified.ts countsAsVerified. */
export function countsAsVerified(att, uid, wallet, now) {
  if (uid === ZERO32) return false;
  if (att.uid !== uid || att.schema !== VERIFIED_ACCOUNT_SCHEMA || att.recipient !== wallet.toLowerCase()) return false;
  if (att.revocationTime !== 0n) return false;
  return att.expirationTime === 0n || att.expirationTime > now;
}

/** EAS's getAttestation answer: an offset, then the Attestation struct, whose fields are read by position. */
function decodeAttestation(data) {
  const at = Number(BigInt(word(data, 0)) / 32n);
  const field = (i) => word(data, at + i).toLowerCase();
  return {
    uid: field(0),
    schema: field(1),
    expirationTime: BigInt(field(3)),
    revocationTime: BigInt(field(4)),
    recipient: `0x${field(6).slice(-40)}`,
  };
}

/**
 * Each wallet's counting Verified Account UID, or null; every read is at `blockTag`, judged at `now`. The wallets are
 * read READ_WORKERS at a time (team.ts), as the page reads them all at once.
 */
export async function verifiedAccounts(call, list, blockTag, now) {
  const { mapLimit, READ_WORKERS } = await import(TEAM_MODULE.href);
  const uids = await mapLimit(list, READ_WORKERS, async (w) => {
    const data = `${GET_ATTESTATION_UID}${w.slice(2).padStart(64, "0")}${VERIFIED_ACCOUNT_SCHEMA.slice(2)}`;
    return word(await call("eth_call", [{ to: COINBASE_INDEXER, data }, blockTag]), 0).toLowerCase();
  });
  const held = await mapLimit([...list.entries()], READ_WORKERS, async ([i, w]) => {
    const uid = uids[i];
    if (uid === ZERO32) return null;
    const att = decodeAttestation(await call("eth_call", [{ to: EAS, data: `${GET_ATTESTATION}${uid.slice(2)}` }, blockTag]));
    return countsAsVerified(att, uid, w, now) ? uid : null;
  });
  return new Map(list.map((w, i) => [w, held[i]]));
}

/**
 * The transactions `wallet` sent by `head` that `known` does not give, in nonce order, and how many it sent. `known`
 * holds sends already found, each with its nonce and block (team.ts loggedSends). For every other nonce, the first
 * block whose nonce is past it is found by bisection between the known sends around it, then the wallet's transaction
 * in that block. Every read but the last block's needs an RPC that answers for past blocks.
 */
export async function sentTransactions(call, wallet, head, known = []) {
  const nonceAt = async (block) => BigInt(await call("eth_getTransactionCount", [wallet, hex(block)]));
  const n = await nonceAt(head);
  const at = new Map(known.map((k) => [k.nonce, k.block]));
  const out = [];
  let lo = 0n;
  for (let k = 0n; k < n; k++) {
    // Nonce k is sent in or after the block of nonce k - 1, and before the block of any later nonce found.
    if (at.has(k)) {
      lo = at.get(k);
      continue;
    }
    let hi = head;
    for (let j = k + 1n; j < n; j++) {
      if (at.has(j)) {
        hi = at.get(j);
        break;
      }
    }
    while (lo < hi) {
      const mid = (lo + hi) / 2n;
      if ((await nonceAt(mid)) > k) hi = mid;
      else lo = mid + 1n;
    }
    const block = await call("eth_getBlockByNumber", [hex(lo), true]);
    const tx = (block?.transactions ?? []).find((t) => typeof t === "object" && String(t.from).toLowerCase() === wallet && BigInt(t.nonce) === k);
    if (!tx) throw new Error(`block ${lo} has no transaction ${k} of ${wallet}`);
    out.push(String(tx.hash).toLowerCase());
  }
  return { sent: n, txs: out };
}

/**
 * Every Brief of the recorded inbox to `head`, in id order, each read once, from the inbox's deploy block on, with the
 * team trace's own scan (team.ts logsIn: windows of 50,000 blocks, halved on a range error, LOG_WORKERS at a time). Any
 * window that cannot be read stops the recount, so the scan it gives the team trace is complete.
 */
async function inboxBriefs(call, record, head) {
  let from = SCAN_FLOOR_BLOCK;
  if (record.deployTx) {
    const receipt = await call("eth_getTransactionReceipt", [record.deployTx]);
    if (receipt?.blockNumber) from = BigInt(receipt.blockNumber);
  }
  const { logsIn } = await import(TEAM_MODULE.href);
  const byKey = new Map();
  for (const log of await logsIn(call, { address: record.inbox, topics: [BRIEF_TOPIC] }, from, head)) {
    const b = decodeBrief(log, record.inbox);
    if (b) byKey.set(`${b.txHash}:${b.logIndex}`, b);
  }
  return { from, briefs: [...byKey.values()].sort((a, b) => a.id - b.id), complete: true };
}

// ---------------------------------------------------------------------------------------------------------------

async function list(root, file, name) {
  const mod = await import(pathToFileURL(join(root, file)).href);
  if (!(name in mod)) throw new Error(`${file} exports no ${name}`);
  return mod[name];
}

const plural = (n, one, many) => `${formatCount(n)} ${n === 1 ? one : many}`;

/** Runs the recount and returns the exit code: 0 printed, 1 failed, 2 a usage error. */
export async function main(argv, out = process.stdout, err = process.stderr) {
  let args;
  try {
    args = parseArgs({
      args: argv,
      options: {
        rpc: { type: "string" },
        "logs-rpc": { type: "string" },
        "to-block": { type: "string" },
        root: { type: "string" },
        sends: { type: "string" },
        snapshot: { type: "boolean" },
        csv: { type: "boolean" },
        help: { type: "boolean" },
      },
      strict: true,
    }).values;
    if (args.csv && args.sends !== undefined) throw new Error("--csv prints the lines of the count, so it does not go with --sends");
  } catch (e) {
    err.write(`${e instanceof Error ? e.message : String(e)}\n\n${USAGE}`);
    return 2;
  }
  if (args.help) {
    out.write(USAGE);
    return 0;
  }
  const write = (line) => out.write(`${line}\n`);
  // With --csv, only the CSV goes to stdout: the lines around the count are left out.
  const say = args.csv ? () => {} : write;
  const report = (count, verified, state, teamText, decisions) => {
    for (const line of args.csv ? csvLines(count, verified, state, decisions) : reportLines(count, verified, state, teamText, decisions)) write(line);
  };
  try {
    if (!process.features.typescript) throw new Error("this Node.js cannot read the TypeScript lists in web/content/: run it with Node.js 24");
    // The page prints the block with thousands separators; digits with commas or underscores are taken as it prints it.
    const toBlock = args["to-block"]?.replace(/[,_]/g, "");
    if (toBlock !== undefined && !/^\d+$/.test(toBlock)) throw new Error(`--to-block ${args["to-block"]} is not a block number`);
    const url = args.rpc ?? DEFAULT_RPC;
    const state = rpcClient(url);
    const chainId = Number(BigInt(await state("eth_chainId", [])));
    if (chainId !== BASE_CHAIN_ID) throw new Error(`the RPC ${url} is on chain id ${chainId}, not Base mainnet (${BASE_CHAIN_ID})`);
    const latest = BigInt(await state("eth_blockNumber", []));
    const head = toBlock === undefined ? latest : BigInt(toBlock);
    if (head > latest) throw new Error(`--to-block ${toBlock} is past the head block, ${latest}`);
    // eth_getLogs goes to --logs-rpc when it is given, as the page reads logs from one RPC and may read the rest from
    // another; it must be on Base and have reached the block counted to, or logs near it would be missing.
    const logsUrl = args["logs-rpc"] ?? url;
    let call = state;
    if (logsUrl !== url) {
      const logs = rpcClient(logsUrl);
      const logsChain = Number(BigInt(await logs("eth_chainId", [])));
      if (logsChain !== BASE_CHAIN_ID) throw new Error(`the RPC ${logsUrl} is on chain id ${logsChain}, not Base mainnet (${BASE_CHAIN_ID})`);
      const logsHead = BigInt(await logs("eth_blockNumber", []));
      if (logsHead < head) throw new Error(`the RPC ${logsUrl} is at block ${logsHead}, before block ${head}, the block counted to`);
      call = (method, params) => (method === "eth_getLogs" ? logs : state)(method, params);
    }
    const source = logsUrl === url ? url : `${url}, with eth_getLogs from ${logsUrl}`;

    const root = args.root ? resolve(args.root) : resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const rows = parseDeployments(readFileSync(join(root, DEPLOYMENTS_FILE), "utf8"));
    const record = inboxRecord(rows);
    const deployments = rows.filter((r) => r.network === "Base mainnet").map(({ contract, address, tx }) => ({ contract, address, tx }));

    if (args.sends !== undefined) {
      if (!FULL_ADDRESS.test(args.sends)) throw new Error(`--sends ${args.sends} is not 0x and 40 hex digits`);
      const wallet = args.sends.toLowerCase();
      // The sends the trace reads from the vault's logs and the wallet's briefs, by the same code as the trace.
      const { loggedSends } = await import(TEAM_MODULE.href);
      const briefScan = record ? await inboxBriefs(call, record, head) : undefined;
      const known = await loggedSends(call, { deployments, briefScan }, wallet, head);
      const { sent, txs } = await sentTransactions(call, wallet, head, known);
      say(`// ${plural(Number(sent), "transaction", "transactions")} sent by block ${head.toLocaleString("en-US")}, read from ${source}.`);
      if (txs.length === 0) {
        say(`// ${formatCount(known.length)} left a vault or MaatInbox log the team trace reads, so the wallet needs no entry in web/content/proof-sends.ts.`);
      } else {
        say(`// ${formatCount(known.length)} left a vault or MaatInbox log the team trace reads; the other ${formatCount(txs.length)} go in web/content/proof-sends.ts, in nonce order:`);
        say(`  { wallet: "${wallet}", txs: [${txs.map((h) => `"${h}"`).join(", ")}] },`);
      }
      return 0;
    }

    const lists = {
      team: await list(root, "web/content/proof-team.ts", "PROOF_TEAM"),
      sends: await list(root, "web/content/proof-sends.ts", "PROOF_SENDS"),
      stops: await list(root, "web/content/proof-stops.ts", "PROOF_STOPS"),
      hidden: await list(root, "web/content/ask-hidden.ts", "HIDDEN_BRIEFS"),
      bounty: await list(root, "web/content/proof-bounty.ts", "PROOF_BOUNTY"),
    };
    countBriefs([], lists);
    const { DECISION_NOTE, TEAM_SET_NOTE, snapshotSeed, teamLines, traceTeam } = await import(TEAM_MODULE.href);
    // --snapshot: the committed file as a seed of the vault's logs, which the trace checks log by log against Base.
    const vaultRow = deployments.find((r) => r.contract === "MandateVault" && r.address.trim() !== "");
    let vaultSeed = null;
    let unread = null;
    if (args.snapshot && vaultRow) {
      let raw;
      try {
        raw = JSON.parse(readFileSync(join(root, SNAPSHOT_FILE), "utf8"));
      } catch {
        unread = "it could not be read as JSON";
      }
      if (unread === null) {
        vaultSeed = snapshotSeed(raw, vaultRow.address.trim());
        if (!vaultSeed) unread = `it is not a decisions snapshot of MandateVault ${vaultRow.address.trim().toLowerCase()} on Base mainnet`;
      }
    }

    say(`Maat /proof recount, from Base mainnet alone, by the counting rule of ${RULE}.`);
    say(`RPC ${source}: chain id ${chainId}, head block ${latest.toLocaleString("en-US")}.`);
    say(
      `Lists: ${plural(lists.team.length, "team wallet", "team wallets")} (web/content/proof-team.ts), ${plural(lists.sends.length, "wallet's sent transactions", "wallets' sent transactions")} (web/content/proof-sends.ts), ${plural(lists.stops.length, "hop stop", "hop stops")} (web/content/proof-stops.ts), ${plural(lists.hidden.length, "hidden id", "hidden ids")} (web/content/ask-hidden.ts), ${plural(lists.bounty.length, "bounty claimant", "bounty claimants")} (web/content/proof-bounty.ts).`,
    );
    if (!record) {
      say("MaatInbox is not recorded in deployments/README.md yet, so there is no brief to count. Counting starts when the inbox is recorded.");
      say(TEAM_SET_NOTE);
      say(DECISION_NOTE);
      report(countBriefs([], lists), new Map(), "not-deployed", [], null);
      return 0;
    }

    // As on the page, the trace reads the vault's logs while the Brief logs are read, and takes a team wallet's briefs
    // as its sends from them.
    const scan = inboxBriefs(call, record, head);
    const [{ from, briefs }, trace] = await Promise.all([
      scan,
      traceTeam(call, { team: lists.team, sends: lists.sends, stops: lists.stops, deployments, briefScan: scan, vaultSeed }, head),
    ]);
    const count = countBriefs(briefs, { ...lists, team: trace.members });
    const complete = trace.gaps.length === 0;
    let verified = new Map();
    if (complete && count.outsideWallets.length > 0) {
      const block = await call("eth_getBlockByNumber", [hex(head), false]);
      if (!block?.timestamp) throw new Error(`block ${head} has no timestamp`);
      verified = await verifiedAccounts(
        call,
        count.outsideWallets.map((w) => w.address),
        hex(head),
        BigInt(block.timestamp),
      );
    }
    say(
      `MaatInbox ${record.inbox}: Brief logs from block ${from.toLocaleString("en-US")} to block ${head.toLocaleString("en-US")}, team set and Verified Accounts read at block ${head.toLocaleString("en-US")}.`,
    );
    say(
      trace.vault !== null
        ? `MandateVault ${trace.vault}: its Decision logs to block ${head.toLocaleString("en-US")}, from the vault logs the team trace reads, and its owner() at that block.`
        : "deployments/README.md gives no MandateVault with a mined deploy transaction, so no Decision is read.",
    );
    if (args.snapshot && trace.seed) {
      say(
        `Vault logs to block ${trace.seed.to.toLocaleString("en-US")} from ${SNAPSHOT_FILE}, the snapshot of block ${trace.seed.anchor.toLocaleString("en-US")}: the RPC gives that block the same hash, and each log's transaction receipt holds it. The vault's other blocks, to block ${head.toLocaleString("en-US")}, are read from the RPC.`,
      );
    } else if (args.snapshot && vaultRow) {
      // No reason when the trace reads no vault block at all: the vault was deployed after the block counted to, or the
      // table gives no deploy transaction for it.
      const why = unread ?? trace.seedRejected;
      say(
        why !== null
          ? `${SNAPSHOT_FILE} was not used (${why}), so the vault's logs are read from its deploy block.`
          : `${SNAPSHOT_FILE} was not used: the trace reads no block of the vault by block ${head.toLocaleString("en-US")}, the block counted to.`,
      );
    }
    say(TEAM_SET_NOTE);
    say(DECISION_NOTE);
    report(count, verified, complete ? "counted" : "incomplete", teamLines(trace), countDecisions(trace));
    if (!complete) {
      err.write(`recount: the count is incomplete: ${trace.gaps.join(" ")}\n`);
      return 1;
    }
    return 0;
  } catch (e) {
    err.write(`recount: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}

const invoked = process.argv[1] ? resolve(process.argv[1]) : "";
const self = fileURLToPath(import.meta.url);
if (process.platform === "win32" ? invoked.toLowerCase() === self.toLowerCase() : invoked === self) {
  process.exitCode = await main(process.argv.slice(2));
}
