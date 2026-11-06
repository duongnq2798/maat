import { z } from "zod";

export const LLM_ACTIONS = ["BUY", "SELL", "SUPPLY", "WITHDRAW_COLLATERAL", "BORROW", "REPAY"] as const;
export const LLM_SYMBOLS = ["USDC", "NVDAc", "GOOGLc", "AAPLc"] as const;

export const ProposalSchema = z.strictObject({
  action: z.enum(LLM_ACTIONS),
  symbol: z.enum(LLM_SYMBOLS),
  amountUsd: z.number().positive().max(1_000_000),
  rationale: z.string().min(1).max(600),
});

export const BatchSchema = z.strictObject({
  summary: z.string().min(1).max(1200),
  intents: z.array(ProposalSchema).max(6),
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
