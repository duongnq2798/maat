import { describe, expect, it } from "vitest";
import { readVaultState } from "../src/chain/state.js";
import { ClaudeProposer, FixedProposer, type CreateMessage } from "../src/llm/proposer.js";
import { evaluatePolicy } from "../src/policy.js";
import { VAULT, standardScene } from "./fakes/fakeChain.js";

const input = async () => {
  const state = await readVaultState(standardScene().client(), VAULT);
  return { state, policy: evaluatePolicy(state, { dailyComputeUsd6: 500_000n, unpaidUsd6: 0n }), billUsd6: 0n };
};
const usage = { input_tokens: 10_000, output_tokens: 1_000 };
const reply = (text: string, stop = "end_turn"): CreateMessage =>
  async () => ({ model: "claude-sonnet-5-5", stop_reason: stop, content: [{ type: "text", text }], usage });

describe("ClaudeProposer", () => {
  it("sends the documented request shape", async () => {
    let seen: Record<string, unknown> = {};
    const create: CreateMessage = async (p) => ((seen = p), { model: "claude-sonnet-5-5", stop_reason: "end_turn", content: [{ type: "text", text: '{"summary":"hold","intents":[]}' }], usage });
    await new ClaudeProposer({ model: "claude-sonnet-5-5", create }).propose(await input());
    expect(seen).toMatchObject({
      model: "claude-sonnet-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema" } },
    });
    expect(seen).not.toHaveProperty("temperature");
    expect(seen).not.toHaveProperty("tool_choice");
    expect(seen).not.toHaveProperty("thinking");
    expect((seen.system as { cache_control?: unknown }[])[0]?.cache_control).toEqual({ type: "ephemeral" });
  });

  it("returns proposals and their cost", async () => {
    const out = await new ClaudeProposer({
      model: "claude-sonnet-5-5",
      create: reply('{"summary":"buy NVDAc","intents":[{"action":"BUY","symbol":"NVDAc","amountUsd":20,"rationale":"underweight"}]}'),
    }).propose(await input());
    expect(out).toEqual({
      ok: true,
      summary: "buy NVDAc",
      proposals: [{ action: "BUY", symbol: "NVDAc", amountUsd: 20, rationale: "underweight" }],
      costUsd6: 30_000n,
      model: "claude-sonnet-5-5",
    });
  });

  it("skips invalid JSON but still bills it", async () => {
    const out = await new ClaudeProposer({ model: "claude-sonnet-5-5", create: reply("not json") }).propose(await input());
    expect(out.ok).toBe(false);
    expect(out.costUsd6).toBe(30_000n);
    expect(!out.ok && out.error).toMatch(/invalid proposal JSON/);
  });

  it("skips a schema violation", async () => {
    const out = await new ClaudeProposer({
      model: "claude-sonnet-5-5",
      create: reply('{"summary":"x","intents":[{"action":"PAY_EXPENSE","symbol":"USDC","amountUsd":1,"rationale":"r"}]}'),
    }).propose(await input());
    expect(!out.ok && out.error).toMatch(/invalid proposal JSON/);
  });

  it("treats a refusal and a truncation as no proposals", async () => {
    const refused = await new ClaudeProposer({ model: "claude-sonnet-5-5", create: reply("", "refusal") }).propose(await input());
    expect(refused).toMatchObject({ ok: false, error: "claude refused" });
    const cut = await new ClaudeProposer({ model: "claude-sonnet-5-5", create: reply('{"summ', "max_tokens") }).propose(await input());
    expect(cut).toMatchObject({ ok: false, error: "claude output truncated" });
  });

  it("never throws on an API error", async () => {
    const create: CreateMessage = async () => {
      throw new Error("529 overloaded");
    };
    const out = await new ClaudeProposer({ model: "claude-sonnet-5-5", create }).propose(await input());
    expect(out).toEqual({ ok: false, error: "claude: 529 overloaded", costUsd6: 0n });
  });
});

describe("FixedProposer", () => {
  it("returns its batch for free", async () => {
    const out = await new FixedProposer({ summary: "s", intents: [{ action: "REPAY", symbol: "USDC", amountUsd: 1, rationale: "r" }] }).propose(await input());
    expect(out).toMatchObject({ ok: true, costUsd6: 0n, proposals: [{ action: "REPAY" }] });
  });
});
