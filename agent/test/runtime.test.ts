import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import { firstInLogWindows } from "../src/chain/logWindows.js";
import { loadConfig } from "../src/config.js";
import { GuardedSender } from "../src/exec/sender.js";
import { Journal } from "../src/ledger/journal.js";
import { FixedProposer } from "../src/llm/proposer.js";
import { runOnce, type RunDeps } from "../src/loop/runOnce.js";
import { DEFAULT_POLICY } from "../src/policy.js";
import { buildRuntime } from "../src/runtime.js";
import { standardScene } from "./fakes/fakeChain.js";
import { FakeSender } from "./fakes/fakeSender.js";

const BUY = { summary: "buy", intents: [{ action: "BUY" as const, symbol: "NVDAc" as const, amountUsd: 20, rationale: "underweight" }] };

const env = async (over: Record<string, string> = {}) => ({
  BASE_RPC_URL: "http://127.0.0.1:1",
  MAAT_VAULT: "0x1111111111111111111111111111111111111111",
  MAAT_EXECUTOR: "0x2222222222222222222222222222222222222222",
  MAAT_EXPENSE_PAYEE: "0x3333333333333333333333333333333333333333",
  MAAT_DATA_DIR: await mkdtemp(join(tmpdir(), "maat-rt-")),
  ...over,
});
const noProposer = { propose: async () => ({ ok: false as const, error: "unused", costUsd6: 0n }) };

type RpcRequest = { id: number; method: string; params?: unknown };
type RpcAnswer = { status: number } | { result: unknown } | { error: { code: number; message: string } };

/** A JSON-RPC endpoint on 127.0.0.1 that answers each request with `answer` and records the methods it was asked. */
async function rpcServer(answer: (req: RpcRequest) => RpcAnswer) {
  const methods: string[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const r = JSON.parse(body) as RpcRequest;
      methods.push(r.method);
      const a = answer(r);
      if ("status" in a) return void res.writeHead(a.status).end();
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: r.id, ...a }));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, methods, close: () => new Promise<void>((ok) => server.close(() => ok())) };
}

/** The type of the client's transport and the RPC URLs it reads through, in order. */
const rpcs = (deps: RunDeps) => {
  const t = (deps.stateClient as PublicClient).transport as { type: string; url?: string; transports?: { value?: { url?: string } }[] };
  return { type: t.type, urls: t.transports ? t.transports.map((x) => x.value?.url) : [t.url] };
};

describe("buildRuntime", () => {
  it("reads through BASE_RPC_URL alone when no fallback is set", async () => {
    const deps = await buildRuntime(loadConfig(await env()), { proposer: noProposer });
    expect(rpcs(deps)).toEqual({ type: "http", urls: ["http://127.0.0.1:1"] });
  });
  it("falls back to BASE_RPC_URL_FALLBACK, after BASE_RPC_URL, when it is set", async () => {
    const deps = await buildRuntime(loadConfig(await env({ BASE_RPC_URL_FALLBACK: "http://127.0.0.1:2" })), { proposer: noProposer });
    expect(rpcs(deps)).toEqual({ type: "fallback", urls: ["http://127.0.0.1:1", "http://127.0.0.1:2"] });
    expect(deps.txClient).toBe(deps.stateClient);
    expect(deps.previewClient).toBe(deps.stateClient);
  });
  it("reads through BASE_RPC_URL_FALLBACK when BASE_RPC_URL fails", async () => {
    const primary = await rpcServer(() => ({ status: 503 }));
    const second = await rpcServer((req) => (req.method === "eth_blockNumber" ? { result: "0x2a" } : { error: { code: -32601, message: "method not found" } }));
    try {
      const deps = await buildRuntime(loadConfig(await env({ BASE_RPC_URL: primary.url, BASE_RPC_URL_FALLBACK: second.url })), { proposer: noProposer });
      expect(await deps.txClient.getBlockNumber({ cacheTime: 0 })).toBe(42n);
      expect(primary.methods).toEqual(["eth_blockNumber"]);
      expect(second.methods).toEqual(["eth_blockNumber"]);
    } finally {
      await Promise.all([primary.close(), second.close()]);
    }
  });
  it("finds a Decision through a fallback that serves only 200-block log ranges", async () => {
    const ranges: [number, number][] = [];
    const second = await rpcServer((req) => {
      const { fromBlock, toBlock } = (req.params as [{ fromBlock: string; toBlock: string }])[0];
      const [from, to] = [Number(fromBlock), Number(toBlock)];
      ranges.push([from, to]);
      if (to - from + 1 > 200) return { error: { code: -32000, message: "eth_getLogs is limited to a 200 range" } };
      return { result: [] };
    });
    try {
      // BASE_RPC_URL refuses connections, so every call reaches the fallback.
      const deps = await buildRuntime(loadConfig(await env({ BASE_RPC_URL_FALLBACK: second.url })), { proposer: noProposer });
      const read = ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) =>
        deps.txClient.getLogs({ address: deps.vault, fromBlock, toBlock }).then((logs) => (logs.length > 0 ? logs : undefined));
      expect(await firstInLogWindows(1_000n, 1_399n, read)).toBeUndefined();
      expect(ranges.filter(([f, t]) => t - f + 1 <= 200)).toEqual([
        [1_000, 1_199],
        [1_200, 1_399],
      ]);
      expect(ranges.map(([f, t]) => t - f + 1)).toEqual([400, 400, 400, 400, 400, 281, 200, 200]);
    } finally {
      await second.close();
    }
  });
  it("dry-run never touches CDP", async () => {
    let connected = false;
    const deps = await buildRuntime(loadConfig(await env()), { proposer: noProposer, connectCdp: async () => ((connected = true), new FakeSender()) });
    expect(deps.mode).toBe("dry-run");
    expect(deps.sender).toBeNull();
    expect(connected).toBe(false);
  });
  it("live wraps the CDP sender in the guard with the Builder Code", async () => {
    let seen: unknown;
    const cfg = loadConfig(await env({ MAAT_MODE: "live", MAAT_BUILDER_CODE: "bc_maattest" }));
    const deps = await buildRuntime(cfg, { proposer: noProposer, connectCdp: async (o) => ((seen = o), new FakeSender()) });
    expect(deps.mode).toBe("live");
    expect(deps.sender).toBeInstanceOf(GuardedSender);
    expect(seen).toEqual({ accountName: "maat-executor", expectedAddress: "0x2222222222222222222222222222222222222222" });
    expect(deps.defaultDailyComputeUsd6).toBe(500_000n);
  });
  it("--dry-run overrides live", async () => {
    const cfg = loadConfig(await env({ MAAT_MODE: "live", MAAT_BUILDER_CODE: "bc_maattest" }));
    const deps = await buildRuntime(cfg, { forceDryRun: true, proposer: noProposer, connectCdp: async () => { throw new Error("must not connect"); } });
    expect(deps.sender).toBeNull();
  });
  it("rejects an invalid Builder Code before connecting", async () => {
    const cfg = loadConfig(await env({ MAAT_MODE: "live", MAAT_BUILDER_CODE: "Not-Valid" }));
    await expect(buildRuntime(cfg, { proposer: noProposer, connectCdp: async () => new FakeSender() })).rejects.toThrow(/invalid builder code/);
  });

  describe("guardrails", () => {
    const LIVE = { MAAT_MODE: "live", MAAT_BUILDER_CODE: "bc_maattest" };
    const cdp = async () => new FakeSender();

    it("defaults to credit actions off, a $0.75 daily LLM cap, and a $1.00 smallest bill in live, $0.10 in dry-run", async () => {
      const dry = await buildRuntime(loadConfig(await env()), { proposer: noProposer });
      expect(dry.policy).toEqual({ ...DEFAULT_POLICY, creditActions: false });
      expect(dry.maxLlmUsd6PerDay).toBe(750_000n);
      expect(dry.billMinUsd6).toBe(100_000n);
      const live = await buildRuntime(loadConfig(await env(LIVE)), { proposer: noProposer, connectCdp: cdp });
      expect(live.policy?.creditActions).toBe(false);
      expect(live.maxLlmUsd6PerDay).toBe(750_000n);
      expect(live.billMinUsd6).toBe(1_000_000n);
      const forced = await buildRuntime(loadConfig(await env(LIVE)), { proposer: noProposer, forceDryRun: true });
      expect(forced.billMinUsd6).toBe(100_000n);
    });

    it("takes MAAT_CREDIT_ACTIONS, MAAT_MAX_LLM_USD_PER_DAY and MAAT_BILL_MIN_USD from the environment", async () => {
      const over = { MAAT_CREDIT_ACTIONS: "on", MAAT_MAX_LLM_USD_PER_DAY: "0.25", MAAT_BILL_MIN_USD: "2.5" };
      for (const mode of [{}, LIVE]) {
        const deps = await buildRuntime(loadConfig(await env({ ...mode, ...over })), { proposer: noProposer, connectCdp: cdp });
        expect([deps.policy?.creditActions, deps.maxLlmUsd6PerDay, deps.billMinUsd6]).toEqual([true, 250_000n, 2_500_000n]);
      }
    });

    it("stamps the running code's git commit into every journal row", async () => {
      const vars = await env();
      const deps = await buildRuntime(loadConfig(vars), { proposer: new FixedProposer(BUY) });
      const preview = { readContract: (async () => 0) as never };
      expect(await runOnce({ ...deps, stateClient: standardScene().client(), previewClient: preview })).toMatchObject({ status: "done", proposals: 1 });
      const rows = await new Journal(vars.MAAT_DATA_DIR).read();
      expect(rows.map((r) => r.kind)).toEqual(["run", "intent"]);
      const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      for (const r of rows) expect(r.commit).toMatch(new RegExp(`^${head}(-dirty)?$`));
    });

    describe("live mode refuses a dry-run's data dir", () => {
      const journalIn = async (dir: string, rows: object[]) => {
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, "journal.jsonl"), rows.map((r) => JSON.stringify(r) + "\n").join(""));
      };
      const dryRound = { ts: "2026-11-25T12:10:00.000Z", kind: "run", runId: "dry-1", block: "1", day: "20782", mode: "dry-run", ok: true, summary: "s", costUsd6: "1", suggestions: 0, proposals: 0 };
      const liveRound = { ...dryRound, runId: "live-1", mode: "live" };

      it("before any CDP call, when the journal holds a dry-run round", async () => {
        const vars = await env(LIVE);
        await journalIn(vars.MAAT_DATA_DIR, [liveRound, dryRound]);
        let connected = false;
        const build = buildRuntime(loadConfig(vars), { proposer: noProposer, connectCdp: async () => ((connected = true), new FakeSender()) });
        await expect(build).rejects.toThrow(
          `live mode refuses data dir ${vars.MAAT_DATA_DIR}: its journal holds dry-run rows (first: run dry-1 at 2026-11-25T12:10:00.000Z); give live its own MAAT_DATA_DIR`,
        );
        expect(connected).toBe(false);
      });

      it.each([
        ["an intent row older code gated in dry-run", { ts: "t", kind: "intent", runId: "dry-2", gate: "dry-run: would execute" }],
        ["a housekeeping row a dry-run skipped", { ts: "t", kind: "housekeeping", runId: "dry-3", call: "syncMultiplier", note: "dry-run" }],
      ])("when the journal holds %s", async (_what, row) => {
        const vars = await env(LIVE);
        await journalIn(vars.MAAT_DATA_DIR, [row]);
        await expect(buildRuntime(loadConfig(vars), { proposer: noProposer, connectCdp: cdp })).rejects.toThrow(/its journal holds dry-run rows/);
      });

      it("but starts on a fresh data dir, on one with only live rows, and past a line a crash cut short", async () => {
        const fresh = await env(LIVE);
        expect((await buildRuntime(loadConfig(fresh), { proposer: noProposer, connectCdp: cdp })).mode).toBe("live");
        const vars = await env(LIVE);
        await journalIn(vars.MAAT_DATA_DIR, [liveRound]);
        await writeFile(join(vars.MAAT_DATA_DIR, "journal.jsonl"), '{"ts":"t","kind":"ru', { flag: "a" });
        expect((await buildRuntime(loadConfig(vars), { proposer: noProposer, connectCdp: cdp })).mode).toBe("live");
      });

      it.each([
        ["a live round", liveRound],
        ["a live send", { ts: "t", kind: "sent", runId: "live-2", index: 0, txHash: `0x${"ab".repeat(32)}` }],
      ])("and dry-run refuses live's data dir when the journal holds %s, so live can start there again", async (_what, row) => {
        for (const [vars, forceDryRun] of [[await env(), false], [await env(LIVE), true]] as const) {
          await journalIn(vars.MAAT_DATA_DIR, [row]);
          await expect(buildRuntime(loadConfig(vars), { proposer: noProposer, forceDryRun })).rejects.toThrow(
            `dry-run refuses data dir ${vars.MAAT_DATA_DIR}: its journal holds live rows (first: run ${row.runId} at ${row.ts}); give the dry-run its own MAAT_DATA_DIR`,
          );
        }
      });

      it("and dry-run keeps using its own data dir", async () => {
        const vars = await env();
        await journalIn(vars.MAAT_DATA_DIR, [dryRound]);
        expect((await buildRuntime(loadConfig(vars), { proposer: noProposer })).mode).toBe("dry-run");
        const forced = await env(LIVE);
        await journalIn(forced.MAAT_DATA_DIR, [dryRound]);
        expect((await buildRuntime(loadConfig(forced), { proposer: noProposer, forceDryRun: true })).mode).toBe("dry-run");
      });
    });
  });
});
