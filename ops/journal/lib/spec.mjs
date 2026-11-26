// The parts of the maat:v1 spec (docs/superpowers/specs/2026-11-25-maat-v1-rationale-blob-design.md) the publisher
// applies: canonical JSON (§2.2), the sanitizer and its four patterns (§2.3), the public projection (§3.2), the row
// hash (§3.1) and the deny check (§3.5).
import { keccak256 } from "./keccak.mjs";

export const GENESIS = `0x${"0".repeat(64)}`;
export const HASH_RE = /^0x[0-9a-f]{64}$/;
export const BLOB_PREFIX = "maat:v1:";

export const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/\S*|\bwww\.\S*|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b(?:\/\S*)?/gi;
export const HEX_RE = /\b(?:0x)?[0-9a-f]{64,}\b/gi;
export const KEY_RE = /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bAKIA[0-9A-Z]{16}\b|-----BEGIN[A-Z ]*-----/g;
export const LONG_RE = /[A-Za-z0-9+\/_-]{40,}={0,2}/g;

/**
 * The spec's canonical JSON: object keys sorted at every level, undefined members left out, no whitespace, and
 * safe integers as the only numbers.
 * @param {unknown} v
 * @returns {string}
 */
export function canon(v) {
  if (v === null || typeof v === "string" || typeof v === "boolean") return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new Error("integers only");
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (typeof v !== "object") throw new Error(`no canonical form for a ${typeof v}`);
  const o = /** @type {Record<string, unknown>} */ (v);
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(",")}}`;
}

/** @param {number} cp */
function mapCodePoint(cp) {
  if (cp >= 0x20 && cp <= 0x7e) return String.fromCodePoint(cp);
  if (cp === 0x2018 || cp === 0x2019 || cp === 0x201a || cp === 0x2032) return "'";
  if (cp === 0x201c || cp === 0x201d || cp === 0x201e || cp === 0x2033) return '"';
  if ((cp >= 0x2010 && cp <= 0x2015) || cp === 0x2212) return "-";
  if (cp === 0x2026) return "...";
  if (cp === 0x2192) return "->";
  if (cp === 0x2190) return "<-";
  if (cp === 0x2248) return "~";
  if (cp === 0xd7) return "x";
  if (
    cp <= 0x1f ||
    (cp >= 0x7f && cp <= 0x9f) ||
    cp === 0xa0 ||
    (cp >= 0x2000 && cp <= 0x200a) ||
    cp === 0x2028 ||
    cp === 0x2029 ||
    cp === 0x202f ||
    cp === 0x205f ||
    cp === 0x3000
  )
    return " ";
  return "";
}

/**
 * Steps 1 to 3 of the sanitizer: map or drop each code point, replace the four patterns, collapse and trim spaces.
 * @param {string} text
 */
export function clean(text) {
  let out = "";
  for (const ch of text) out += mapCodePoint(/** @type {number} */ (ch.codePointAt(0)));
  return out
    .replace(URL_RE, "[url]")
    .replace(HEX_RE, "[hex]")
    .replace(KEY_RE, "[key]")
    .replace(LONG_RE, "[key]")
    .replace(/ {2,}/g, " ")
    .replace(/^ | $/g, "");
}

/**
 * The spec's sanitize(text, max): clean the text, "(no text)" when nothing is left, and when that is longer than max
 * the longest cut that fits: a prefix ending just before one of its spaces followed by " ...", or "..." alone.
 * @param {string} text
 * @param {number} max
 */
export function sanitize(text, max) {
  const t = clean(text) || "(no text)";
  if (t.length <= max) return t;
  for (let i = t.lastIndexOf(" "); i > 0; i = t.lastIndexOf(" ", i - 1)) {
    if (i + 4 <= max) return `${t.slice(0, i)} ...`;
  }
  return "...";
}

const COMMON = ["ts", "kind", "runId", "commit", "prev", "hash"];
/** Spec §3.2: the fields each kind exports beside the common ones. A run's summary and capped are derived below. */
const BY_KIND = new Map([
  ["run", ["block", "day", "mode", "ok", "costUsd6", "suggestions", "proposals"]],
  ["intent", ["index", "intentId", "action", "symbol", "amountUsd6", "rationaleHash", "blob", "preview", "gate", "txHash", "gasUsed", "decision"]],
  ["sent", ["index", "intentId", "action", "symbol", "amountUsd6", "rationaleHash", "blob", "preview", "gate", "txHash", "gas"]],
  ["reconcile", ["intentId", "action", "txHash", "outcome", "decision"]],
  ["mismatch", ["intentId", "preview", "decision"]],
  ["housekeeping", ["call", "token", "txHash", "gas", "gasUsed"]],
  ["skip", ["index", "symbol", "action"]],
  ["probe", ["at", "expected", "outcome"]],
  ["brief", ["briefId", "from", "txHash", "logIndex", "block", "outcome", "cap", "adopted"]],
]);
/** The most characters of a brief's reply the projection keeps, as agent/src/briefs/caps.ts MAX_REPLY_CHARS. */
const MAX_REPLY_CHARS = 200;

/**
 * The public projection of one journal row (spec §3.2): the common fields and its kind's fields, as they are on disk.
 * A run's summary is sanitized to 600 characters and left out when nothing is left of it after sanitizer steps 1 to 3
 * (only spaces, emoji or other dropped characters), so it is never "(no text)"; `capped` is true when its
 * error says the daily LLM cap stopped the round. A brief's reply is sanitized to 200 characters the same way. Every
 * other field, the raw rationale, a brief's note and every error text included, stays on the PC.
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
export function project(row) {
  /** @type {Record<string, unknown>} */
  const out = {};
  const kind = typeof row.kind === "string" ? row.kind : "";
  for (const k of [...COMMON, ...(BY_KIND.get(kind) ?? [])]) {
    if (Object.hasOwn(row, k) && row[k] !== undefined) out[k] = row[k];
  }
  if (kind === "run") {
    if (typeof row.summary === "string" && clean(row.summary) !== "") out.summary = sanitize(row.summary, 600);
    if (typeof row.error === "string" && row.error.startsWith("llm cap: ")) out.capped = true;
  }
  // A MaatInbox brief's reply: sanitized to 200 characters, left out like a summary. The brief's text is never a field.
  if (kind === "brief" && typeof row.reply === "string" && clean(row.reply) !== "") out.reply = sanitize(row.reply, MAX_REPLY_CHARS);
  return out;
}

/**
 * The hash a projected row must carry (spec §3.1): keccak256 of the canonical JSON of every field but `hash`.
 * @param {Record<string, unknown>} P
 */
export function rowHash(P) {
  const { hash: _hash, ...rest } = P;
  return keccak256(canon(rest));
}

/**
 * The line the branch holds for a projected row, without its line feed.
 * @param {Record<string, unknown>} P
 */
export function publishedLine(P) {
  return canon(P);
}

/** @param {RegExp} re @param {string} s */
const found = (re, s) => s.search(re) !== -1;

/**
 * The deny check (spec §3.5): the whole line against URL_RE and KEY_RE, and the free text (a run's summary, a brief's
 * reply, and `t` decoded from a maat:v1 blob) also against HEX_RE and LONG_RE. Returns the first hit as the pattern's
 * name and the field it is in, never the text it matched; null when the line may leave the PC.
 * @param {Record<string, unknown>} P
 * @param {string} line
 * @returns {{ pattern: string, field: string | null } | null}
 */
export function denyHit(P, line) {
  for (const [pattern, re] of /** @type {const} */ ([["URL_RE", URL_RE], ["KEY_RE", KEY_RE]])) {
    if (!found(re, line)) continue;
    const field = Object.keys(P).find((k) => found(re, canon(P[k]))) ?? null;
    return { pattern, field };
  }
  /** @type {[string, string][]} */
  const texts = [];
  if (typeof P.summary === "string") texts.push(["summary", P.summary]);
  if (typeof P.reply === "string") texts.push(["reply", P.reply]);
  const t = blobText(P.blob);
  if (t !== null) texts.push(["blob", t]);
  for (const [field, text] of texts) {
    for (const [pattern, re] of /** @type {const} */ ([["URL_RE", URL_RE], ["HEX_RE", HEX_RE], ["KEY_RE", KEY_RE], ["LONG_RE", LONG_RE]])) {
      if (found(re, text)) return { pattern, field };
    }
  }
  return null;
}

/**
 * The `t` of a maat:v1 blob, or null when the value is not a blob whose JSON has a string `t`.
 * @param {unknown} blob
 */
function blobText(blob) {
  if (typeof blob !== "string" || !blob.startsWith(BLOB_PREFIX)) return null;
  try {
    const parsed = JSON.parse(blob.slice(BLOB_PREFIX.length));
    return parsed !== null && typeof parsed === "object" && typeof parsed.t === "string" ? parsed.t : null;
  } catch {
    return null;
  }
}

/**
 * Whether the agent wrote a row in dry-run, by the rule agent/src/ledger/journal.ts isDryRunRow applies: a round's run
 * row names its mode, a gated intent reads "dry-run: would ...", and a housekeeping call a dry run skipped is noted.
 * @param {Record<string, unknown>} r
 */
export function isDryRunRow(r) {
  return (
    (r.kind === "run" && r.mode === "dry-run") ||
    (typeof r.gate === "string" && r.gate.startsWith("dry-run")) ||
    (r.kind === "housekeeping" && r.note === "dry-run")
  );
}
