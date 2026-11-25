import { concat, toHex, type Hex } from "viem";
import { briefCalldata } from "@/lib/chain/inbox";

/** The Builder Codes registry's rule for a code, the same as agent/src/exec/builderCode.ts. */
export const BUILDER_CODE_RE = /^[a-z0-9_]{1,32}$/;

/** The 16 bytes that end an ERC-8021 suffix. */
const MARKER = "8021".repeat(8);

/**
 * The ERC-8021 schema-0 suffix of one code: its bytes, their count (1 byte), schema id 0x00, then the marker. It is the
 * layout lib/chain/rationale.ts decodeExecuteInput reads back from the vault's Decision calldata.
 */
export function erc8021Suffix(code: string): Hex {
  if (!BUILDER_CODE_RE.test(code)) throw new Error(`"${code}" is not a Builder Code: 1 to 32 of a-z, 0-9 and _`);
  const bytes = toHex(code).slice(2);
  return `0x${bytes}${(bytes.length / 2).toString(16).padStart(2, "0")}00${MARKER}`;
}

/**
 * Where a transaction's input carries `suffix`, at whole bytes: at its end, as a browser wallet's brief does; inside
 * it, as a smart wallet's call can; or nowhere.
 */
export function suffixIn(input: Hex, suffix: Hex): "end" | "inside" | "none" {
  const data = input.slice(2).toLowerCase();
  const s = suffix.slice(2).toLowerCase();
  if (data.endsWith(s) && (data.length - s.length) % 2 === 0) return "end";
  for (let i = data.indexOf(s); i !== -1; i = data.indexOf(s, i + 1)) if (i % 2 === 0) return "inside";
  return "none";
}

/** The input of a brief transaction: brief(text) calldata, then `suffix` when there is one. MaatInbox ignores the suffix. */
export function briefTxData(text: string, suffix: Hex | null): Hex {
  const data = briefCalldata(text);
  return suffix ? concat([data, suffix]) : data;
}
