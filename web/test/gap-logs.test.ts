// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
});
