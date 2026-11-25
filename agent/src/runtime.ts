import { createPublicClient, fallback, http, type Address, type PublicClient } from "viem";
import { base } from "viem/chains";
import type { AgentConfig } from "./config.js";
import { builderSuffix } from "./exec/builderCode.js";
import { CdpSender } from "./exec/cdpSender.js";
import { GuardedSender, type TxSender } from "./exec/sender.js";
import { gitCommit } from "./gitCommit.js";
import { Journal } from "./ledger/journal.js";
import { Store } from "./ledger/store.js";
import { ClaudeProposer, type Proposer } from "./llm/proposer.js";
import { BILL_MIN_USD6, LIVE_BILL_MIN_USD6, type RunDeps } from "./loop/runOnce.js";
import { DEFAULT_POLICY } from "./policy.js";
import { usdToUsdc6 } from "./units.js";

export async function buildRuntime(
  cfg: AgentConfig,
  o: {
    forceDryRun?: boolean;
    connectCdp?: (opts: { accountName: string; expectedAddress: Address }) => Promise<TxSender>;
    proposer?: Proposer;
    /** The commit stamped into every journal row; gitCommit() of the running code when unset. */
    commit?: string;
  } = {},
): Promise<RunDeps> {
  const mode = o.forceDryRun ? "dry-run" : cfg.mode;
  const journal = new Journal(cfg.dataDir, { commit: o.commit ?? gitCommit() });
  // A live agent in a dry-run's data dir would pay the dry-run's Claude bill back from the vault, and its journal would
  // mix rehearsal rows with live ones. Checked before any CDP call.
  if (mode === "live") {
    const row = await journal.firstDryRunRow();
    if (row) {
      throw new Error(
        `live mode refuses data dir ${cfg.dataDir}: its journal holds dry-run rows (first: run ${String(row.runId)} at ${String(row.ts)}); give live its own MAAT_DATA_DIR`,
      );
    }
  }
  // viem sends each request to the first RPC and moves to the second only when the first fails.
  const transport = cfg.rpcFallbackUrl ? fallback([http(cfg.rpcUrl), http(cfg.rpcFallbackUrl)]) : http(cfg.rpcUrl);
  // The Base chain keeps its multicall3 address; the cast only erases the OP-stack deposit-tx types the narrow client interfaces do not model.
  const client = createPublicClient({ chain: base, transport }) as PublicClient;
  let sender: GuardedSender | null = null;
  if (mode === "live") {
    const suffix = builderSuffix(cfg.builderCode ?? ""); // validates before any CDP call
    const connect = o.connectCdp ?? ((opts) => CdpSender.connect(opts));
    const cdp = await connect({ accountName: cfg.cdpAccountName, expectedAddress: cfg.executor });
    sender = new GuardedSender(cdp, { vault: cfg.vault, suffix });
  }
  return {
    vault: cfg.vault,
    executor: cfg.executor,
    expensePayee: cfg.expensePayee,
    mode,
    defaultDailyComputeUsd6: usdToUsdc6(cfg.defaultDailyComputeUsd),
    maxTxPerDay: cfg.maxTxPerDay,
    billMinUsd6: cfg.billMinUsd !== undefined ? usdToUsdc6(cfg.billMinUsd) : mode === "live" ? LIVE_BILL_MIN_USD6 : BILL_MIN_USD6,
    maxLlmUsd6PerDay: usdToUsdc6(cfg.maxLlmUsdPerDay),
    stateClient: client,
    previewClient: client,
    txClient: client,
    proposer: o.proposer ?? new ClaudeProposer({ model: cfg.loopModel }),
    sender,
    store: await Store.open(cfg.dataDir),
    journal,
    policy: { ...DEFAULT_POLICY, creditActions: cfg.creditActions },
  };
}
