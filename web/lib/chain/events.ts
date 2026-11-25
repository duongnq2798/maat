import { decodeEventLog, encodeAbiParameters, getAddress, keccak256, type AbiEvent, type Address, type Hash, type Hex } from "viem";
import { ACTIONS, type ActionName } from "@/content/decisions";
import { REASONS, type ReasonCode } from "@/content/reasons";
import { vaultAbi } from "./abi";
import type { CachedLog } from "./cache";

interface At {
  blockNumber: bigint;
  logIndex: number;
  txHash: Hash;
}

export type DecisionEvent = At & {
  name: "Decision";
  intentId: Hex;
  action: ActionName;
  token: Address;
  amount: bigint;
  allowed: boolean;
  reason: ReasonCode;
  rationaleHash: Hex;
};

/** The vault events the ledger reads, in a shape that needs no ABI to use. */
export type VaultEvent =
  | DecisionEvent
  | (At & { name: "RevenueReceived"; amount: bigint })
  | (At & { name: "Funded"; amount: bigint })
  | (At & { name: "Withdrawn"; token: Address; amount: bigint })
  /** `mandateHash` is keccak256(abi.encode(mandate)), what MandateApplied emits once the change applies. */
  | (At & { name: "MandateChangeQueued"; changeHash: Hex; eta: number; mandateHash: Hex })
  | (At & { name: "TokenConfigChangeQueued"; changeHash: Hex; eta: number; token: Address; configKey: string })
  | (At & { name: "PayeeChangeQueued"; changeHash: Hex; eta: number; payee: Address; allowed: boolean })
  | (At & { name: "ChangeCancelled"; changeHash: Hex })
  | (At & { name: "MandateApplied"; mandateHash: Hex })
  | (At & { name: "TokenConfigApplied"; token: Address; configKey: string })
  | (At & { name: "PayeeApplied"; payee: Address; allowed: boolean })
  | (At & { name: "PausedSet"; paused: boolean })
  | (At & { name: "ExecutorSet"; executor: Address });

const mandateParam = (vaultAbi.find((x) => x.type === "event" && x.name === "MandateChangeQueued") as AbiEvent).inputs[2]!;

/** A TokenConfig as a string, so a queued config and an applied one compare equal. */
function configKey(c: unknown): string {
  const o = c as { allowed: boolean; feed: Address; pool: Address; maxWeightBps: number };
  return `${o.allowed}|${o.feed.toLowerCase()}|${o.pool.toLowerCase()}|${o.maxWeightBps}`;
}

function toEvent(log: CachedLog): VaultEvent | null {
  let decoded: { eventName?: string; args?: unknown };
  try {
    decoded = decodeEventLog({ abi: vaultAbi, topics: log.topics as [Hex, ...Hex[]], data: log.data, strict: true });
  } catch {
    return null;
  }
  const a = (decoded.args ?? {}) as Record<string, unknown>;
  const at: At = { blockNumber: BigInt(log.blockNumber), logIndex: log.logIndex, txHash: log.transactionHash };
  const eta = () => Number(a.eta as bigint);
  switch (decoded.eventName) {
    case "Decision": {
      const action = ACTIONS[Number(a.action)];
      const r = Number(a.reason);
      const reason: ReasonCode | undefined = r === 0 ? "OK" : REASONS[r - 1];
      if (!action || !reason) return null;
      return {
        ...at,
        name: "Decision",
        intentId: a.intentId as Hex,
        action,
        token: getAddress(a.token as string),
        amount: a.amount as bigint,
        allowed: a.allowed as boolean,
        reason,
        rationaleHash: a.rationaleHash as Hex,
      };
    }
    case "RevenueReceived":
    case "Funded":
      return { ...at, name: decoded.eventName, amount: a.amount as bigint };
    case "Withdrawn":
      return { ...at, name: "Withdrawn", token: getAddress(a.token as string), amount: a.amount as bigint };
    case "MandateChangeQueued":
      return {
        ...at,
        name: "MandateChangeQueued",
        changeHash: a.changeHash as Hex,
        eta: eta(),
        mandateHash: keccak256(encodeAbiParameters([mandateParam], [a.mandate])),
      };
    case "TokenConfigChangeQueued":
      return { ...at, name: "TokenConfigChangeQueued", changeHash: a.changeHash as Hex, eta: eta(), token: getAddress(a.token as string), configKey: configKey(a.config) };
    case "PayeeChangeQueued":
      return { ...at, name: "PayeeChangeQueued", changeHash: a.changeHash as Hex, eta: eta(), payee: getAddress(a.payee as string), allowed: a.allowed as boolean };
    case "ChangeCancelled":
      return { ...at, name: "ChangeCancelled", changeHash: a.changeHash as Hex };
    case "MandateApplied":
      return { ...at, name: "MandateApplied", mandateHash: a.mandateHash as Hex };
    case "TokenConfigApplied":
      return { ...at, name: "TokenConfigApplied", token: getAddress(a.token as string), configKey: configKey(a.config) };
    case "PayeeApplied":
      return { ...at, name: "PayeeApplied", payee: getAddress(a.payee as string), allowed: a.allowed as boolean };
    case "PausedSet":
      return { ...at, name: "PausedSet", paused: a.paused as boolean };
    case "ExecutorSet":
      return { ...at, name: "ExecutorSet", executor: getAddress(a.executor as string) };
    default:
      return null;
  }
}

/** The vault's logs as events, oldest first. A log the ledger does not read (or cannot decode) is skipped. */
export function decodeVaultLogs(logs: readonly CachedLog[]): VaultEvent[] {
  return logs
    .map(toEvent)
    .filter((e): e is VaultEvent => e !== null)
    .sort((x, y) => (x.blockNumber === y.blockNumber ? x.logIndex - y.logIndex : x.blockNumber < y.blockNumber ? -1 : 1));
}
