import type { Hex } from "@/content/b20-nav";

/** The few ABI shapes the live reader needs. Every word is 32 bytes, written as 64 hex characters. */
const WORD = 64;
const MASK = (1n << 256n) - 1n;

export const SELECTORS = {
  aggregate3: "0x82ad56cb",
  getBlockNumber: "0x42cbb15c",
  getCurrentBlockTimestamp: "0x0f28c97d",
  isPaused: "0xbc61e733",
  uiMultiplier: "0xa60bf13d",
  effectiveAt: "0x97a4064f",
  latestRoundData: "0xfeaf968c",
  observe: "0x883bdbfd",
  isOpen: "0x3fef6f98",
} as const satisfies Record<string, Hex>;

export interface Call3 {
  target: Hex;
  allowFailure: boolean;
  callData: Hex;
}

export interface CallResult {
  success: boolean;
  returnData: Hex;
}

/** A 256-bit word, two's complement for negatives. */
export function word(n: bigint): string {
  return (n & MASK).toString(16).padStart(WORD, "0");
}

const strip = (h: Hex | string) => (h.startsWith("0x") ? h.slice(2) : h);
const pad32 = (hex: string) => hex.padEnd(Math.ceil(hex.length / WORD) * WORD, "0");

/** A call with only static arguments: the selector, then one word per argument. */
export function encodeCall(selector: Hex | "0x", ...args: bigint[]): Hex {
  return `0x${strip(selector)}${args.map(word).join("")}`;
}

/** observe(uint32[] secondsAgos). */
export function encodeObserve(secondsAgo: readonly number[]): Hex {
  return `0x${strip(SELECTORS.observe)}${word(0x20n)}${word(BigInt(secondsAgo.length))}${secondsAgo.map((s) => word(BigInt(s))).join("")}`;
}

/** The tail of a dynamic `bytes`: its length, then the data right-padded to a whole word. */
function bytesTail(data: Hex): string {
  const hex = strip(data);
  return `${word(BigInt(hex.length / 2))}${pad32(hex)}`;
}

/** An array of dynamic tuples: the length, one offset per element (from the first offset), then the elements. */
function dynamicArray(elements: readonly string[]): string {
  let offset = elements.length * 32;
  const heads: string[] = [];
  for (const e of elements) {
    heads.push(word(BigInt(offset)));
    offset += e.length / 2;
  }
  return `${word(BigInt(elements.length))}${heads.join("")}${elements.join("")}`;
}

/** aggregate3((address target, bool allowFailure, bytes callData)[] calls). */
export function encodeAggregate3(calls: readonly Call3[]): Hex {
  const tuples = calls.map((c) => `${word(BigInt(c.target))}${word(c.allowFailure ? 1n : 0n)}${word(0x60n)}${bytesTail(c.callData)}`);
  return `0x${strip(SELECTORS.aggregate3)}${word(0x20n)}${dynamicArray(tuples)}`;
}

/** The return of aggregate3, (bool success, bytes returnData)[]: what a node sends back. Tests and the e2e fake use it. */
export function encodeAggregate3Result(results: readonly CallResult[]): Hex {
  const tuples = results.map((r) => `${word(r.success ? 1n : 0n)}${word(0x40n)}${bytesTail(r.returnData)}`);
  return `0x${word(0x20n)}${dynamicArray(tuples)}`;
}

/** The word at byte offset `at`, or undefined past the end. */
function readWord(hex: string, at: number): bigint | undefined {
  const start = at * 2;
  if (start + WORD > hex.length) return undefined;
  return BigInt(`0x${hex.slice(start, start + WORD)}`);
}

function need(v: bigint | undefined, what: string): bigint {
  if (v === undefined) throw new Error(`aggregate3 result is cut short at ${what}`);
  return v;
}

/** Decode the aggregate3 return. A malformed body throws: the whole reading is then a failure. */
export function decodeAggregate3(data: Hex): CallResult[] {
  const hex = strip(data);
  const base = Number(need(readWord(hex, 0), "the array offset"));
  const n = Number(need(readWord(hex, base), "the array length"));
  const heads = base + 32;
  const out: CallResult[] = [];
  for (let i = 0; i < n; i++) {
    const at = heads + Number(need(readWord(hex, heads + i * 32), `offset ${i}`));
    const success = need(readWord(hex, at), `success ${i}`) === 1n;
    const bytesAt = at + Number(need(readWord(hex, at + 32), `bytes offset ${i}`));
    const len = Number(need(readWord(hex, bytesAt), `bytes length ${i}`));
    const start = (bytesAt + 32) * 2;
    if (start + len * 2 > hex.length) throw new Error(`aggregate3 result is cut short in returnData ${i}`);
    out.push({ success, returnData: `0x${hex.slice(start, start + len * 2)}` });
  }
  return out;
}

const signed = (w: bigint) => (w >= 1n << 255n ? w - (1n << 256n) : w);

/** The data of a successful call with at least `words` words, or null. */
function words(r: CallResult, count: number): string | null {
  if (!r.success) return null;
  const hex = strip(r.returnData);
  return hex.length >= count * WORD ? hex : null;
}

export function decodeUint(r: CallResult): bigint | null {
  const hex = words(r, 1);
  return hex === null ? null : (readWord(hex, 0) ?? null);
}

export function decodeBool(r: CallResult): boolean | null {
  const v = decodeUint(r);
  return v === null ? null : v !== 0n;
}

/** latestRoundData() → (roundId, answer, startedAt, updatedAt, answeredInRound). */
export function decodeRoundData(r: CallResult): { answer: bigint; updatedAt: bigint } | null {
  const hex = words(r, 5);
  if (hex === null) return null;
  return { answer: signed(readWord(hex, 32) ?? 0n), updatedAt: readWord(hex, 96) ?? 0n };
}

/** observe(uint32[]) → (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s). */
export function decodeObserve(r: CallResult): { tickCumulatives: bigint[] } | null {
  const hex = words(r, 2);
  if (hex === null) return null;
  const at = Number(readWord(hex, 0) ?? 0n);
  const n = readWord(hex, at);
  if (n === undefined || n > 64n) return null;
  const tickCumulatives: bigint[] = [];
  for (let i = 0; i < Number(n); i++) {
    const w = readWord(hex, at + 32 + i * 32);
    if (w === undefined) return null;
    tickCumulatives.push(signed(w));
  }
  return { tickCumulatives };
}
