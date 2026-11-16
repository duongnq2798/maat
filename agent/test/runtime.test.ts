import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { GuardedSender } from "../src/exec/sender.js";
import type { RunDeps } from "../src/loop/runOnce.js";
import { buildRuntime } from "../src/runtime.js";
import { FakeSender } from "./fakes/fakeSender.js";

const env = async (over: Record<string, string> = {}) => ({
  BASE_RPC_URL: "http://127.0.0.1:1",
  MAAT_VAULT: "0x1111111111111111111111111111111111111111",
  MAAT_EXECUTOR: "0x2222222222222222222222222222222222222222",
  MAAT_EXPENSE_PAYEE: "0x3333333333333333333333333333333333333333",
  MAAT_DATA_DIR: await mkdtemp(join(tmpdir(), "maat-rt-")),
  ...over,
});
const noProposer = { propose: async () => ({ ok: false as const, error: "unused", costUsd6: 0n }) };

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
});
