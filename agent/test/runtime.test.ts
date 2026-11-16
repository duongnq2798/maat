import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readVaultState } from "../src/chain/state.js";
import { loadConfig } from "../src/config.js";
import { GuardedSender } from "../src/exec/sender.js";
import { evaluatePolicy } from "../src/policy.js";
import { buildRuntime } from "../src/runtime.js";
import { VAULT, standardScene } from "./fakes/fakeChain.js";
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

describe("buildRuntime", () => {
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
  it("asks Bankr's gateway with the Bankr key when the provider is bankr, with no failover without an Anthropic key", async () => {
    const urls: string[] = [];
    const auth: (string | null)[] = [];
    const bankrFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      urls.push(String(url));
      auth.push(new Headers(init?.headers).get("authorization"));
      return new Response(JSON.stringify({ type: "error", error: { type: "insufficient_credits", message: "Insufficient credits" } }), {
        status: 402,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const cfg = loadConfig(await env({ MAAT_LLM_PROVIDER: "bankr", BANKR_API_KEY: "bk_test" }));
    const deps = await buildRuntime(cfg, { bankrFetch });
    const state = await readVaultState(standardScene().client(), VAULT);
    const out = await deps.proposer.propose({ state, policy: evaluatePolicy(state, { dailyComputeUsd6: 500_000n, unpaidUsd6: 0n }), billUsd6: 0n });
    expect(out).toMatchObject({ ok: false, provider: "bankr", unfunded: "insufficient_credits" });
    expect(out).not.toHaveProperty("failover");
    expect(urls).toEqual(["https://llm.bankr.bot/v1/messages"]);
    expect(auth).toEqual(["Bearer bk_test"]);
  });
  it("rejects an invalid Builder Code before connecting", async () => {
    const cfg = loadConfig(await env({ MAAT_MODE: "live", MAAT_BUILDER_CODE: "Not-Valid" }));
    await expect(buildRuntime(cfg, { proposer: noProposer, connectCdp: async () => new FakeSender() })).rejects.toThrow(/invalid builder code/);
  });
});
