import { readFileSync } from "node:fs";
import { join } from "node:path";
import { keccak256, toBytes, toHex, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import {
  BILL_TEXT_PREFIX,
  BLOB_PREFIX,
  BlobError,
  closedSuffix,
  encodeBlob,
  GENESIS,
  MAX_BLOB_BYTES,
  MAX_SOURCES,
  MAX_TEXT_CHARS,
  PROBE_TEXT_PREFIX,
  validateBlob,
  type BlobInput,
  type Source,
} from "../src/rationale/blob.js";
import { canon } from "../src/rationale/canon.js";
import { cutTo } from "../src/rationale/sanitize.js";

/** The §5 vectors, copied byte for byte out of the spec's table and its hex block. */
const VECTORS: Record<string, { hex: Hex; bytes: number; hash: Hex }> = JSON.parse(
  readFileSync(join(import.meta.dirname, "fixtures", "maat-v1-vectors.json"), "utf8"),
);

// §5 shared inputs.
const C = "0123456789abcdef0123456789abcdef01234567";
const R = "1795539542000-a1b2c3d4";
const J: Hex = "0x892d2dce569c783139f62dec297729642d35ff7e88bccd9d21dcb2defe2b84ff";
const B = 61745836;
const S: Source[] = [
  ["NVDAc", "36893488147419105055", 1795539382, 19],
  ["GOOGLc", "36893488147419104206", 1795536312, 15],
  ["AAPLc", "36893488147419103860", 1795535458, 23],
];
const M = "claude-sonnet-5-5";
const T1 = "Fixture rationale: NVDAc is under its target weight and the feed is fresh, so buy 5 USD.";
const THANKSGIVING = "NYSE holiday: Thanksgiving";

const base: BlobInput = { b: B, c: C, j: J, m: M, r: R, s: S, text: T1 };

const INPUTS: Record<string, BlobInput> = {
  V1: base,
  V2: { ...base, text: "Fixture — premium check.\nSee https://basescan.org/tx/0xabc and www.example.com/x for context; vault says “no”." },
  V3: { ...base, text: "Fixture text: " + 'He said "no" and "wait". '.repeat(30) },
  V4: { b: B, c: C, j: J, k: "probe", r: "probe-2026-11-27T17:58:00Z", s: S, text: "PROBE v1, not a Claude proposal. Expected OK before the 13:00 ET early close." },
  V5: { ...base, q: [7], text: "Brief 7 asked for a 5 USD NVDAc buy; adopted inside the mandate." },
  V6: { ...base, closed: THANKSGIVING },
  V7: { ...base, closed: THANKSGIVING, text: "Fixture text: " + "NVDAc is under its target. ".repeat(21) },
};

const bytesOf = (blob: string) => toBytes(blob).length;

describe("the §5 test vectors, byte for byte", () => {
  it.each(Object.keys(INPUTS))("%s", (name) => {
    const want = VECTORS[name]!;
    const got = encodeBlob(INPUTS[name]!);
    expect(toHex(toBytes(got.blob))).toBe(want.hex);
    expect(bytesOf(got.blob)).toBe(want.bytes);
    expect(got.hash).toBe(want.hash);
    expect(keccak256(toBytes(got.blob))).toBe(want.hash);
    expect(validateBlob(got.blob)).toMatchObject({ status: "v1" });
  });

  it("V3 cuts at a space to 600 characters, then by the byte cap to 584 and exactly 1,024 bytes", () => {
    expect(INPUTS.V3!.text).toHaveLength(764);
    const got = encodeBlob(INPUTS.V3!);
    expect(got.fields.t).toHaveLength(584);
    expect(got.fields.t.endsWith(' He said "no" and ...')).toBe(true);
    expect(bytesOf(got.blob)).toBe(MAX_BLOB_BYTES);
  });

  it("V6 and V7 keep the closed-market note whole and cut only the text before it", () => {
    expect(closedSuffix(THANKSGIVING)).toBe(" (market closed, NYSE holiday: Thanksgiving)");
    expect(closedSuffix(THANKSGIVING)).toHaveLength(44);
    expect(encodeBlob(INPUTS.V6!).fields.t).toBe(`${T1} (market closed, ${THANKSGIVING})`);
    const v7 = encodeBlob(INPUTS.V7!).fields.t;
    expect(INPUTS.V7!.text).toHaveLength(581);
    expect(v7).toHaveLength(593);
    expect(v7.endsWith("NVDAc is under its ... (market closed, NYSE holiday: Thanksgiving)")).toBe(true);
  });

  it("puts t last, so the Basescan UTF-8 view ends with the words", () => {
    const blob = encodeBlob(base).blob;
    expect(blob.startsWith(`${BLOB_PREFIX}{"b":`)).toBe(true);
    expect(blob.endsWith(`"t":${JSON.stringify(T1)}}`)).toBe(true);
  });
});

describe("the 1,024-byte cap (spec §2.4)", () => {
  /** A 16-entry `s` with every value at its widest. */
  const wide = (n: number): Source[] =>
    Array.from({ length: n }, (_, i) => [`0x${i.toString(16).padStart(40, "a")}`, "9".repeat(25), Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]);
  const MAX = Number.MAX_SAFE_INTEGER;
  const widest: BlobInput = { b: MAX, c: `${C}-dirty`, j: J, m: `m${"x".repeat(63)}`, q: [MAX - 2, MAX - 1, MAX], r: "r".repeat(64), s: [], text: "w ".repeat(400) };
  /** Text of exactly `n` characters in 29-letter words, none long enough for LONG_RE. */
  const words = (n: number) => {
    const t = `${"w".repeat(29)} `.repeat(Math.ceil(n / 30) + 1).slice(0, n);
    return t.endsWith(" ") ? `${t.slice(0, -1)}w` : t;
  };
  // With every entry named by its address, the text alone decides whether the blob reaches the cap.
  const roomy: BlobInput = { ...base, s: wide(3) };
  /** The text length that makes `roomy`'s blob exactly 1,024 bytes. */
  const room = MAX_BLOB_BYTES - (bytesOf(encodeBlob({ ...roomy, text: "x" }).blob) - 1);

  it("fits a blob of exactly 1,024 bytes unchanged", () => {
    expect(room).toBeLessThanOrEqual(MAX_TEXT_CHARS);
    const exact = encodeBlob({ ...roomy, text: words(room) });
    expect(bytesOf(exact.blob)).toBe(MAX_BLOB_BYTES);
    expect(exact.fields.t).toBe(words(room));
  });

  it("cuts a blob one byte over the cap back to its longest cut that fits", () => {
    const over = encodeBlob({ ...roomy, text: words(room + 1) });
    expect(over.fields.t).toBe(cutTo(words(room + 1), room));
    expect(over.fields.t.endsWith("w ...")).toBe(true);
    expect(bytesOf(over.blob)).toBeLessThanOrEqual(MAX_BLOB_BYTES);
    expect(bytesOf(over.blob)).toBeGreaterThan(MAX_BLOB_BYTES - 30);
  });

  it("counts a quote or a backslash as two bytes", () => {
    const quoted = encodeBlob({ ...base, text: '"\\ '.repeat(199) });
    expect(bytesOf(quoted.blob)).toBeLessThanOrEqual(MAX_BLOB_BYTES);
    // Each `"\ ` costs 5 bytes, so the cut lands less than one unit under the cap.
    expect(bytesOf(quoted.blob)).toBeGreaterThan(MAX_BLOB_BYTES - 5);
    expect(quoted.fields.t.endsWith('"\\ ...')).toBe(true);
    expect(validateBlob(quoted.blob)).toMatchObject({ status: "v1" });
  });

  it("drops s entries from the end only when the ellipsis alone does not fit", () => {
    const got = encodeBlob({ ...widest, s: wide(MAX_SOURCES) });
    expect(got.fields.t).toBe("...");
    expect(got.fields.s.length).toBeLessThan(MAX_SOURCES);
    expect(got.fields.s).toEqual(wide(MAX_SOURCES).slice(0, got.fields.s.length));
    expect(bytesOf(got.blob)).toBeLessThanOrEqual(MAX_BLOB_BYTES);
    // One more entry would not have fitted.
    const more = BLOB_PREFIX + canon({ ...got.fields, s: wide(got.fields.s.length + 1) });
    expect(bytesOf(more)).toBeGreaterThan(MAX_BLOB_BYTES);
  });

  it("keeps the note when it has to drop s entries", () => {
    const longest = "NYSE holiday: Independence Day (observed)";
    expect(closedSuffix(longest)).toHaveLength(59);
    const got = encodeBlob({ ...widest, s: wide(MAX_SOURCES), closed: longest });
    expect(got.fields.t).toBe(`...${closedSuffix(longest)}`);
    expect(bytesOf(got.blob)).toBeLessThanOrEqual(MAX_BLOB_BYTES);
  });

  it("matches the spec's sizes: 372 bytes with s empty and t '...', 623 with three symbol entries, 701 with addresses", () => {
    const min = { ...widest, text: "..." };
    expect(bytesOf(encodeBlob(min).blob)).toBe(372);
    const named: Source[] = ["A", "B", "C"].map((x) => [x.repeat(16), "9".repeat(25), MAX, -MAX]);
    expect(bytesOf(encodeBlob({ ...min, s: named }).blob)).toBe(623);
    expect(bytesOf(encodeBlob({ ...min, s: wide(3) }).blob)).toBe(701);
  });
});

describe("what the encoder refuses (spec §2.1)", () => {
  const refuses = (over: Partial<BlobInput>, why: RegExp) => expect(() => encodeBlob({ ...base, ...over } as BlobInput)).toThrow(why);

  it("throws a BlobError", () => {
    expect(() => encodeBlob({ ...base, b: -1 })).toThrow(BlobError);
  });

  it("checks b, c and j", () => {
    refuses({ b: -1 }, /b is not/);
    refuses({ b: 1.5 }, /b is not/);
    refuses({ c: "abc" }, /c is not/);
    refuses({ c: `${C.toUpperCase()}` }, /c is not/);
    expect(encodeBlob({ ...base, c: `${C}-dirty` }).fields.c).toBe(`${C}-dirty`);
    expect(encodeBlob({ ...base, c: "unknown" }).fields.c).toBe("unknown");
    refuses({ j: "0x1234" as Hex }, /j is not/);
    refuses({ j: J.toUpperCase().replace("0X", "0x") as Hex }, /j is not/);
    expect(encodeBlob({ ...base, j: GENESIS }).fields.j).toBe(GENESIS);
  });

  it("requires m without k and forbids it with k", () => {
    refuses({ m: undefined }, /m is required/);
    refuses({ k: "bill", text: `${BILL_TEXT_PREFIX}$1.00` }, /m is forbidden/);
    expect(encodeBlob({ ...base, m: undefined, k: "bill", text: `${BILL_TEXT_PREFIX}$1.00 of Claude API usage` }).fields).toMatchObject({ k: "bill", t: "Compute bill: $1.00 of Claude API usage" });
  });

  it("refuses a model id or run id that reads as a URL or a key", () => {
    refuses({ m: "us.anthropic.claude-sonnet-5-5" }, /m is not/);
    refuses({ m: "-claude" }, /m is not/);
    refuses({ m: `m${"x".repeat(64)}` }, /m is not/);
    refuses({ m: `sk-${"f".repeat(16)}` }, /m is not/);
    refuses({ r: "run.example.com" }, /r is not/);
    refuses({ r: "" }, /r is not/);
    refuses({ r: "r".repeat(65) }, /r is not/);
    refuses({ r: "run 1" }, /r is not/);
  });

  it("checks q: 1 to 3 strictly ascending ids, only without k", () => {
    refuses({ q: [] }, /q is not/);
    refuses({ q: [1, 2, 3, 4] }, /q is not/);
    refuses({ q: [2, 2] }, /q is not/);
    refuses({ q: [3, 1] }, /q is not/);
    refuses({ q: [-1] }, /q is not/);
    expect(() => encodeBlob({ b: B, c: C, j: J, k: "probe", q: [1], r: R, s: S, text: `${PROBE_TEXT_PREFIX}.` })).toThrow(/q is forbidden/);
    expect(encodeBlob({ ...base, q: [0, 5, 9] }).fields.q).toEqual([0, 5, 9]);
  });

  it("checks k and the text a probe or a bill must start with", () => {
    refuses({ m: undefined, k: "other" as never }, /k is not/);
    expect(() => encodeBlob({ b: B, c: C, j: J, k: "probe", r: R, s: S, text: "a probe" })).toThrow(/probe/);
    expect(() => encodeBlob({ b: B, c: C, j: J, k: "bill", r: R, s: S, text: "a bill" })).toThrow(/bill/);
  });

  it("checks every s entry and at most 16 of them", () => {
    refuses({ s: Array.from({ length: MAX_SOURCES + 1 }, () => S[0]!) }, /s has/);
    refuses({ s: [["NVDA-c", "1", 1, 1]] }, /s entry 1/);
    refuses({ s: [["0xB20000000000000000000078EE7CE2FE4908108C", "1", 1, 1]] }, /s entry 1/);
    refuses({ s: [["NVDAc", "01", 1, 1]] }, /s entry 1/);
    refuses({ s: [["NVDAc", "1".repeat(26), 1, 1]] }, /s entry 1/);
    refuses({ s: [["NVDAc", "1", -1, 1]] }, /s entry 1/);
    refuses({ s: [["NVDAc", "1", 1, 0.5]] }, /s entry 1/);
    refuses({ s: [S[0]!, ["NVDAc", "1", 1] as unknown as Source] }, /s entry 2/);
    expect(encodeBlob({ ...base, s: [["0xb20000000000000000000078ee7ce2fe4908108c", null, null, null]] }).fields.s).toEqual([["0xb20000000000000000000078ee7ce2fe4908108c", null, null, null]]);
    expect(encodeBlob({ ...base, s: [] }).fields.s).toEqual([]);
  });

  it("sanitizes t to 1 to 600 printable ASCII characters", () => {
    const t = encodeBlob({ ...base, text: `\u{1F680} café\u0007 ${"word ".repeat(200)}` }).fields.t;
    expect(t.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
    expect(t.startsWith("caf word word")).toBe(true);
    expect(/^[\x20-\x7e]+$/.test(t)).toBe(true);
    expect(encodeBlob({ ...base, text: "" }).fields.t).toBe("(no text)");
    expect(encodeBlob({ ...base, text: "\u0000\u0001" }).fields.t).toBe("(no text)");
  });

  it("refuses a closed-market note that is not plain code-written text", () => {
    refuses({ closed: "see www.example.com" }, /note/);
    refuses({ closed: "café" }, /note/);
  });
});

describe("validateBlob (spec §2.6)", () => {
  const v1 = encodeBlob(base).blob;
  const swap = (from: string, to: string) => validateBlob(v1.replace(from, to));

  it("accepts every vector and returns its fields", () => {
    for (const name of Object.keys(VECTORS)) {
      const text = Buffer.from(VECTORS[name]!.hex.slice(2), "hex").toString("latin1");
      expect(validateBlob(text)).toMatchObject({ status: "v1" });
    }
    expect(validateBlob(v1)).toEqual({ status: "v1", fields: { b: B, c: C, j: J, m: M, r: R, s: S, t: T1 } });
  });

  it("calls a blob invalid when it breaks any rule", () => {
    expect(validateBlob(`${v1.slice(0, -1)}${" ".repeat(MAX_BLOB_BYTES)}}`)).toMatchObject({ status: "invalid", problem: expect.stringMatching(/1024/) });
    expect(swap("Fixture", "Fixtüre")).toMatchObject({ status: "invalid", problem: expect.stringMatching(/printable ASCII/) });
    expect(swap('"b":61745836,', '"b":61745836, ')).toMatchObject({ status: "invalid", problem: expect.stringMatching(/canonical/) });
    expect(swap('{"b":61745836,"c"', '{"c"')).toMatchObject({ status: "invalid", problem: expect.stringMatching(/b is not/) });
    expect(validateBlob(`${BLOB_PREFIX}{"b":1,"b":1,${v1.slice(BLOB_PREFIX.length + 1 + '"b":61745836,'.length)}`)).toMatchObject({ status: "invalid" });
    expect(swap('"m":"claude-sonnet-5-5",', '"m":"claude-sonnet-5-5","x":1,')).toMatchObject({ status: "invalid", problem: expect.stringMatching(/key/) });
    expect(swap('"m":"claude-sonnet-5-5",', '"m":null,')).toMatchObject({ status: "invalid", problem: expect.stringMatching(/m is/) });
    expect(validateBlob(`${BLOB_PREFIX}[1]`)).toMatchObject({ status: "invalid", problem: expect.stringMatching(/object/) });
    expect(validateBlob(`${BLOB_PREFIX}{`)).toMatchObject({ status: "invalid", problem: expect.stringMatching(/JSON/) });
    expect(validateBlob(`${BLOB_PREFIX}{"b":1.5}`)).toMatchObject({ status: "invalid" });
    expect(validateBlob("maat:v2:{}")).toMatchObject({ status: "invalid", problem: expect.stringMatching(/maat:v1:/) });
  });
});
