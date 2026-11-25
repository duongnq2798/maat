import { bytesToHex, getAddress, hexToBytes, keccak256, type Address, type Hex } from "viem";
import { BLOB_PREFIX, validateBlob, type BlobFields } from "./blob.js";

/**
 * Reads a vault transaction's input the way the maat:v1 spec lays it out (§1): `execute(intent)` (selector and seven
 * static words), then the blob, then the ERC-8021 schema-0 suffix. The end of the blob is the start of the suffix,
 * found from the end of the input, never by parsing the blob.
 */

/** execute((bytes32,uint8,address,uint256,uint256,address,bytes32)). */
export const EXECUTE_SELECTOR: Hex = "0x4ad3993f";
/** `execute(Intent)` calldata is always this long: a static struct of seven words after the selector. */
export const EXECUTE_BYTES = 228;
/** keccak256 of no bytes: the rationaleHash word of an intent that commits to no text. */
export const EMPTY_HASH: Hex = "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";

const MARKER = hexToBytes("0x80218021802180218021802180218021");
/** The intent's rationaleHash is its seventh word. */
const HASH_AT = 196;

export type BlobStatus = "none" | "v1" | "invalid" | "foreign";

export interface DecodedExecute {
  /** Intent.rationaleHash: what the vault emits unchanged as the Decision's rationaleHash. */
  rationaleHash: Hex;
  status: BlobStatus;
  /** The length of the blob region, 0 for `none`. */
  blobBytes: number;
  /** The blob region's text for `v1` and `invalid`; null for `none` and `foreign`, which are not decoded. */
  blob: string | null;
  /** The fields of a `v1` blob. */
  fields?: BlobFields;
  /** The first rule an `invalid` blob breaks. */
  problem?: string;
  /** keccak256 of the blob region; null when it is empty. */
  blobHash: Hex | null;
  /** Whether blobHash equals rationaleHash; null when there is no blob (its text is verified elsewhere). */
  hashTick: boolean | null;
  /** The schema-0 suffix's codes; null when no suffix is recognized. */
  codes: string[] | null;
  /** S: where the suffix starts, or the input length when there is none. */
  suffixStart: number;
}

const ascii = (b: Uint8Array) => String.fromCharCode(...b);

/** §1 decoder steps 1-4 for the input of a transaction to the vault. Null when it is not a direct execute call. */
export function decodeExecuteInput(input: Hex): DecodedExecute | null {
  const d = hexToBytes(input);
  const L = d.length;
  if (L < EXECUTE_BYTES || bytesToHex(d.subarray(0, 4)) !== EXECUTE_SELECTOR) return null;

  let S = L;
  let codes: string[] | null = null;
  if (L >= EXECUTE_BYTES + 18 && MARKER.every((x, i) => d[L - 16 + i] === x) && d[L - 17] === 0x00) {
    const start = L - 18 - d[L - 18]!;
    if (start >= EXECUTE_BYTES) {
      S = start;
      codes = ascii(d.subarray(start, L - 18)).split(",");
    }
  }

  const rationaleHash = bytesToHex(d.subarray(HASH_AT, EXECUTE_BYTES));
  const region = d.subarray(EXECUTE_BYTES, S);
  const base = { rationaleHash, blobBytes: region.length, codes, suffixStart: S };
  if (region.length === 0) return { ...base, status: "none", blob: null, blobHash: null, hashTick: null };

  const blobHash = keccak256(region);
  const tick = { blobHash, hashTick: blobHash === rationaleHash };
  if (ascii(region.subarray(0, BLOB_PREFIX.length)) !== BLOB_PREFIX) return { ...base, ...tick, status: "foreign", blob: null };
  const check = validateBlob(region);
  return check.status === "v1"
    ? { ...base, ...tick, status: "v1", blob: ascii(region), fields: check.fields }
    : { ...base, ...tick, status: "invalid", blob: ascii(region), problem: check.problem };
}

export type SenderLabel = "owner, by hand" | "probe" | "brief-driven" | "agent";

/**
 * Who sent a Decision (§4), first match wins. `execute` reverts unless msg.sender is the executor and the vault's
 * owner is immutable, so a direct call from the owner is the owner acting as executor, whatever its calldata carries.
 */
export function senderLabel(o: { from: Address; owner: Address; decoded: DecodedExecute | null }): SenderLabel {
  if (getAddress(o.from) === getAddress(o.owner)) return "owner, by hand";
  const f = o.decoded?.status === "v1" ? o.decoded.fields : undefined;
  if (f?.k === "probe") return "probe";
  if (f?.q !== undefined) return "brief-driven";
  return "agent";
}
