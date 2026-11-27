// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANSWER_UPDATED_TOPIC, SWAP_TOPIC, type RawLog } from "@/lib/gap/decode";
import { createLogSource } from "@/lib/gap/logs";
import { SPAN, type LogReader } from "@/lib/gap/rpc";

const word = (n: bigint) => n.toString(16).padStart(64, "0");
const swapLog = (block: number, idx: number, sqrt: bigint): RawLog => ({
  address: "0xpool",
  topics: [SWAP_TOPIC],
  data: `0x${word(0n)}${word(0n)}${word(sqrt)}${word(0n)}${word(0n)}`,
  blockNumber: `0x${block.toString(16)}`,
  logIndex: `0x${idx.toString(16)}`,
  transactionHash: "0xAB",
  blockTimestamp: `0x${(block * 2).toString(16)}`,
});
const answerLog = (block: number, answer: bigint): RawLog => ({
  address: "0xAgg",
  topics: [ANSWER_UPDATED_TOPIC, `0x${word(answer & ((1n << 256n) - 1n))}`],
  data: "0x",
  blockNumber: `0x${block.toString(16)}`,
  logIndex: "0x0",
  transactionHash: "0xCD",
  blockTimestamp: `0x${(block * 2).toString(16)}`,
});

function reader(logs: RawLog[]) {
  const asked: Array<[number, number]> = [];
  const r = {
    async getLogs(q: { from: number; to: number }) {
      asked.push([q.from, q.to]);
      return logs.filter((l) => Number(l.blockNumber) >= q.from && Number(l.blockNumber) <= q.to);
    },
  } as unknown as LogReader;
  return { r, asked };
}

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gap-logs-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const head = 10 * SPAN;

describe("createLogSource", () => {
  it("reads a range again from the cache with no call", async () => {
    const { r, asked } = reader([swapLog(100, 0, 5n), swapLog(200, 1, 7n)]);
    const a = await createLogSource(r, { cacheDir: dir, headBlock: head }).swaps("0xpool", 0, 1000);
    expect(a.map((s) => s.sqrtPriceX96)).toEqual([5n, 7n]);
    expect(asked).toEqual([[0, SPAN - 1]]);
    const b = await createLogSource(r, { cacheDir: dir, headBlock: head }).swaps("0xpool", 0, 1000);
    expect(b).toEqual(a);
    expect(asked.length).toBe(1);
    expect(fs.readdirSync(dir)).toEqual([`swap-0xpool-0-${SPAN - 1}.json`]);
  });

  it("stores bigints as hex strings, negative answers included", async () => {
    const { r } = reader([answerLog(50, -3n)]);
    const first = await createLogSource(r, { cacheDir: dir, headBlock: head }).updates(["0xAgg"], 0, 100);
    expect(first[0]!.answer).toBe(-3n);
    const second = await createLogSource(reader([]).r, { cacheDir: dir, headBlock: head }).updates(["0xAgg"], 0, 100);
    expect(second).toEqual(first);
  });

  it("never writes a span within 1,000 blocks of the head", async () => {
    const { r, asked } = reader([swapLog(100, 0, 5n)]);
    const src = createLogSource(r, { cacheDir: dir, headBlock: SPAN + 500 });
    await src.swaps("0xpool", SPAN, SPAN + 400);
    await src.swaps("0xpool", SPAN, SPAN + 400);
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(asked).toEqual([
      [SPAN, SPAN + 500],
      [SPAN, SPAN + 500],
    ]);
  });

  it("replaces a corrupt cache file", async () => {
    const { r, asked } = reader([swapLog(100, 0, 5n)]);
    const file = path.join(dir, `swap-0xpool-0-${SPAN - 1}.json`);
    for (const bad of ["{not json", '{"rows":"x"}', '[{"block":1}]']) {
      fs.writeFileSync(file, bad);
      const out = await createLogSource(r, { cacheDir: dir, headBlock: head }).swaps("0xpool", 0, 1000);
      expect(out.length).toBe(1);
      expect(() => JSON.parse(fs.readFileSync(file, "utf8"))).not.toThrow();
    }
    expect(asked.length).toBe(3);
    await createLogSource(r, { cacheDir: dir, headBlock: head }).swaps("0xpool", 0, 1000);
    expect(asked.length).toBe(3);
  });

  it("writes nothing with cacheDir null", async () => {
    const { r, asked } = reader([swapLog(100, 0, 5n)]);
    const src = createLogSource(r, { cacheDir: null, headBlock: head });
    await src.swaps("0xpool", 0, 1000);
    await src.swaps("0xpool", 0, 1000);
    expect(asked.length).toBe(2);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("filters rows to [from, to] across aligned spans", async () => {
    const { r, asked } = reader([swapLog(100, 0, 1n), swapLog(500, 0, 2n), swapLog(SPAN + 5, 0, 3n), swapLog(SPAN + 900, 0, 4n)]);
    const out = await createLogSource(r, { cacheDir: dir, headBlock: head }).swaps("0xpool", 200, SPAN + 10);
    expect(out.map((s) => s.block)).toEqual([500, SPAN + 5]);
    expect(asked).toEqual([
      [0, SPAN - 1],
      [SPAN, 2 * SPAN - 1],
    ]);
  });

  it("keys answer files by the joined addresses", async () => {
    const { r } = reader([]);
    await createLogSource(r, { cacheDir: dir, headBlock: head }).updates(["0xa", "0xb"], 0, 10);
    expect(fs.readdirSync(dir)).toEqual([`answer-0xa_0xb-0-${SPAN - 1}.json`]);
  });

  it("caches a span ending exactly 1,000 blocks below the head and not one block closer", async () => {
    const at = { r: reader([]).r };
    await createLogSource(at.r, { cacheDir: dir, headBlock: SPAN - 1 + 1000 }).swaps("0xpool", 0, 10);
    expect(fs.readdirSync(dir)).toEqual([`swap-0xpool-0-${SPAN - 1}.json`]);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir);
    await createLogSource(at.r, { cacheDir: dir, headBlock: SPAN - 1 + 999 }).swaps("0xpool", 0, 10);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("reports each span it reads: its cache file name, whether it came from Base or the cache, and whether its file now holds it", async () => {
    const { r } = reader([answerLog(50, 3n), answerLog(SPAN + 50, 4n)]);
    const seen: unknown[] = [];
    const opts = { cacheDir: dir, headBlock: 2 * SPAN + 5_000, onSpan: (s: unknown) => seen.push(s) };
    await createLogSource(r, opts).updates(["0xAgg"], 0, 2 * SPAN + 100);
    await createLogSource(r, opts).updates(["0xAgg"], 0, 2 * SPAN + 100);
    const first = [
      { name: `answer-0xagg-0-${SPAN - 1}.json`, spanFrom: 0, spanTo: SPAN - 1, from: "rpc", kept: true },
      { name: `answer-0xagg-${SPAN}-${2 * SPAN - 1}.json`, spanFrom: SPAN, spanTo: 2 * SPAN - 1, from: "rpc", kept: true },
      // the span that holds the head: read, and never kept
      { name: `answer-0xagg-${2 * SPAN}-${2 * SPAN + 5_000}.json`, spanFrom: 2 * SPAN, spanTo: 2 * SPAN + 5_000, from: "rpc", kept: false },
    ];
    expect(seen).toEqual([...first, { ...first[0], from: "cache" }, { ...first[1], from: "cache" }, first[2]]);

    const none: unknown[] = [];
    await createLogSource(reader([]).r, { cacheDir: null, headBlock: 2 * SPAN + 5_000, onSpan: (s) => none.push(s) }).swaps("0xpool", 0, 10);
    expect(none).toEqual([{ name: `swap-0xpool-0-${SPAN - 1}.json`, spanFrom: 0, spanTo: SPAN - 1, from: "rpc", kept: false }]);
  });

  it("returns the rows and leaves no temp file when the cache write fails", async () => {
    const blocker = path.join(dir, "blocker");
    fs.writeFileSync(blocker, "x");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { r } = reader([swapLog(100, 0, 5n)]);
      const out = await createLogSource(r, { cacheDir: path.join(blocker, "sub"), headBlock: head }).swaps("0xpool", 0, 1000);
      expect(out.map((s) => s.sqrtPriceX96)).toEqual([5n]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toContain(`swap-0xpool-0-${SPAN - 1}.json`);
      // a write that fails after the directory exists leaves no .tmp behind
      const real = fs.renameSync;
      const ren = vi.spyOn(fs, "renameSync").mockImplementation(() => {
        throw new Error("disk full");
      });
      const out2 = await createLogSource(r, { cacheDir: dir, headBlock: head }).swaps("0xpool", 0, 1000);
      ren.mockRestore();
      expect(real).toBe(fs.renameSync);
      expect(out2.length).toBe(1);
      expect(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });

  it("reports a span whose cache write failed as not kept, with the write's error, and a span it never tried to write with none", async () => {
    const blocker = path.join(dir, "blocker");
    fs.writeFileSync(blocker, "x");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const seen: Array<Record<string, unknown>> = [];
      const { r } = reader([answerLog(50, 3n)]);
      await createLogSource(r, { cacheDir: blocker, headBlock: SPAN + 5_000, onSpan: (s) => seen.push({ ...s }) }).updates(["0xAgg"], 0, SPAN + 100);
      expect(seen.map((s) => [s.spanFrom, s.from, s.kept])).toEqual([
        [0, "rpc", false],
        [SPAN, "rpc", false],
      ]);
      // The settled span was read and its write failed: the report says why. The head's span was never written.
      expect(seen[0]!.writeError).toMatch(/EEXIST|ENOTDIR/);
      expect(seen[1]).not.toHaveProperty("writeError");
    } finally {
      warn.mockRestore();
    }
  });
});
