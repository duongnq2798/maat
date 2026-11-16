import Anthropic, { type ClientOptions } from "@anthropic-ai/sdk";
import type { PolicyView } from "../policy.js";
import type { VaultState } from "../chain/state.js";
import type { Proposal } from "../intent.js";
import { dottedModelId } from "./modelId.js";
import { costUsd6, type LlmProvider, type Usage } from "./pricing.js";
import { renderUserMessage, SYSTEM_PROMPT } from "./prompt.js";
import { BATCH_JSON_SCHEMA, BatchSchema, type Batch } from "./schema.js";

export interface ProposerInput {
  state: VaultState;
  policy: PolicyView;
  billUsd6: bigint;
}

interface Provenance {
  /** The gateway that answered, or the one asked last when none did. FixedProposer has none. */
  provider?: LlmProvider;
  /** Why a failed Bankr call was asked again of the Claude API, e.g. "bankr 429 rate_limit_error". */
  failover?: string;
  /** Bankr answered 402 Payment Required: its error type (insufficient_credits, daily_budget_exceeded). */
  unfunded?: string;
}

export type ProposerOutput =
  | ({ ok: true; summary: string; proposals: Proposal[]; costUsd6: bigint; model: string } & Provenance)
  | ({ ok: false; error: string; costUsd6: bigint } & Provenance);

export interface Proposer {
  propose(input: ProposerInput): Promise<ProposerOutput>;
}

export type CreateMessage = (params: Record<string, unknown>) => Promise<{
  model: string;
  stop_reason: string | null;
  content: readonly { type: string; text?: string }[];
  usage: Usage;
}>;

/** Bankr's LLM gateway serves Anthropic's Messages API at <base>/v1/messages; the SDK adds the /v1. */
export const BANKR_BASE_URL = "https://llm.bankr.bot";

/** The SDK client is built on first use, so tests that inject `create` never need ANTHROPIC_API_KEY. */
function defaultCreate(): CreateMessage {
  let client: Anthropic | undefined;
  return (params) => {
    client ??= new Anthropic();
    return client.beta.messages.create(params as never) as never;
  };
}

/** The Bankr gateway call: the plain Messages endpoint with the Bankr key (bk_...) as the API key. */
export function bankrCreate(apiKey: string, fetch?: ClientOptions["fetch"]): CreateMessage {
  const client = new Anthropic({ apiKey, baseURL: BANKR_BASE_URL, ...(fetch ? { fetch } : {}) });
  return (params) => client.messages.create(params as never) as never;
}

/**
 * Why a Bankr call that threw may be asked again of the Claude API: out of credits (402), refused access (403), a
 * timeout (408 or the SDK's own), rate-limited (429), a server error (5xx) or no connection. Undefined otherwise.
 */
function failoverReason(e: unknown): string | undefined {
  // Both connection errors are APIErrors with no status, so they are told apart first.
  if (e instanceof Anthropic.APIConnectionTimeoutError) return "timeout";
  if (e instanceof Anthropic.APIConnectionError) return "connection error";
  if (!(e instanceof Anthropic.APIError) || e.status === undefined) return undefined;
  const s = e.status;
  if (s !== 402 && s !== 403 && s !== 408 && s !== 429 && s < 500) return undefined;
  return e.type ? `${s} ${e.type}` : String(s);
}

export class ClaudeProposer implements Proposer {
  private readonly create: CreateMessage;

  constructor(
    private readonly opts: {
      model: string;
      /** The Claude API call; the default reads ANTHROPIC_API_KEY on first use. */
      create?: CreateMessage;
      /** Ask Bankr's gateway first. With `failover`, a call it could not serve is asked once of the Claude API. */
      bankr?: { create: CreateMessage; failover: boolean };
    },
  ) {
    this.create = opts.create ?? defaultCreate();
  }

  async propose(input: ProposerInput): Promise<ProposerOutput> {
    const shared = {
      // No cache_control: rounds start 15 to 60 minutes apart, past the 5-minute TTL, so a marker would only add the
      // 1.25x write with no read. The prompt (about 1,800 characters) is also near the 512-token minimum.
      system: [{ type: "text", text: SYSTEM_PROMPT }],
      messages: [{ role: "user", content: renderUserMessage(input) }],
      output_config: { effort: "medium", format: { type: "json_schema", schema: BATCH_JSON_SCHEMA } },
    };
    const direct = () =>
      this.ask("anthropic", this.create, {
        model: this.opts.model,
        max_tokens: 16000,
        ...shared,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
    const bankr = this.opts.bankr;
    if (!bankr) return (await direct()).out;

    // Bankr forwards the body to Vertex AI, then OpenRouter: Vertex supports neither `fallbacks` nor its beta, and a
    // provider may reject the whole request over one unknown top-level field, so this is the plain Messages request.
    const first = await this.ask("bankr", bankr.create, { model: dottedModelId(this.opts.model), max_tokens: 4000, ...shared });
    if (first.thrown === undefined) return first.out;
    const e = first.thrown;
    const unfunded = e instanceof Anthropic.APIError && e.status === 402 ? { unfunded: String(e.type ?? "unknown") } : {};
    const why = failoverReason(e);
    if (why === undefined || !bankr.failover) return { ...first.out, ...unfunded };
    const second = await direct();
    return { ...second.out, costUsd6: first.out.costUsd6 + second.out.costUsd6, failover: `bankr ${why}`, ...unfunded };
  }

  /** One request. A refusal or an invalid answer is a result; only a call that threw comes back with `thrown`. */
  private async ask(provider: LlmProvider, create: CreateMessage, params: Record<string, unknown>): Promise<{ out: ProposerOutput; thrown?: unknown }> {
    const label = provider === "bankr" ? "bankr" : "claude";
    let res: Awaited<ReturnType<CreateMessage>>;
    try {
      res = await create(params);
    } catch (e) {
      return { out: { ok: false, error: `${label}: ${e instanceof Error ? e.message : String(e)}`, costUsd6: 0n, provider }, thrown: e };
    }
    try {
      const cost = costUsd6(res.model, res.usage, provider);
      if (res.stop_reason === "refusal") return { out: { ok: false, error: "claude refused", costUsd6: cost, provider } };
      if (res.stop_reason === "max_tokens") return { out: { ok: false, error: "claude output truncated", costUsd6: cost, provider } };
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
        return { out: { ok: false, error: `invalid proposal JSON: ${(e as Error).message}`, costUsd6: cost, provider } };
      }
      const r = BatchSchema.safeParse(parsed);
      if (!r.success) {
        return { out: { ok: false, error: `invalid proposal JSON: ${r.error.issues.map((i) => i.message).join("; ")}`, costUsd6: cost, provider } };
      }
      return { out: { ok: true, summary: r.data.summary, proposals: r.data.intents, costUsd6: cost, model: res.model, provider } };
    } catch (e) {
      // Malformed response envelope (missing usage or content): still never throw.
      return { out: { ok: false, error: `${label}: malformed response: ${e instanceof Error ? e.message : String(e)}`, costUsd6: 0n, provider } };
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
