import { getAddress, isAddress, type Address } from "viem";
import { z } from "zod";

/** An env file loader turns `KEY=` into "". Treat that as unset so defaults apply. */
const blank = (v: unknown) => (v === "" ? undefined : v);

/** Every field goes through `blank` first, so an empty value behaves like an absent one. */
const field = <T extends z.ZodType>(schema: T) => z.preprocess(blank, schema);

const address = (name: string) =>
  field(
    z
      .string({ error: `${name} is required` })
      .refine((v) => isAddress(v, { strict: false }), `${name} is not an address`)
      .transform((v) => getAddress(v) as Address),
  );

const schema = z
  .object({
    BASE_RPC_URL: field(z.string({ error: "BASE_RPC_URL is required" }).pipe(z.url())),
    MAAT_VAULT: address("MAAT_VAULT"),
    MAAT_EXECUTOR: address("MAAT_EXECUTOR"),
    MAAT_EXPENSE_PAYEE: address("MAAT_EXPENSE_PAYEE"),
    MAAT_MODE: field(z.enum(["dry-run", "live"]).default("dry-run")),
    MAAT_BUILDER_CODE: field(z.string().min(1).optional()),
    MAAT_LOOP_MODEL: field(z.string().default("claude-sonnet-5-5")),
    MAAT_DATA_DIR: field(z.string().default("./data")),
    MAAT_MAX_TX_PER_DAY: field(z.coerce.number().int().positive().default(40)),
    MAAT_DEFAULT_DAILY_COMPUTE_USD: field(z.coerce.number().positive().default(0.5)),
    CDP_ACCOUNT_NAME: field(z.string().default("maat-executor")),
  })
  .superRefine((v, ctx) => {
    if (v.MAAT_MODE === "live" && !v.MAAT_BUILDER_CODE) {
      ctx.addIssue({ code: "custom", path: ["MAAT_BUILDER_CODE"], message: "MAAT_BUILDER_CODE is required in live mode" });
    }
  });

export interface AgentConfig {
  rpcUrl: string;
  vault: Address;
  executor: Address;
  expensePayee: Address;
  mode: "dry-run" | "live";
  builderCode: string | undefined;
  loopModel: string;
  dataDir: string;
  maxTxPerDay: number;
  defaultDailyComputeUsd: number;
  cdpAccountName: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const r = schema.safeParse(env);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`invalid agent config: ${msg}`);
  }
  const v = r.data;
  return {
    rpcUrl: v.BASE_RPC_URL,
    vault: v.MAAT_VAULT,
    executor: v.MAAT_EXECUTOR,
    expensePayee: v.MAAT_EXPENSE_PAYEE,
    mode: v.MAAT_MODE,
    builderCode: v.MAAT_BUILDER_CODE,
    loopModel: v.MAAT_LOOP_MODEL,
    dataDir: v.MAAT_DATA_DIR,
    maxTxPerDay: v.MAAT_MAX_TX_PER_DAY,
    defaultDailyComputeUsd: v.MAAT_DEFAULT_DAILY_COMPUTE_USD,
    cdpAccountName: v.CDP_ACCOUNT_NAME,
  };
}
