import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiParameters,
  size,
  slice,
  type Address,
  type Hex,
  TransactionNotFoundError,
  WaitForTransactionReceiptTimeoutError,
  type TransactionReceipt,
} from "viem";
import { mandateVaultAbi } from "../../src/abi/index.js";
import type { TxClient } from "../../src/loop/runOnce.js";
import type { OnchainIntent } from "../../src/types.js";
import type { FakeSender } from "./fakeSender.js";

const ZERO32: Hex = `0x${"00".repeat(32)}`;

/**
 * The chain side of a send. Everything the FakeSender broadcast is mined (unless listed in `mempool`) with
 * `status`, so receipts, usedIntent and Decision logs agree with what was sent.
 */
export class FakeReceipts {
  status: "success" | "reverted" = "success";
  /** The vault's Decision for an execute; null: the receipt carries no Decision for it. */
  verdict: (i: OnchainIntent) => { allowed: boolean; reason: number } | null = () => ({ allowed: true, reason: 0 });
  /** waitForTransactionReceipt times out although the transaction is mined. */
  timeout = false;
  /** Broadcast but not mined: no receipt, getTransaction has blockNumber null. */
  mempool = new Set<Hex>();
  logQueries: { fromBlock: unknown; intentId: unknown }[] = [];
  estimate: (data: Hex) => bigint | Promise<bigint> = () => 200_000n;
  estimates: { account: unknown; to: unknown; data: Hex }[] = [];
  /** syncMultiplier emits MultiplierChangeDetected (false: the vault's try uiMultiplier() failed silently). */
  syncEvent = true;

  constructor(
    private readonly sender: FakeSender,
    private readonly vault: Address,
    private readonly suffixSize: number,
  ) {}

  /** The calls the vault received, Builder Code stripped. */
  calls() {
    return this.sender.sent.map((t) => decodeFunctionData({ abi: mandateVaultAbi, data: slice(t.data, 0, size(t.data) - this.suffixSize) }));
  }

  private log(hash: Hex, topics: readonly Hex[], data: Hex) {
    return { address: this.vault, topics, data, blockNumber: 1n, blockHash: ZERO32, transactionHash: hash, transactionIndex: 0, logIndex: 0, removed: false };
  }

  receipt(hash: Hex): TransactionReceipt {
    const call = this.calls()[Number(hash) - 1]!;
    const logs = [];
    const v = call.functionName === "execute" ? this.verdict(call.args[0] as OnchainIntent) : null;
    if (call.functionName === "execute" && v && this.status === "success") {
      const i = call.args[0] as OnchainIntent;
      logs.push(
        this.log(
          hash,
          encodeEventTopics({ abi: mandateVaultAbi, eventName: "Decision", args: { intentId: i.id, token: i.token } }) as Hex[],
          encodeAbiParameters(parseAbiParameters("uint8, uint256, bool, uint8, bytes32"), [i.action, i.amount, v.allowed, v.reason, i.rationaleHash]),
        ),
      );
    }
    if (call.functionName === "syncMultiplier" && this.syncEvent) {
      const token = call.args[0] as Address;
      logs.push(
        this.log(
          hash,
          encodeEventTopics({ abi: mandateVaultAbi, eventName: "MultiplierChangeDetected", args: { token } }) as Hex[],
          encodeAbiParameters(parseAbiParameters("uint256, uint256"), [10n ** 18n, 2n * 10n ** 18n]),
        ),
      );
    }
    return { status: this.status, transactionHash: hash, blockNumber: 1n, gasUsed: 150_000n, logs } as unknown as TransactionReceipt;
  }

  private hashOf(i: number): Hex {
    return `0x${(i + 1).toString(16).padStart(64, "0")}`;
  }

  private mined(): { hash: Hex; id?: Hex }[] {
    return this.calls()
      .map((c, i) => ({ hash: this.hashOf(i), id: c.functionName === "execute" ? (c.args[0] as OnchainIntent).id : undefined }))
      .filter((x) => !this.mempool.has(x.hash));
  }

  client(): TxClient {
    return {
      readContract: (async ({ functionName, args }: { functionName: string; args: readonly [Hex] }) => {
        if (functionName !== "usedIntent") throw new Error(`fake: no ${functionName}`);
        return this.status === "success" && this.mined().some((x) => x.id === args[0]);
      }) as never,
      getLogs: (async ({ args, fromBlock }: { args: { intentId: Hex }; fromBlock: unknown }) => {
        this.logQueries.push({ fromBlock, intentId: args.intentId });
        return this.mined()
          .filter((x) => x.id === args.intentId)
          .flatMap((x) => this.receipt(x.hash).logs);
      }) as never,
      getTransaction: (async ({ hash }: { hash: Hex }) => {
        if (Number(hash) < 1 || Number(hash) > this.sender.sent.length) throw new TransactionNotFoundError({ hash });
        return { hash, blockNumber: this.mempool.has(hash) ? null : 1n };
      }) as never,
      estimateGas: (async (a: { account: unknown; to: unknown; data: Hex }) => (this.estimates.push(a), this.estimate(a.data))) as never,
      waitForTransactionReceipt: (async ({ hash }: { hash: Hex }) => {
        if (this.timeout || this.mempool.has(hash)) throw new WaitForTransactionReceiptTimeoutError({ hash });
        return this.receipt(hash);
      }) as TxClient["waitForTransactionReceipt"],
    } as TxClient;
  }
}
