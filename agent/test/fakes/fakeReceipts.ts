import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiParameters,
  size,
  slice,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { mandateVaultAbi } from "../../src/abi/index.js";
import type { TxClient } from "../../src/loop/runOnce.js";
import type { OnchainIntent } from "../../src/types.js";
import type { FakeSender } from "./fakeSender.js";

const ZERO32: Hex = `0x${"00".repeat(32)}`;

/** The chain side of a send: gas estimates and receipts for what the FakeSender broadcast. */
export class FakeReceipts {
  status: "success" | "reverted" = "success";
  verdict: (i: OnchainIntent) => { allowed: boolean; reason: number } = () => ({ allowed: true, reason: 0 });
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
    if (call.functionName === "execute") {
      const i = call.args[0] as OnchainIntent;
      const v = this.verdict(i);
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

  client(): TxClient {
    return {
      estimateGas: (async (a: { account: unknown; to: unknown; data: Hex }) => (this.estimates.push(a), this.estimate(a.data))) as never,
      waitForTransactionReceipt: (async ({ hash }: { hash: Hex }) => this.receipt(hash)) as TxClient["waitForTransactionReceipt"],
    } as TxClient;
  }
}
