import { bytesToHex, hexToBytes, keccak256, toBytes, type Hash, type Hex } from "viem";
import { z } from "zod";

/** One exported rationale (content/generated/rationales.json, served at /data/rationales.json). */
export interface RationaleEntry {
  intentId: Hex;
  rationaleHash: Hex;
  text: string;
  txHash: Hash | null;
  ts: string;
}

/**
 * Where the page finds rationale text for the intents it shows. The text is never trusted: the page shows the
 * "Hash verified" badge only when verifyRationale says so. v1 reads the static export; a database-backed source can
 * implement the same interface later.
 */
export interface RationaleSource {
  readonly name: string;
  lookup(intentIds: readonly Hex[]): Promise<Map<Hex, string>>;
}

export type RationaleCheck = "verified" | "mismatch" | "missing";

/** keccak256 of the exact UTF-8 bytes, the same hash agent/src/intent.ts rationaleHash() commits onchain. */
export function verifyRationale(text: string | undefined, onchainHash: Hex): RationaleCheck {
  if (text === undefined) return "missing";
  return keccak256(toBytes(text)).toLowerCase() === onchainHash.toLowerCase() ? "verified" : "mismatch";
}

const fileSchema = z.array(z.object({ intentId: z.string(), text: z.string() }).passthrough());

/** Reads the static export once; ids are matched in lowercase. A missing or malformed file finds nothing. */
export function staticRationaleSource(url = "/data/rationales.json", fetchImpl: typeof fetch = (...a) => fetch(...a)): RationaleSource {
  let all: Promise<Map<string, string>> | null = null;
  const load = async () => {
    try {
      const res = await fetchImpl(url, { cache: "no-cache" });
      if (!res.ok) return new Map<string, string>();
      const parsed = fileSchema.safeParse(await res.json());
      return new Map(parsed.success ? parsed.data.map((e) => [e.intentId.toLowerCase(), e.text] as const) : []);
    } catch {
      return new Map<string, string>();
    }
  };
  return {
    name: url,
    async lookup(ids) {
      all ??= load();
      const map = await all;
      const out = new Map<Hex, string>();
      for (const id of ids) {
        const text = map.get(id.toLowerCase());
        if (text !== undefined) out.set(id, text);
      }
      return out;
    },
  };
}

// The maat:v1 rationale blob, decoded as docs/superpowers/specs/2026-11-25-maat-v1-rationale-blob-design.md (the spec)
// defines it. Section numbers below are the spec's.

/** A journal's first `prev`, and a blob's `j` when the journal was still empty (§3.1). */
export const GENESIS: Hash = `0x${"0".repeat(64)}`;
/** The selector of execute((bytes32,uint8,address,uint256,uint256,address,bytes32)). */
export const EXECUTE_SELECTOR: Hex = "0x4ad3993f";
/** `execute(Intent)` calldata is always this long: the selector and seven static words (§1). */
export const EXECUTE_BYTES = 228;
export const BLOB_PREFIX = "maat:v1:";
export const MAX_BLOB_BYTES = 1024;
/** How a probe's `t` begins (§2.1, key `k`). */
export const PROBE_TEXT_PREFIX = "PROBE v1, not a Claude proposal";
/** How the code-written text of a compute bill begins (§2.1, key `k`). */
export const BILL_TEXT_PREFIX = "Compute bill: ";

/** The 16 bytes that end an ERC-8021 suffix. */
const ERC8021_MARKER = "80218021802180218021802180218021";

/**
 * The spec's canonical JSON (§2.2): object keys sorted at every level, no whitespace, integers only. The blob and every
 * published journal line are exactly this serialization of their parsed value. Throws on anything else.
 */
export function canon(v: unknown): string {
  if (v === null || typeof v === "string" || typeof v === "boolean") return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new Error("integers only");
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (typeof v !== "object") throw new Error(`no canonical form for a ${typeof v}`);
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(",")}}`;
}

/** One `s` entry (§2.1): a token's Chainlink round and its pool's TWAP premium at the blob's block. */
export interface BlobSource {
  /** "NVDAc", or the token's lowercase address. */
  sym: string;
  /** The round id as a decimal string (a uint80), or null when the read failed. */
  roundId: string | null;
  /** The round's updatedAt in unix seconds, or null when the read failed. */
  updatedAt: number | null;
  /** sign(twap - answer) times the premium the vault compares with maxPremiumBps, or null when it was not computed. */
  premiumBps: number | null;
}

/** A blob that passed every rule of §2.6. */
export interface BlobV1 {
  /** The block of the state the intent was built from. */
  b: number;
  /**
   * The agent's git commit as `gitCommit()` gives it (§2.1): 40 lowercase hex characters, the same followed by
   * `-dirty`, or `unknown`.
   */
  c: string;
  /** The journal head when the blob was built, or GENESIS. */
  j: Hash;
  k?: "probe" | "bill";
  /** The model that wrote `t`; absent exactly when `k` is present. */
  m?: string;
  /** MaatInbox brief ids the intent adopts. */
  q?: number[];
  /** The run id. */
  r: string;
  s: BlobSource[];
  /** The rationale, sanitized by the agent. */
  t: string;
}

/** What the bytes between the intent and the suffix are (§1 step 3, §2.6). */
export type DecodedBlob =
  | { status: "none" }
  | { status: "v1"; text: string; fields: BlobV1 }
  /** Starts with `maat:v1:` but breaks a rule; `problem` names the first rule it breaks. */
  | { status: "invalid"; bytes: number; problem: string }
  /** Bytes that are not a maat:v1 blob; nothing is decoded from them. */
  | { status: "foreign"; bytes: number };

/** A direct `execute` call, split as §1 lays it out. */
export interface ExecuteCall {
  /** Intent.rationaleHash, the intent's seventh word (bytes 196 to 228). */
  intentRationaleHash: Hash;
  blob: DecodedBlob;
  /** keccak256 of the blob's bytes, or null when there are none. */
  blobHash: Hash | null;
  /** The codes of the ERC-8021 schema-0 suffix, or null when the calldata ends with none. */
  codes: string[] | null;
}

const latin1 = (bytes: Uint8Array) => String.fromCharCode(...bytes);
const isNat = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const BLOB_KEYS: ReadonlySet<string> = new Set(["b", "c", "j", "k", "m", "q", "r", "s", "t"]);
/** `c`, and a journal row's `commit` (§2.1, §3.2): a clean HEAD, that HEAD and `-dirty`, or `unknown`. */
export const COMMIT_RE = /^(?:[0-9a-f]{40}(?:-dirty)?|unknown)$/;
const HASH_RE = /^0x[0-9a-f]{64}$/;
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/;
const RUN_RE = /^[A-Za-z0-9._:-]{1,64}$/;
// The spec's URL_RE and KEY_RE (§2.3), without the g flag so that test() keeps no state between calls.
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/\S*|\bwww\.\S*|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b(?:\/\S*)?/i;
const KEY_RE = /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bAKIA[0-9A-Z]{16}\b|-----BEGIN[A-Z ]*-----/;
/** `m` and `r` match neither pattern (§2.1), or the encoder would not have built the blob. */
const denied = (v: string) => URL_RE.test(v) || KEY_RE.test(v);
const SYM_RE = /^(?:[A-Za-z0-9]{1,16}|0x[0-9a-f]{40})$/;
const ROUND_RE = /^(?:0|[1-9][0-9]{0,24})$/;

function sourceOf(e: unknown): BlobSource | null {
  if (!Array.isArray(e) || e.length !== 4) return null;
  const [sym, roundId, updatedAt, premiumBps] = e as unknown[];
  if (typeof sym !== "string" || !SYM_RE.test(sym)) return null;
  if (roundId !== null && (typeof roundId !== "string" || !ROUND_RE.test(roundId))) return null;
  if (updatedAt !== null && !isNat(updatedAt)) return null;
  if (premiumBps !== null && (typeof premiumBps !== "number" || !Number.isSafeInteger(premiumBps))) return null;
  return { sym, roundId, updatedAt, premiumBps } as BlobSource;
}

/** The §2.1 rules for the parsed object: the fields, or the first rule it breaks. */
function blobFields(o: Record<string, unknown>): BlobV1 | string {
  const extra = Object.keys(o).find((k) => !BLOB_KEYS.has(k));
  if (extra !== undefined) return `it has a key the spec does not allow: ${JSON.stringify(extra)}`;
  if (!isNat(o.b)) return "b is not a block number";
  if (typeof o.c !== "string" || !COMMIT_RE.test(o.c)) return "c is not a git commit (40 lowercase hex, that and -dirty, or unknown)";
  if (typeof o.j !== "string" || !HASH_RE.test(o.j)) return "j is not a lowercase 32-byte hash";
  const hasK = "k" in o;
  if (hasK && o.k !== "probe" && o.k !== "bill") return "k is neither probe nor bill";
  if (hasK && "m" in o) return "m is present although k is";
  if (!hasK && (typeof o.m !== "string" || !MODEL_RE.test(o.m))) return "m is not a model id";
  if (!hasK && denied(o.m as string)) return "m matches the URL or key pattern";
  let q: number[] | undefined;
  if ("q" in o) {
    if (hasK) return "q is present although k is";
    const v = o.q;
    if (!Array.isArray(v) || v.length < 1 || v.length > 3 || !v.every(isNat) || v.some((x, i) => i > 0 && x <= v[i - 1]!)) {
      return "q is not 1 to 3 ascending brief ids";
    }
    q = v as number[];
  }
  if (typeof o.r !== "string" || !RUN_RE.test(o.r)) return "r is not a run id";
  if (denied(o.r)) return "r matches the URL or key pattern";
  if (!Array.isArray(o.s) || o.s.length > 16) return "s is not a list of at most 16 sources";
  const s: BlobSource[] = [];
  for (const [i, e] of o.s.entries()) {
    const src = sourceOf(e);
    if (!src) return `s entry ${i + 1} is not [symbol, round id, updatedAt, premium]`;
    s.push(src);
  }
  if (typeof o.t !== "string" || o.t.length < 1 || o.t.length > 600) return "t is not 1 to 600 characters";
  if (o.k === "probe" && !o.t.startsWith(PROBE_TEXT_PREFIX)) return `a probe's t does not start with "${PROBE_TEXT_PREFIX}"`;
  if (o.k === "bill" && !o.t.startsWith(BILL_TEXT_PREFIX)) return `a bill's t does not start with "${BILL_TEXT_PREFIX.trim()}"`;
  const out: BlobV1 = { b: o.b, c: o.c, j: o.j as Hash, r: o.r, s, t: o.t };
  if (hasK) out.k = o.k as "probe" | "bill";
  else out.m = o.m as string;
  if (q) out.q = q;
  return out;
}

/** Validates the bytes of a blob that starts with `maat:v1:` (§2.6). */
function validateBlob(bytes: Uint8Array): DecodedBlob {
  const invalid = (problem: string): DecodedBlob => ({ status: "invalid", bytes: bytes.length, problem });
  if (bytes.length > MAX_BLOB_BYTES) return invalid(`it is ${bytes.length} bytes, over the ${MAX_BLOB_BYTES}-byte cap`);
  if (bytes.some((x) => x < 0x20 || x > 0x7e)) return invalid("it holds a byte outside printable ASCII");
  const text = latin1(bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(BLOB_PREFIX.length));
  } catch {
    return invalid("the text after maat:v1: is not JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return invalid("the text after maat:v1: is not a JSON object");
  const fields = blobFields(parsed as Record<string, unknown>);
  if (typeof fields === "string") return invalid(fields);
  let canonical: string;
  try {
    canonical = BLOB_PREFIX + canon(parsed);
  } catch {
    return invalid("it holds a number that is not a safe integer");
  }
  if (canonical !== text) return invalid("it is not in canonical form (key order, spacing or a repeated key)");
  return { status: "v1", text, fields };
}

/**
 * Splits the input of a transaction sent to the vault into the intent, the blob and the ERC-8021 suffix (§1). Returns
 * null when the input is not a direct `execute` call: then it carries no blob and no suffix the page reads.
 */
export function decodeExecuteInput(input: Hex): ExecuteCall | null {
  let d: Uint8Array;
  try {
    d = hexToBytes(input);
  } catch {
    return null;
  }
  const len = d.length;
  if (len < EXECUTE_BYTES || bytesToHex(d.subarray(0, 4)) !== EXECUTE_SELECTOR) return null;
  // The suffix is read from the end: codes, their length (1 byte), schema id 0x00, the 16-byte marker (§1 step 2).
  let end = len;
  let codes: string[] | null = null;
  if (len >= EXECUTE_BYTES + 18 && bytesToHex(d.subarray(len - 16)).slice(2) === ERC8021_MARKER && d[len - 17] === 0) {
    const start = len - 18 - d[len - 18]!;
    if (start >= EXECUTE_BYTES) {
      end = start;
      codes = latin1(d.subarray(start, len - 18)).split(",");
    }
  }
  const b = d.subarray(EXECUTE_BYTES, end);
  const prefix = toBytes(BLOB_PREFIX);
  const blob: DecodedBlob =
    b.length === 0
      ? { status: "none" }
      : b.length >= prefix.length && prefix.every((x, i) => b[i] === x)
        ? validateBlob(b)
        : { status: "foreign", bytes: b.length };
  return {
    intentRationaleHash: bytesToHex(d.subarray(196, 228)) as Hash,
    blob,
    blobHash: b.length === 0 ? null : keccak256(b),
    codes,
  };
}
