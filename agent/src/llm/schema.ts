import { z } from "zod";
import { MAX_BRIEFS_PER_INTENT } from "../briefs/caps.js";

export const LLM_ACTIONS = ["BUY", "SELL", "SUPPLY", "WITHDRAW_COLLATERAL", "BORROW", "REPAY"] as const;
export const LLM_SYMBOLS = ["USDC", "NVDAc", "GOOGLc", "AAPLc"] as const;

/** The bounds BatchSchema enforces; SYSTEM_PROMPT states the same numbers to Claude. */
export const MAX_INTENTS = 6;
export const MAX_RATIONALE_CHARS = 600;
export const MAX_SUMMARY_CHARS = 1200;
export const MAX_AMOUNT_USD = 1_000_000;

export const ProposalSchema = z.strictObject({
  action: z.enum(LLM_ACTIONS),
  symbol: z.enum(LLM_SYMBOLS),
  amountUsd: z.number().positive().max(MAX_AMOUNT_USD),
  rationale: z.string().min(1).max(MAX_RATIONALE_CHARS),
});

export const BatchSchema = z.strictObject({
  summary: z.string().min(1).max(MAX_SUMMARY_CHARS),
  intents: z.array(ProposalSchema).max(MAX_INTENTS),
});

export type Batch = z.infer<typeof BatchSchema>;

/**
 * Structured-output schema sent to Claude. Kept to types, enums and required keys; the numeric and length
 * bounds live in BatchSchema, which validates every answer anyway (spec §5).
 */
export const BATCH_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "intents"],
  properties: {
    summary: { type: "string", description: "One or two sentences on what you decided and why, for the public diary." },
    intents: {
      type: "array",
      description: "Actions to submit, in execution order. An empty list means do nothing this round.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["action", "symbol", "amountUsd", "rationale"],
        properties: {
          action: { type: "string", enum: [...LLM_ACTIONS] },
          symbol: { type: "string", enum: [...LLM_SYMBOLS] },
          amountUsd: { type: "number", description: "Size in US dollars (for stock actions, the dollar value of shares)." },
          rationale: { type: "string", description: "Why, in one or two sentences. Published onchain as a hash." },
        },
      },
    },
  },
} as const;

/** A brief round's intent: an intent as above, with the ids of the MaatInbox briefs it adopts (none for its own). */
export const BriefProposalSchema = z.strictObject({
  ...ProposalSchema.shape,
  briefs: z.array(z.number().int().positive()).max(MAX_BRIEFS_PER_INTENT),
});

/** A reply to one brief. Its length is not bounded here: the journal cuts it to MAX_REPLY_CHARS, so one long reply never costs the round. */
export const ReplySchema = z.strictObject({ id: z.number().int().positive(), text: z.string() });

/** The answer of a round that carries briefs. Up to MAX_INTENTS replies: a repeated one is ignored, not rejected. */
export const BriefBatchSchema = z.strictObject({
  summary: BatchSchema.shape.summary,
  intents: z.array(BriefProposalSchema).max(MAX_INTENTS),
  replies: z.array(ReplySchema).max(MAX_INTENTS),
});

export type BriefBatch = z.infer<typeof BriefBatchSchema>;

const INTENT_JSON_SCHEMA = BATCH_JSON_SCHEMA.properties.intents;

/** The structured-output schema of a round that carries briefs: BATCH_JSON_SCHEMA plus each intent's briefs and the replies. */
export const BRIEF_BATCH_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "intents", "replies"],
  properties: {
    summary: BATCH_JSON_SCHEMA.properties.summary,
    intents: {
      ...INTENT_JSON_SCHEMA,
      items: {
        ...INTENT_JSON_SCHEMA.items,
        required: [...INTENT_JSON_SCHEMA.items.required, "briefs"],
        properties: {
          ...INTENT_JSON_SCHEMA.items.properties,
          briefs: { type: "array", items: { type: "integer" }, description: "The ids of the briefs this intent adopts, at most 3. Empty for an intent of your own." },
        },
      },
    },
    replies: {
      type: "array",
      description: "One reply to each brief, by its id. Published as written, cut at 200 characters.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "text"],
        properties: { id: { type: "integer" }, text: { type: "string", description: "What you did with the brief and why, in plain English." } },
      },
    },
  },
} as const;
