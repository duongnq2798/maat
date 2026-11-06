import { Attribution } from "ox/erc8021";
import { concat, type Hex } from "viem";

/** Same rule as the Builder Codes registry (research/06-builder-codes.md §1). */
export const BUILDER_CODE_RE = /^[a-z0-9_]{1,32}$/;

/** ERC-8021 schema-0 suffix. Generated with ox: the hex example in Base's docs has the bytes in the wrong order. */
export function builderSuffix(code: string): Hex {
  if (!BUILDER_CODE_RE.test(code)) throw new Error(`invalid builder code "${code}"`);
  return Attribution.toDataSuffix({ codes: [code] }) as Hex;
}

export function withSuffix(data: Hex, suffix: Hex): Hex {
  return concat([data, suffix]);
}

export function codesIn(input: Hex): readonly string[] {
  try {
    const a = Attribution.fromData(input) as { codes?: readonly string[] } | undefined;
    return a?.codes ?? [];
  } catch {
    return [];
  }
}
