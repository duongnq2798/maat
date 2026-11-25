import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { readVaultState } from "../src/chain/state.js";
import { SYSTEM_PROMPT, systemPrompt } from "../src/llm/prompt.js";
import {
  AGENT_ENV_FILE,
  ANTHROPIC_API_URL,
  anthropicApiKey,
  anthropicClient,
  ClaudeProposer,
  FixedProposer,
  ignoredAnthropicEnv,
  ignoredAnthropicKey,
  type CreateMessage,
} from "../src/llm/proposer.js";
import { evaluatePolicy } from "../src/policy.js";
import { VAULT, standardScene } from "./fakes/fakeChain.js";

const input = async (creditActions = false) => {
  const state = await readVaultState(standardScene().client(), VAULT);
  return { state, policy: evaluatePolicy(state, { dailyComputeUsd6: 500_000n, unpaidUsd6: 0n }), billUsd6: 0n, creditActions };
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
  });

  it("asks for no prompt caching", async () => {
    let seen: Record<string, unknown> = {};
    const create: CreateMessage = async (p) => ((seen = p), { model: "claude-sonnet-5-5", stop_reason: "end_turn", content: [{ type: "text", text: '{"summary":"hold","intents":[]}' }], usage });
    await new ClaudeProposer({ model: "claude-sonnet-5-5", create }).propose(await input());
    expect(seen.system).toEqual([{ type: "text", text: SYSTEM_PROMPT }]);
    expect(JSON.stringify(seen)).not.toContain("cache_control");
  });

  it("tells Claude credit actions are off unless the round turned them on", async () => {
    const systems: unknown[] = [];
    const create: CreateMessage = async (p) => (systems.push(p.system), { model: "claude-sonnet-5-5", stop_reason: "end_turn", content: [{ type: "text", text: '{"summary":"hold","intents":[]}' }], usage });
    const proposer = new ClaudeProposer({ model: "claude-sonnet-5-5", create });
    await proposer.propose(await input(false));
    await proposer.propose(await input(true));
    expect(systems).toEqual([[{ type: "text", text: systemPrompt({ creditActions: false }) }], [{ type: "text", text: systemPrompt({ creditActions: true }) }]]);
    expect(SYSTEM_PROMPT).toBe(systemPrompt({ creditActions: false }));
    expect(SYSTEM_PROMPT).toContain("Credit actions are off: never propose SUPPLY, WITHDRAW_COLLATERAL, BORROW or REPAY");
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

  it("uses only the text after the last fallback block", async () => {
    const batch = '{"summary":"buy NVDAc","intents":[{"action":"BUY","symbol":"NVDAc","amountUsd":20,"rationale":"underweight"}]}';
    const create: CreateMessage = async () => ({
      model: "claude-sonnet-5-5",
      stop_reason: "end_turn",
      content: [{ type: "text", text: '{"summ' }, { type: "fallback" }, { type: "text", text: batch }],
      usage,
    });
    const out = await new ClaudeProposer({ model: "claude-sonnet-5-5", create }).propose(await input());
    expect(out).toMatchObject({
      ok: true,
      summary: "buy NVDAc",
      proposals: [{ action: "BUY", symbol: "NVDAc", amountUsd: 20, rationale: "underweight" }],
    });
  });

  it("bills a fallback response per attempt, each at its own model's price", async () => {
    // Opus 5.5 declined mid-answer and Opus 4.8 served it: top-level usage covers only the Opus 4.8 attempt.
    const attempt = (input: number, output: number) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
    const create: CreateMessage = async () => ({
      model: "claude-opus-4-8",
      stop_reason: "end_turn",
      content: [{ type: "text", text: '{"summ' }, { type: "fallback" }, { type: "text", text: '{"summary":"hold","intents":[]}' }],
      usage: {
        ...attempt(10_000, 1_000),
        iterations: [
          { type: "message", model: "claude-opus-5-5", ...attempt(10_000, 100) },
          { type: "fallback_message", model: "claude-opus-4-8", ...attempt(10_000, 1_000) },
        ],
      },
    });
    const out = await new ClaudeProposer({ model: "claude-opus-5-5", create }).propose(await input());
    // $0.042 for the declined Opus 5.5 attempt + $0.075 for the Opus 4.8 one
    expect(out).toMatchObject({ ok: true, model: "claude-opus-4-8", costUsd6: 117_000n });
  });

  it("prices the requested model's attempt at its own price when the entry names no model", async () => {
    const attempt = (input: number) => ({ input_tokens: input, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
    const create: CreateMessage = async () => ({
      model: "claude-opus-4-8",
      stop_reason: "end_turn",
      content: [{ type: "fallback" }, { type: "text", text: '{"summary":"hold","intents":[]}' }],
      usage: {
        ...attempt(1_000_000),
        iterations: [
          { type: "message", model: null, ...attempt(1_000_000) },
          { type: "fallback_message", model: "claude-opus-4-8", ...attempt(1_000_000) },
        ],
      },
    });
    const out = await new ClaudeProposer({ model: "claude-opus-5-5", create }).propose(await input());
    // $4 for the declined Opus 5.5 attempt + $5 for the Opus 4.8 one
    expect(out).toMatchObject({ ok: true, costUsd6: 9_000_000n });
  });

  it("prices an attempt without a model at the response model, once", async () => {
    const create: CreateMessage = async () => ({
      model: "claude-sonnet-5-5",
      stop_reason: "end_turn",
      content: [{ type: "text", text: '{"summary":"hold","intents":[]}' }],
      usage: { ...usage, iterations: [{ type: "message", model: null, ...usage }] },
    });
    const out = await new ClaudeProposer({ model: "claude-sonnet-5-5", create }).propose(await input());
    expect(out.costUsd6).toBe(30_000n);
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

  it("journals an API error as one redacted line", async () => {
    vi.stubEnv("MAAT_PROPOSER_TEST_API_KEY", "fake-secret-in-an-error");
    try {
      const create: CreateMessage = async () => {
        throw new Error("401 key fake-secret-in-an-error rejected\nPOST https://proxy.example.org/v1/messages");
      };
      const out = await new ClaudeProposer({ model: "claude-sonnet-5-5", create }).propose(await input());
      expect(out).toEqual({ ok: false, error: "claude: 401 key [redacted] rejected", costUsd6: 0n });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

/** A temp agent/.env holding `text`, or the path of one that does not exist when `text` is null. */
async function envFile(text: string | null): Promise<string> {
  const file = join(await mkdtemp(join(tmpdir(), "maat-env-")), ".env");
  if (text !== null) await writeFile(file, text);
  return file;
}

describe("anthropicClient", () => {
  const message = { id: "msg_fake", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [{ type: "text", text: "{}" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } };
  const recorder = () => {
    const seen: { url: string; headers: Headers }[] = [];
    const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), headers: new Headers(init?.headers) });
      return new Response(JSON.stringify(message), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof globalThis.fetch;
    return { seen, fetch };
  };

  it("calls https://api.anthropic.com with ANTHROPIC_API_KEY, whatever ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN say", async () => {
    // A parent process (Claude Code exports ANTHROPIC_BASE_URL) must not get the key or answer for Claude.
    vi.stubEnv("ANTHROPIC_BASE_URL", "http://127.0.0.1:9/fake-proxy");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "fake-auth-token-from-a-parent");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-fake-agent-key");
    try {
      const { seen, fetch } = recorder();
      const client = anthropicClient({ fetch, envFile: await envFile(null) });
      expect(client.baseURL).toBe(ANTHROPIC_API_URL);
      expect(ANTHROPIC_API_URL).toBe("https://api.anthropic.com");
      await client.beta.messages.create({ model: "claude-sonnet-5-5", max_tokens: 16, messages: [{ role: "user", content: "hi" }] });
      expect(seen).toHaveLength(1);
      expect(seen[0]!.url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/messages/);
      const headerValues = [...seen[0]!.headers.values()].join("\n");
      expect(headerValues).toContain("sk-ant-fake-agent-key");
      expect(headerValues).not.toContain("fake-auth-token-from-a-parent");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("refuses to build without ANTHROPIC_API_KEY instead of using an auth token or a login profile", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "fake-auth-token-from-a-parent");
    try {
      const file = await envFile(null);
      expect(() => anthropicClient({ envFile: file })).toThrow("ANTHROPIC_API_KEY is not set");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("sends agent/.env's ANTHROPIC_API_KEY to https://api.anthropic.com, not the one the terminal exported", async () => {
    // Node's --env-file keeps a variable the terminal already has, so the terminal's key reaches process.env first.
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-fake-key-from-the-terminal");
    vi.stubEnv("ANTHROPIC_BASE_URL", "http://127.0.0.1:9/fake-proxy");
    try {
      const { seen, fetch } = recorder();
      const client = anthropicClient({ fetch, envFile: await envFile("MAAT_MODE=dry-run\nANTHROPIC_API_KEY=sk-ant-fake-key-from-agent-env\n") });
      await client.beta.messages.create({ model: "claude-sonnet-5-5", max_tokens: 16, messages: [{ role: "user", content: "hi" }] });
      expect(seen).toHaveLength(1);
      expect(seen[0]!.url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/messages/);
      const headerValues = [...seen[0]!.headers.values()].join("\n");
      expect(headerValues).toContain("sk-ant-fake-key-from-agent-env");
      expect(headerValues).not.toContain("sk-ant-fake-key-from-the-terminal");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("names the Anthropic env it ignores, for one startup warning", () => {
    expect(ignoredAnthropicEnv({})).toBeNull();
    expect(ignoredAnthropicEnv({ ANTHROPIC_BASE_URL: "", ANTHROPIC_API_KEY: "sk-ant-fake" })).toBeNull();
    expect(ignoredAnthropicEnv({ ANTHROPIC_BASE_URL: "http://127.0.0.1:9" })).toBe(
      "maat agent: ignoring ANTHROPIC_BASE_URL: Claude is called only at https://api.anthropic.com, with ANTHROPIC_API_KEY",
    );
    expect(ignoredAnthropicEnv({ ANTHROPIC_BASE_URL: "http://127.0.0.1:9", ANTHROPIC_AUTH_TOKEN: "fake" })).toBe(
      "maat agent: ignoring ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN: Claude is called only at https://api.anthropic.com, with ANTHROPIC_API_KEY",
    );
  });
});

describe("the Claude key", () => {
  const TERMINAL = "sk-ant-fake-key-from-the-terminal";
  const FROM_FILE = "sk-ant-fake-key-from-agent-env";

  it("comes from agent/.env, the file npm run agent loads, found from the agent's own folder", () => {
    expect(AGENT_ENV_FILE).toBe(fileURLToPath(new URL("../.env", import.meta.url)));
  });

  it("is agent/.env's ANTHROPIC_API_KEY when the file sets one, whatever the environment holds", async () => {
    const file = await envFile(`# the agent's settings\nMAAT_MODE=dry-run\nANTHROPIC_API_KEY="${FROM_FILE}"\n`);
    expect(anthropicApiKey({ ANTHROPIC_API_KEY: TERMINAL }, file)).toBe(FROM_FILE);
    expect(anthropicApiKey({}, file)).toBe(FROM_FILE);
  });

  it("is the environment's when agent/.env is missing, leaves the key out or leaves it blank", async () => {
    for (const file of [await envFile(null), await envFile("MAAT_MODE=dry-run\n"), await envFile("ANTHROPIC_API_KEY=\n")]) {
      expect(anthropicApiKey({ ANTHROPIC_API_KEY: TERMINAL }, file)).toBe(TERMINAL);
      expect(anthropicApiKey({ ANTHROPIC_API_KEY: "" }, file)).toBeUndefined();
      expect(anthropicApiKey({}, file)).toBeUndefined();
    }
  });

  it("warns once when the environment's key differs from agent/.env's, naming the variable and neither value", async () => {
    const file = await envFile(`ANTHROPIC_API_KEY=${FROM_FILE}\n`);
    const line = ignoredAnthropicKey({ ANTHROPIC_API_KEY: TERMINAL }, file);
    expect(line).toBe("maat agent: ignoring ANTHROPIC_API_KEY from the environment: Claude is called with the one in agent/.env");
    expect(line).not.toContain(TERMINAL);
    expect(line).not.toContain(FROM_FILE);
  });

  it("does not warn when the two keys match, when only one of them is set, or when there is no agent/.env", async () => {
    const file = await envFile(`ANTHROPIC_API_KEY=${FROM_FILE}\n`);
    // Without a key in the terminal, Node's --env-file puts agent/.env's into process.env: the same value.
    expect(ignoredAnthropicKey({ ANTHROPIC_API_KEY: FROM_FILE }, file)).toBeNull();
    expect(ignoredAnthropicKey({}, file)).toBeNull();
    expect(ignoredAnthropicKey({ ANTHROPIC_API_KEY: TERMINAL }, await envFile("ANTHROPIC_API_KEY=\n"))).toBeNull();
    expect(ignoredAnthropicKey({ ANTHROPIC_API_KEY: TERMINAL }, await envFile(null))).toBeNull();
  });
});

describe("FixedProposer", () => {
  it("returns its batch for free", async () => {
    const out = await new FixedProposer({ summary: "s", intents: [{ action: "REPAY", symbol: "USDC", amountUsd: 1, rationale: "r" }] }).propose(await input());
    expect(out).toMatchObject({ ok: true, costUsd6: 0n, proposals: [{ action: "REPAY" }] });
  });
});
