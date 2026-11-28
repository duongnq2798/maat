import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import type { PolicyView } from "../policy.js";
import type { VaultState } from "../chain/state.js";
import type { Proposal } from "../intent.js";
import type { Address } from "viem";
import { oneLine } from "../redact.js";
import { costUsd6, type Usage } from "./pricing.js";
import { briefSystemPrompt, renderBriefMessage, renderUserMessage, systemPrompt } from "./prompt.js";
import { BATCH_JSON_SCHEMA, BRIEF_BATCH_JSON_SCHEMA, BatchSchema, BriefBatchSchema, type Batch } from "./schema.js";

/** A MaatInbox brief as the prompt quotes it: never more than its id, its sender and its text. */
export interface PromptBrief {
  id: number;
  from: Address;
  text: string;
}

export interface ProposerInput {
  state: VaultState;
  policy: PolicyView;
  billUsd6: bigint;
  /** MAAT_CREDIT_ACTIONS. Off, the prompt tells Claude never to propose a credit action. */
  creditActions: boolean;
  /** The briefs this round sends to Claude. Absent or empty, the request is the one a round without briefs sends. */
  briefs?: readonly PromptBrief[];
}

/** A proposal with the ids of the briefs it adopts; `briefs` is absent for an intent of Claude's own. */
export type BriefProposal = Proposal & { briefs?: number[] };

/** Claude's reply to one brief, as it answered: the journal cuts and sanitizes it. */
export interface BriefReply {
  id: number;
  text: string;
}

export type ProposerOutput =
  | { ok: true; summary: string; proposals: BriefProposal[]; costUsd6: bigint; model: string; replies?: BriefReply[] }
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

/** agent/.env, the file `npm run agent` loads (node --env-file-if-exists=.env, run in agent/), found from this file. */
export const AGENT_ENV_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env");

/** The ANTHROPIC_API_KEY that `file` sets; undefined when there is no such file or it leaves the key out or blank. */
function envFileKey(file: string): string | undefined {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
  return parseEnv(text).ANTHROPIC_API_KEY || undefined;
}

/**
 * The key the agent sends to Claude: agent/.env's ANTHROPIC_API_KEY when the file sets one, else the environment's.
 * Node's --env-file keeps a variable the terminal already has, so a key exported there for another tool would
 * otherwise reach Claude in place of the agent's own.
 */
export function anthropicApiKey(env: NodeJS.ProcessEnv = process.env, file: string = AGENT_ENV_FILE): string | undefined {
  return envFileKey(file) ?? (env.ANTHROPIC_API_KEY || undefined);
}

/**
 * The SDK client, pinned to ANTHROPIC_API_URL and anthropicApiKey(). Left to itself the SDK reads ANTHROPIC_BASE_URL
 * (Claude Code exports one to the processes it starts), which would get the key and could answer for Claude, and with
 * no key it falls back to ANTHROPIC_AUTH_TOKEN or a login profile. A key passed in code keeps it from reading either.
 */
export function anthropicClient(opts: { fetch?: typeof globalThis.fetch; envFile?: string } = {}): Anthropic {
  const { envFile, ...client } = opts;
  const apiKey = anthropicApiKey(process.env, envFile);
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  return new Anthropic({ ...client, baseURL: ANTHROPIC_API_URL, apiKey, authToken: null });
}

/**
 * One line for main.ts to print at startup when the environment's ANTHROPIC_API_KEY differs from agent/.env's, the
 * one anthropicApiKey() sends; null otherwise. It names the variable and never a value.
 */
export function ignoredAnthropicKey(env: NodeJS.ProcessEnv = process.env, file: string = AGENT_ENV_FILE): string | null {
  const fromFile = envFileKey(file);
  if (!fromFile || !env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY === fromFile) return null;
  return "maat agent: ignoring ANTHROPIC_API_KEY from the environment: Claude is called with the one in agent/.env";
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
    const briefs = (input.briefs?.length ?? 0) > 0;
    try {
      res = await this.create({
        model: this.opts.model,
        max_tokens: 16000,
        // No cache_control: rounds start 15 to 60 minutes apart, past the 5-minute TTL, so a marker would only add the
        // 1.25x write with no read. The prompt (about 2,650 to 2,700 characters) is also near the 512-token minimum.
        system: [{ type: "text", text: (briefs ? briefSystemPrompt : systemPrompt)({ creditActions: input.creditActions }) }],
        messages: [{ role: "user", content: briefs ? renderBriefMessage(input) : renderUserMessage(input) }],
        output_config: { effort: "medium", format: { type: "json_schema", schema: briefs ? BRIEF_BATCH_JSON_SCHEMA : BATCH_JSON_SCHEMA } },
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
      if (briefs) {
        const b = BriefBatchSchema.safeParse(parsed);
        if (!b.success) return { ok: false, error: `invalid proposal JSON: ${b.error.issues.map((i) => i.message).join("; ")}`, costUsd6: cost };
        const proposals = b.data.intents.map(({ briefs: q, ...p }) => (q.length > 0 ? { ...p, briefs: q } : p));
        // One reply per brief this round sent, the first Claude gave; a reply to any other id is dropped, not fatal.
        const sent = new Set(input.briefs!.map((x) => x.id));
        const replies = b.data.replies.filter((r) => sent.delete(r.id));
        return { ok: true, summary: b.data.summary, proposals, costUsd6: cost, model: res.model, replies };
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
