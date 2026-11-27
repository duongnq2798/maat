import type { Hash, Hex } from "viem";
import { decodeVaultLogs, type DecisionEvent } from "@/lib/chain/events";
import { senderLabel, type SenderLabel } from "@/lib/chain/ledger";
import { decodeExecuteInput } from "@/lib/chain/rationale";
import { DECISION_TOPIC, type Sender, type WindowDecision } from "./decisions";
import type { LogReader } from "./rpc";

/** MandateVault.owner(): immutable, so a read at latest names the owner of every window. */
export const OWNER_SELECTOR = "0x8da5cb5b";

/** The Sender of each /ledger sender label; unlabelled, a tx that is not a direct execute call, has no label. */
export const LABEL: Record<SenderLabel, Sender> = { "owner, by hand": "owner", probe: "probe", "brief-driven": "brief", agent: "agent" };

export async function readOwner(reader: Pick<LogReader, "call">, vault: string): Promise<string> {
  const word = await reader.call(vault, OWNER_SELECTOR);
  if (!/^0x[0-9a-fA-F]{64}$/.test(word)) throw new Error(`owner() of ${vault} returned ${word}`);
  return `0x${word.slice(-40)}`.toLowerCase();
}

/**
 * The vault's Decision logs in blocks [from, to], each with its sender's label, read the way /ledger reads them: the log
 * decoded with the vault's ABI, and the label from its transaction's sender and calldata (lib/chain/ledger.ts).
 */
export async function readDecisions(
  reader: Pick<LogReader, "getLogs" | "transaction" | "blockTs">,
  q: { vault: string; owner: string; from: number; to: number },
): Promise<WindowDecision[]> {
  const logs = await reader.getLogs({ address: q.vault, topic0: DECISION_TOPIC, from: q.from, to: q.to });
  const out: WindowDecision[] = [];
  for (const log of logs) {
    const at = `block ${Number(BigInt(log.blockNumber))} log ${Number(BigInt(log.logIndex))}`;
    const [event] = decodeVaultLogs([
      {
        blockNumber: BigInt(log.blockNumber).toString(),
        logIndex: Number(BigInt(log.logIndex)),
        transactionHash: log.transactionHash as Hash,
        topics: log.topics as Hex[],
        data: log.data as Hex,
      },
    ]);
    if (event?.name !== "Decision") throw new Error(`${at}: a log under the Decision topic does not decode as a Decision`);
    const d = event as DecisionEvent;
    const tx = await reader.transaction(d.txHash);
    const call = tx.to !== null && tx.to.toLowerCase() === q.vault.toLowerCase() ? decodeExecuteInput(tx.input as Hex) : null;
    const block = Number(d.blockNumber);
    out.push({
      block,
      logIndex: d.logIndex,
      ts: log.blockTimestamp === undefined ? await reader.blockTs(block) : Number(BigInt(log.blockTimestamp)),
      tx: d.txHash.toLowerCase(),
      sender: call ? LABEL[senderLabel(tx.from as Hex, q.owner as Hex, call.blob)] : "unlabelled",
      allowed: d.allowed,
      reason: d.reason,
    });
  }
  return out;
}
