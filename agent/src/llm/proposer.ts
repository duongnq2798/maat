import Anthropic from "@anthropic-ai/sdk";
import type { PolicyView } from "../policy.js";
import type { VaultState } from "../chain/state.js";
import type { Proposal } from "../intent.js";
import { oneLine } from "../redact.js";
import { costUsd6, type Usage } from "./pricing.js";
import { renderUserMessage, systemPrompt } from "./prompt.js";
import { BATCH_JSON_SCHEMA, BatchSchema, type Batch } from "./schema.js";

export interface ProposerInput {
  state: VaultState;
  policy: PolicyView;
  billUsd6: bigint;
  /** MAAT_CREDIT_ACTIONS. Off, the prompt tells Claude never to propose a credit action. */
  creditActions: boolean;
}

export type ProposerOutput =
  | { ok: true; summary: string; proposals: Proposal[]; costUsd6: bigint; model: string }
  | { ok: false; error: string; costUsd6: bigint };

export interface Proposer {
  propose(input: ProposerInput): Promise<ProposerOutput>;
}

export type CreateMessage = (params: Record<string, unknown>) => Promise<{
  model: string;
  stop_reason: string | null;
  content: readonly { type: string; text?: string }[];
  usage: Usage;
}>;

/** The only host the agent sends its prompt and its API key to. */
export const ANTHROPIC_API_URL = "https://api.anthropic.com";

/**
 * The SDK client, pinned to ANTHROPIC_API_URL and ANTHROPIC_API_KEY. Left to itself the SDK reads ANTHROPIC_BASE_URL
 * (Claude Code exports one to the processes it starts), which would get the key and could answer for Claude, and with
 * no key it falls back to ANTHROPIC_AUTH_TOKEN or a login profile. A key passed in code keeps it from reading either.
 */
export function anthropicClient(opts: { fetch?: typeof globalThis.fetch } = {}): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  return new Anthropic({ ...opts, baseURL: ANTHROPIC_API_URL, apiKey, authToken: null });
}

/** The set Anthropic env that anthropicClient overrides, as one line for main.ts to print at startup; null if none. */
export function ignoredAnthropicEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const names = ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN"].filter((name) => env[name]);
  if (names.length === 0) return null;
  return `maat agent: ignoring ${names.join(" and ")}: Claude is called only at ${ANTHROPIC_API_URL}, with ANTHROPIC_API_KEY`;
}

/** The SDK client is built on first use, so tests that inject `create` never need ANTHROPIC_API_KEY. */
function defaultCreate(): CreateMessage {
  let client: Anthropic | undefined;
  return (params) => {
    client ??= anthropicClient();
    return client.beta.messages.create(params as never) as never;
  };
}

export class ClaudeProposer implements Proposer {
  private readonly create: CreateMessage;

  constructor(private readonly opts: { model: string; create?: CreateMessage }) {
    this.create = opts.create ?? defaultCreate();
  }

  async propose(input: ProposerInput): Promise<ProposerOutput> {
    let res: Awaited<ReturnType<CreateMessage>>;
    try {
      res = await this.create({
        model: this.opts.model,
        max_tokens: 16000,
        // No cache_control: rounds start 15 to 60 minutes apart, past the 5-minute TTL, so a marker would only add the
        // 1.25x write with no read. The prompt (about 1,750 to 1,800 characters) is also near the 512-token minimum.
        system: [{ type: "text", text: systemPrompt({ creditActions: input.creditActions }) }],
        messages: [{ role: "user", content: renderUserMessage(input) }],
        output_config: { effort: "medium", format: { type: "json_schema", schema: BATCH_JSON_SCHEMA } },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
    } catch (e) {
      // The journal keeps this line, so it is redacted like a halt reason.
      return { ok: false, error: `claude: ${oneLine(e)}`, costUsd6: 0n };
    }
    try {
      const cost = costUsd6(res.model, res.usage, this.opts.model);
      if (res.stop_reason === "refusal") return { ok: false, error: "claude refused", costUsd6: cost };
      if (res.stop_reason === "max_tokens") return { ok: false, error: "claude output truncated", costUsd6: cost };
      // A `fallback` block marks where one model's output gives way to the next: the declining model's text (possibly
      // a partial JSON fragment) precedes it, so only the text after the last marker is the answer.
      const lastFallback = res.content.map((b) => b.type).lastIndexOf("fallback");
      const text = res.content
        .slice(lastFallback + 1)
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("");
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        return { ok: false, error: `invalid proposal JSON: ${(e as Error).message}`, costUsd6: cost };
      }
      const r = BatchSchema.safeParse(parsed);
      if (!r.success) return { ok: false, error: `invalid proposal JSON: ${r.error.issues.map((i) => i.message).join("; ")}`, costUsd6: cost };
      return { ok: true, summary: r.data.summary, proposals: r.data.intents, costUsd6: cost, model: res.model };
    } catch (e) {
      // Malformed response envelope (missing usage or content): still never throw.
      return { ok: false, error: `claude: malformed response: ${e instanceof Error ? e.message : String(e)}`, costUsd6: 0n };
    }
  }
}

/** Deterministic stand-in for tests and the anvil demo (spec §6: agent loop with a fixed-output LLM). */
export class FixedProposer implements Proposer {
  constructor(private readonly batch: Batch) {}

  async propose(_input?: ProposerInput): Promise<ProposerOutput> {
    return { ok: true, summary: this.batch.summary, proposals: this.batch.intents, costUsd6: 0n, model: "fixed" };
  }
}
