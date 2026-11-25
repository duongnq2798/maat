import { keccak256, toBytes, type Hex } from "viem";
import { canon } from "./canon.js";
import { cuts, HEX_RE, KEY_RE, LONG_RE, matches, sanitize, URL_RE } from "./sanitize.js";

/**
 * The maat:v1 rationale blob (docs/superpowers/specs/2026-11-25-maat-v1-rationale-blob-design.md §2). The agent sends
 * it between the `execute(intent)` calldata and the Builder Code suffix, and `Intent.rationaleHash` is its keccak256,
 * so the vault's Decision log commits to the bytes anyone can read back from the transaction input.
 */

export const BLOB_PREFIX = "maat:v1:";
export const MAX_BLOB_BYTES = 1024;
/** The most characters `t` holds (MAX_RATIONALE_CHARS in llm/schema.ts is the same 600). */
export const MAX_TEXT_CHARS = 600;
/** The most `s` entries: one per vault token. */
export const MAX_SOURCES = 16;
/** A blob's `j` while the journal has no chained row, and the first chained row's `prev` (§3.1). */
export const GENESIS: Hex = `0x${"0".repeat(64)}`;
/** How a probe's `t` begins (`k` = "probe"). */
export const PROBE_TEXT_PREFIX = "PROBE v1, not a Claude proposal";
/** How the agent's code-written compute bill line begins (`k` = "bill"). */
export const BILL_TEXT_PREFIX = "Compute bill: ";

export type BlobKind = "probe" | "bill";

/** One vault token at block `b`: its symbol or lowercase address, its Chainlink round id and updatedAt, and the signed TWAP premium. */
export type Source = readonly [sym: string, roundId: string | null, updatedAt: number | null, premiumBps: number | null];

/** The blob's JSON object. Optional keys are left out when absent, never null. */
export interface BlobFields {
  /** The block of the VaultState the intent was built from. */
  b: number;
  /** gitCommit() of the agent code: 40 hex, 40 hex then "-dirty", or "unknown". */
  c: string;
  /** The journal head when the blob was built, or GENESIS. */
  j: Hex;
  k?: BlobKind;
  /** The model that wrote `t`; required exactly when `k` is absent. */
  m?: string;
  /** MaatInbox brief ids the intent adopts. */
  q?: readonly number[];
  /** The run id. */
  r: string;
  s: readonly Source[];
  /** The sanitized text, with the closed-market note at its end on a MARKET_CLOSED log. */
  t: string;
}

/** What the encoder takes: every field but `t`, the text before the sanitizer, and the closed phase for a MARKET_CLOSED log. */
export interface BlobInput extends Omit<BlobFields, "t"> {
  /** The model's rationale, a probe's line or the bill's line, as written. */
  text: string;
  /** closedNote(s) on a MARKET_CLOSED log-refusal (refusals.ts); null or absent otherwise. */
  closed?: string | null;
}

export interface EncodedBlob {
  blob: string;
  /** keccak256 of the blob's bytes: the intent's rationaleHash. */
  hash: Hex;
  fields: BlobFields;
}

export type BlobCheck = { status: "v1"; fields: BlobFields } | { status: "invalid"; problem: string };

/** The encoder refused its input: a blob with it would break a §2.1 rule. */
export class BlobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlobError";
  }
}

const KEYS: ReadonlySet<string> = new Set(["b", "c", "j", "k", "m", "q", "r", "s", "t"]);
const COMMIT_RE = /^(?:[0-9a-f]{40}(?:-dirty)?|unknown)$/;
const HASH_RE = /^0x[0-9a-f]{64}$/;
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/;
const RUN_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const SYM_RE = /^(?:[A-Za-z0-9]{1,16}|0x[0-9a-f]{40})$/;
const ROUND_RE = /^(?:0|[1-9][0-9]{0,24})$/;
const PRINTABLE_RE = /^[\x20-\x7e]*$/;

const isNat = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const plain = (s: string) => !matches(URL_RE, s) && !matches(KEY_RE, s);

function isSource(e: unknown): e is Source {
  if (!Array.isArray(e) || e.length !== 4) return false;
  const [sym, roundId, updatedAt, premiumBps] = e as unknown[];
  return (
    typeof sym === "string" &&
    SYM_RE.test(sym) &&
    (roundId === null || (typeof roundId === "string" && ROUND_RE.test(roundId))) &&
    (updatedAt === null || isNat(updatedAt)) &&
    (premiumBps === null || (typeof premiumBps === "number" && Number.isSafeInteger(premiumBps)))
  );
}

const briefIds = (q: unknown): boolean =>
  Array.isArray(q) && q.length >= 1 && q.length <= 3 && q.every(isNat) && q.every((x: number, i: number) => i === 0 || x > (q[i - 1] as number));

/** The first §2.1 rule the fields other than `t` break, or null. */
function headProblem(o: Record<string, unknown>): string | null {
  if (!isNat(o.b)) return "b is not a block number (a safe integer >= 0)";
  if (typeof o.c !== "string" || !COMMIT_RE.test(o.c)) return "c is not a gitCommit() value (40 hex, 40 hex-dirty or unknown)";
  if (typeof o.j !== "string" || !HASH_RE.test(o.j)) return "j is not a lowercase 32-byte hash";
  const hasK = o.k !== undefined;
  if (hasK && o.k !== "probe" && o.k !== "bill") return 'k is not "probe" or "bill"';
  if (hasK && o.m !== undefined) return "m is forbidden when k is present";
  if (!hasK && o.m === undefined) return "m is required when k is absent";
  if (!hasK && (typeof o.m !== "string" || !MODEL_RE.test(o.m) || !plain(o.m))) return "m is not a model id, or reads as a URL or a key";
  if (o.q !== undefined && hasK) return "q is forbidden when k is present";
  if (o.q !== undefined && !briefIds(o.q)) return "q is not 1 to 3 strictly ascending brief ids";
  if (typeof o.r !== "string" || !RUN_RE.test(o.r) || !plain(o.r)) return "r is not a run id, or reads as a URL or a key";
  if (!Array.isArray(o.s)) return "s is not a list";
  if (o.s.length > MAX_SOURCES) return `s has ${o.s.length} entries, more than ${MAX_SOURCES}`;
  const bad = o.s.findIndex((e) => !isSource(e));
  if (bad >= 0) return `s entry ${bad + 1} is not [symbol, round id, updatedAt, premiumBps]`;
  return null;
}

/** The first rule `t` breaks, or null. */
function textProblem(o: Record<string, unknown>): string | null {
  if (typeof o.t !== "string" || o.t.length < 1 || o.t.length > MAX_TEXT_CHARS) return `t is not 1 to ${MAX_TEXT_CHARS} characters`;
  if (!PRINTABLE_RE.test(o.t)) return "t is not printable ASCII";
  if (o.k === "probe" && !o.t.startsWith(PROBE_TEXT_PREFIX)) return `a probe's t must start with "${PROBE_TEXT_PREFIX}"`;
  if (o.k === "bill" && !o.t.startsWith(BILL_TEXT_PREFIX)) return `a bill's t must start with "${BILL_TEXT_PREFIX}"`;
  return null;
}

/** The note a MARKET_CLOSED log adds to the end of `t` (§2.5). */
export function closedSuffix(closed: string): string {
  return ` (market closed, ${closed})`;
}

/**
 * Builds the blob (§2.2-§2.5): `t` is sanitize(text, 600), or sanitize(text, 600 - n.length) + n with the
 * closed-market note n, then cut on a space (never inside n, nor inside the start a probe's or a bill's text must
 * keep) until the blob fits 1,024 bytes, and only then `s` entries dropped from the end. Throws a BlobError when a
 * field breaks a §2.1 rule.
 */
export function encodeBlob(input: BlobInput): EncodedBlob {
  const { text, closed, ...head } = input;
  const problem = headProblem(head as Record<string, unknown>);
  if (problem) throw new BlobError(problem);
  const n = closed ? closedSuffix(closed) : "";
  if (closed && (!PRINTABLE_RE.test(n) || [URL_RE, HEX_RE, KEY_RE, LONG_RE].some((re) => matches(re, n)))) {
    throw new BlobError(`the closed-market note ${JSON.stringify(closed)} is not plain printable text`);
  }
  const before = sanitize(text, MAX_TEXT_CHARS - n.length);
  const fields = (t: string, s: readonly Source[]): BlobFields => ({
    b: head.b,
    c: head.c,
    j: head.j,
    ...(head.k === undefined ? {} : { k: head.k }),
    ...(head.m === undefined ? {} : { m: head.m }),
    ...(head.q === undefined ? {} : { q: [...head.q] }),
    r: head.r,
    s,
    t,
  });
  const fit = (t: string, s: readonly Source[]): string | null => {
    const blob = BLOB_PREFIX + canon(fields(t, s));
    return blob.length <= MAX_BLOB_BYTES ? blob : null;
  };

  // A probe's or a bill's t must keep the start §2.1 requires, so only the cuts that keep it count, and the shortest of
  // them stands in for "..." once `s` entries go. Without k every cut counts, and the shortest is "..." itself.
  const start = head.k === "probe" ? PROBE_TEXT_PREFIX : head.k === "bill" ? BILL_TEXT_PREFIX : "";
  const kept = cuts(before).filter((c) => c.startsWith(start));
  let blob = fit(before + n, head.s);
  for (const cut of blob ? [] : kept) {
    blob = fit(cut + n, head.s);
    if (blob) break;
  }
  const shortest = kept.at(-1);
  for (let keep = head.s.length - 1; !blob && shortest !== undefined && keep >= 0; keep--) blob = fit(shortest + n, head.s.slice(0, keep));
  if (!blob) throw new BlobError(`no blob of at most ${MAX_BLOB_BYTES} bytes holds these fields`);

  // The encoder only ever emits what a decoder accepts as v1.
  const check = validateBlob(blob);
  if (check.status !== "v1") throw new BlobError(check.problem);
  return { blob, hash: keccak256(toBytes(blob)), fields: check.fields };
}

/** Decoder validation (§2.6): v1 when every byte, key, type and rule holds and the bytes are canonical. */
export function validateBlob(blob: string | Uint8Array): BlobCheck {
  const bytes = typeof blob === "string" ? toBytes(blob) : blob;
  const invalid = (problem: string): BlobCheck => ({ status: "invalid", problem });
  if (bytes.length > MAX_BLOB_BYTES) return invalid(`it is ${bytes.length} bytes, more than ${MAX_BLOB_BYTES}`);
  if (bytes.some((x) => x < 0x20 || x > 0x7e)) return invalid("it holds a byte outside printable ASCII");
  const text = String.fromCharCode(...bytes);
  if (!text.startsWith(BLOB_PREFIX)) return invalid(`it does not start with ${BLOB_PREFIX}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(BLOB_PREFIX.length));
  } catch {
    return invalid(`the text after ${BLOB_PREFIX} is not JSON`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return invalid(`the text after ${BLOB_PREFIX} is not a JSON object`);
  const o = parsed as Record<string, unknown>;
  const extra = Object.keys(o).find((k) => !KEYS.has(k));
  if (extra !== undefined) return invalid(`it has a key the spec does not allow: ${JSON.stringify(extra)}`);
  const problem = headProblem(o) ?? textProblem(o);
  if (problem) return invalid(problem);
  let canonical: string;
  try {
    canonical = BLOB_PREFIX + canon(o);
  } catch {
    return invalid("it holds a number that is not a safe integer");
  }
  if (canonical !== text) return invalid("it is not in canonical form (key order, whitespace or a repeated key)");
  const fields: BlobFields = {
    b: o.b as number,
    c: o.c as string,
    j: o.j as Hex,
    ...(o.k === undefined ? {} : { k: o.k as BlobKind }),
    ...(o.m === undefined ? {} : { m: o.m as string }),
    ...(o.q === undefined ? {} : { q: o.q as number[] }),
    r: o.r as string,
    s: o.s as Source[],
    t: o.t as string,
  };
  return { status: "v1", fields };
}
