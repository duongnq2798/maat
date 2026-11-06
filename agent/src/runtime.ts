import { createPublicClient, http, type Address, type PublicClient } from "viem";
import { base } from "viem/chains";
import type { AgentConfig } from "./config.js";
import { builderSuffix } from "./exec/builderCode.js";
import { CdpSender } from "./exec/cdpSender.js";
import { GuardedSender, type TxSender } from "./exec/sender.js";
import { Journal } from "./ledger/journal.js";
import { Store } from "./ledger/store.js";
import { ClaudeProposer, type Proposer } from "./llm/proposer.js";
import type { RunDeps } from "./loop/runOnce.js";
import { usdToUsdc6 } from "./units.js";

export async function buildRuntime(
  cfg: AgentConfig,
  o: {
    forceDryRun?: boolean;
    connectCdp?: (opts: { accountName: string; expectedAddress: Address }) => Promise<TxSender>;
    proposer?: Proposer;
  } = {},
): Promise<RunDeps> {
  const mode = o.forceDryRun ? "dry-run" : cfg.mode;
  // The Base chain keeps its multicall3 address; the cast only erases the OP-stack deposit-tx types the narrow client interfaces do not model.
  const client = createPublicClient({ chain: base, transport: http(cfg.rpcUrl) }) as PublicClient;
  let sender: TxSender | null = null;
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
    stateClient: client,
    previewClient: client,
    receipts: client,
    proposer: o.proposer ?? new ClaudeProposer({ model: cfg.loopModel }),
    sender,
    store: await Store.open(cfg.dataDir),
    journal: new Journal(cfg.dataDir),
  };
}
