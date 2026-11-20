import { BUILDER_CODE_PATTERN } from "@x402/extensions/builder-code";
import { getAddress, isAddress, type Address } from "viem";
import { z } from "zod";
import { address, field } from "../config.js";

const schema = z
  .object({
    BASE_RPC_URL: field(z.string({ error: "BASE_RPC_URL is required" }).pipe(z.url())),
    MAAT_VAULT: address("MAAT_VAULT"),
    MAAT_EXECUTOR: address("MAAT_EXECUTOR"),
    /** Where x402 payments go. Unset: the vault itself (spec 3.4). The S4 fallback sets an owner-held address. */
    GUARD_PAY_TO: field(
      z
        .string()
        .refine((v) => isAddress(v, { strict: false }), "GUARD_PAY_TO is not an address")
        .transform((v) => getAddress(v) as Address)
        .optional(),
    ),
    GUARD_PORT: field(z.coerce.number().int().min(1).max(65_535).default(8080)),
    GUARD_RATE_LIMIT_PER_MINUTE: field(z.coerce.number().int().positive().default(60)),
    GUARD_CORS_ORIGINS: field(z.string().default("https://maatonbase.xyz,https://www.maatonbase.xyz")),
    GUARD_BUILDER_CODE: field(z.string().regex(BUILDER_CODE_PATTERN, "GUARD_BUILDER_CODE must match ^[a-z0-9_]{1,32}$").optional()),
    /** A facilitator other than CDP's (a local one in tests). Unset: the CDP facilitator, which needs the API key. */
    GUARD_FACILITATOR_URL: field(z.url().optional()),
    CDP_API_KEY_ID: field(z.string().optional()),
    CDP_API_KEY_SECRET: field(z.string().optional()),
    CDP_WALLET_SECRET: field(z.string().optional()),
  })
  .superRefine((v, ctx) => {
    if (v.CDP_WALLET_SECRET !== undefined) {
      ctx.addIssue({ code: "custom", path: ["CDP_WALLET_SECRET"], message: "the guard never signs; remove CDP_WALLET_SECRET from its env" });
    }
    if (!v.GUARD_FACILITATOR_URL && (!v.CDP_API_KEY_ID || !v.CDP_API_KEY_SECRET)) {
      ctx.addIssue({ code: "custom", path: ["CDP_API_KEY_ID"], message: "the CDP facilitator needs CDP_API_KEY_ID and CDP_API_KEY_SECRET" });
    }
  });

export interface GuardConfig {
  rpcUrl: string;
  vault: Address;
  executor: Address;
  payTo: Address;
  port: number;
  rateLimitPerMinute: number;
  corsOrigins: string[];
  builderCode: string | undefined;
  facilitator: { kind: "url"; url: string } | { kind: "cdp"; apiKeyId: string; apiKeySecret: string };
}

export function loadGuardConfig(env: NodeJS.ProcessEnv = process.env): GuardConfig {
  const r = schema.safeParse(env);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`invalid guard config: ${msg}`);
  }
  const v = r.data;
  return {
    rpcUrl: v.BASE_RPC_URL,
    vault: v.MAAT_VAULT,
    executor: v.MAAT_EXECUTOR,
    payTo: v.GUARD_PAY_TO ?? v.MAAT_VAULT,
    port: v.GUARD_PORT,
    rateLimitPerMinute: v.GUARD_RATE_LIMIT_PER_MINUTE,
    corsOrigins: v.GUARD_CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean),
    builderCode: v.GUARD_BUILDER_CODE,
    facilitator: v.GUARD_FACILITATOR_URL
      ? { kind: "url", url: v.GUARD_FACILITATOR_URL }
      : { kind: "cdp", apiKeyId: v.CDP_API_KEY_ID!, apiKeySecret: v.CDP_API_KEY_SECRET! },
  };
}
