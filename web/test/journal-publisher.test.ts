// @vitest-environment node
import { keccak256, toBytes, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { planAppend, readLocalChain } from "../../ops/journal/lib/chain.mjs";
import { keccak256 as publisherKeccak } from "../../ops/journal/lib/keccak.mjs";
import { readRepo } from "./helpers/solidity";

// The journal publisher (ops/journal) appends the agent's journal to the public agent-journal branch. CI runs the web
// unit tests, so this file checks the chain it writes there: the published fixture files are verified here as a
// browser verifier would (maat:v1 spec §3.6), with viem's keccak256 and a canon written again below, not the
// publisher's own code. Then the publisher must write exactly those files for the fixture journal.

const FIXTURES = "ops/journal/test/fixtures";
const GENESIS: Hex = `0x${"0".repeat(64)}`;

/** The spec's canonical JSON (§2.2), written apart from the publisher's. */
function canon(v: unknown): string {
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

interface Day {
  name: string;
  text: string;
}

/** §3.6 steps 2 and 3: every line canonical, its hash keccak256 of its other fields, its prev the line before's hash. */
function verify(files: readonly Day[]): { rows: number; head: Hex | null; failure: string | null } {
  let prev: Hex = GENESIS;
  let rows = 0;
  for (const { name, text } of files) {
    if (!text.endsWith("\n")) return { rows, head: rows ? prev : null, failure: `${name}: no final line feed` };
    const lines = text.slice(0, -1).split("\n");
    for (const [i, line] of lines.entries()) {
      const at = `${name} line ${i + 1}`;
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (canon(parsed) !== line) return { rows, head: rows ? prev : null, failure: `${at}: not canonical` };
      const { hash, ...rest } = parsed;
      if (rest.prev !== prev) return { rows, head: rows ? prev : null, failure: `${at}: prev` };
      if (keccak256(toBytes(canon(rest))) !== hash) return { rows, head: rows ? prev : null, failure: `${at}: hash` };
      prev = hash as Hex;
      rows++;
    }
  }
  return { rows, head: rows ? prev : null, failure: null };
}

const index = JSON.parse(readRepo(`${FIXTURES}/published/index.json`)) as { days: string[]; head: Hex; rows: number; v: number };
const days: Day[] = index.days.map((name) => ({ name, text: readRepo(`${FIXTURES}/published/${name}`) }));

describe("the journal publisher's published fixture, checked with viem", () => {
  it("chains from GENESIS through every day file that index.json lists, to the head and row count it gives", () => {
    expect(index.v).toBe(1);
    expect(index.days).toEqual(["2026-11-24.jsonl", "2026-11-25.jsonl"]);
    expect(verify(days)).toEqual({ rows: index.rows, head: index.head, failure: null });
    expect(index.rows).toBe(11);
  });

  it("opens with the spec's two §5.7 lines, whose hashes the spec gives", () => {
    const [first, second] = (days[0]?.text ?? "").split("\n").map((l) => (l === "" ? undefined : (JSON.parse(l) as { hash: string; prev: string })));
    expect(first?.prev).toBe(GENESIS);
    expect(first?.hash).toBe("0x892d2dce569c783139f62dec297729642d35ff7e88bccd9d21dcb2defe2b84ff");
    expect(second?.hash).toBe("0x3a54dfb09811088c8f2ffdecf4666c6e34f721a7e4166f1a6557dc3133ec4f8c");
  });

  it("fails at an edited line, a removed line and two lines swapped", () => {
    const [d1, d2] = days as [Day, Day];
    const lines = d1.text.split("\n");
    expect(verify([{ ...d1, text: d1.text.replace("One buy proposed.", "Two buys proposed.") }, d2]).failure).toBe("2026-11-24.jsonl line 1: hash");
    expect(verify([{ ...d1, text: `${lines.slice(1).join("\n")}` }, d2]).failure).toBe("2026-11-24.jsonl line 1: prev");
    expect(verify([{ ...d1, text: [lines[1], lines[0], ...lines.slice(2)].join("\n") }, d2]).failure).toBe("2026-11-24.jsonl line 1: prev");
    expect(verify([d2, d1]).failure).toBe("2026-11-25.jsonl line 1: prev");
  });

  it("holds no field the projection keeps on the PC", () => {
    const all = days.map((d) => d.text).join("");
    for (const key of ["rationale", "previewError", "error", "message", "note"]) expect(all).not.toContain(`"${key}":`);
    expect(all).not.toMatch(/fake|https?:\/\//);
  });

  it("is what the publisher writes for the fixture journal, byte for byte", () => {
    const plan = planAppend({ local: readLocalChain(readRepo(`${FIXTURES}/journal.jsonl`)), files: [], allowDryRun: true });
    expect(plan.files).toEqual(days);
    expect(plan.index).toBe(readRepo(`${FIXTURES}/published/index.json`));
  });

  it("computes keccak256 as viem does, at every length across the 136-byte block edges", () => {
    for (let n = 0; n <= 410; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 131 + n * 7) & 0xff);
      expect(publisherKeccak(bytes), `length ${n}`).toBe(keccak256(bytes));
    }
    expect(publisherKeccak("maat:v1:é\u{1F680}")).toBe(keccak256(toBytes("maat:v1:é\u{1F680}")));
  });
});
