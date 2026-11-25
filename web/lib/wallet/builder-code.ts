import { getAddress, type AbiEvent, type Address, type Hash, type Hex } from "viem";
import addresses from "@/content/generated/base-addresses.json";
import { vaultAbi } from "@/lib/chain/abi";
import type { CachedLog } from "@/lib/chain/cache";
import { SCAN_FLOOR_BLOCK } from "@/lib/chain/config";
import { decodeVaultLogs, type DecisionEvent } from "@/lib/chain/events";
import { builderCodeReference, toMainnetDecisions, type TxInput } from "@/lib/chain/ledger";
import type { LedgerClient } from "@/lib/chain/load";
import { LOG_CHUNK, scanLogs } from "@/lib/chain/scan";
import { BUILDER_CODE_RE, erc8021Suffix } from "./suffix";

export type BuilderCodeRead =
  | { state: "read"; code: string; suffix: Hex; txHash: Hash }
  /** `why` finishes the sentence "The Builder Code could not be read: …". */
  | { state: "unavailable"; why: string };

const decisionEvent = vaultAbi.find((x) => x.type === "event" && x.name === "Decision") as AbiEvent;
const USDC = getAddress(addresses.find((a) => a.name === "USDC")!.value);
/** Chunks read at once while looking for the first Decision; the scan stops at the first batch that holds one. */
const BATCH = 6n * LOG_CHUNK;

const unavailable = (why: string): BuilderCodeRead => ({ state: "unavailable", why });

async function deployBlock(client: LedgerClient, deployTx: Hash | null): Promise<bigint> {
  if (!deployTx) return SCAN_FLOOR_BLOCK;
  try {
    return (await client.getTransactionReceipt({ hash: deployTx })).blockNumber;
  } catch {
    return SCAN_FLOOR_BLOCK;
  }
}

/** The vault's first Decision, scanning forward from `from`; "failed" when a chunk could not be read before it was found. */
async function firstDecision(client: LedgerClient, vault: Address, from: bigint, head: bigint, signal?: AbortSignal): Promise<DecisionEvent | null | "failed"> {
  for (let lo = from; lo <= head; lo += BATCH) {
    const hi = lo + BATCH - 1n < head ? lo + BATCH - 1n : head;
    const r = await scanLogs<CachedLog>({
      from: lo,
      to: hi,
      signal,
      maxFailed: 1,
      getLogs: async (range) =>
        (await client.getLogs({ address: vault, event: decisionEvent, fromBlock: range.from, toBlock: range.to })).flatMap((l) =>
          l.blockNumber === null || l.transactionHash === null || l.logIndex === null
            ? []
            : [{ blockNumber: l.blockNumber.toString(), logIndex: l.logIndex, transactionHash: l.transactionHash, topics: [...l.topics] as Hex[], data: l.data }],
        ),
    });
    if (r.failed.length > 0) return "failed";
    const first = decodeVaultLogs(r.logs).find((e): e is DecisionEvent => e.name === "Decision");
    if (first) return first;
  }
  return null;
}

/**
 * The Builder Code a brief carries, read as /ledger reads its reference (lib/chain/ledger.ts builderCodeReference): the
 * first ERC-8021 code on the vault's first Decision, when the vault's owner sent that Decision. Nothing about the code
 * is written into the site; when it cannot be read, the result says why and the brief goes without a suffix.
 */
export async function readBuilderCode(client: LedgerClient, opts: { vault: Address; deployTx: Hash | null; signal?: AbortSignal }): Promise<BuilderCodeRead> {
  const { vault } = opts;
  let owner: Address;
  try {
    owner = getAddress((await client.readContract({ address: vault, abi: vaultAbi, functionName: "owner" })) as Address);
  } catch {
    return unavailable("the vault's owner could not be read");
  }
  let found: DecisionEvent | null | "failed";
  try {
    const head = await client.getBlockNumber();
    found = await firstDecision(client, vault, await deployBlock(client, opts.deployTx), head, opts.signal);
  } catch {
    found = "failed";
  }
  if (found === "failed") return unavailable("a log read failed before the vault's first Decision was found");
  if (found === null) return unavailable("the vault has no Decision yet");

  let tx: TxInput;
  try {
    const t = await client.getTransaction({ hash: found.txHash });
    tx = { from: getAddress(t.from), to: t.to ? getAddress(t.to) : null, input: t.input };
  } catch {
    return unavailable("the vault's first Decision transaction could not be read");
  }
  if (tx.from.toLowerCase() !== owner.toLowerCase()) return unavailable("the vault's first Decision was not sent by its owner");

  const decisions = toMainnetDecisions([found], { blockTimes: {}, gasUsed: {}, decimals: {}, usdc: USDC });
  const code = builderCodeReference(decisions, new Map([[found.txHash.toLowerCase(), tx]]), { vault, owner, complete: true });
  if (code === null) return unavailable("the vault's first Decision carries no Builder Code");
  if (!BUILDER_CODE_RE.test(code)) return unavailable("the code on the vault's first Decision is not a valid Builder Code");
  return { state: "read", code, suffix: erc8021Suffix(code), txHash: found.txHash };
}
