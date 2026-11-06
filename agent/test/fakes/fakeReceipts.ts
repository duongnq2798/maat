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
import type { ReceiptClient } from "../../src/loop/runOnce.js";
import type { OnchainIntent } from "../../src/types.js";
import type { FakeSender } from "./fakeSender.js";

export class FakeReceipts {
  status: "success" | "reverted" = "success";
  verdict: (i: OnchainIntent) => { allowed: boolean; reason: number } = () => ({ allowed: true, reason: 0 });

  constructor(
    private readonly sender: FakeSender,
    private readonly vault: Address,
    private readonly suffixSize: number,
  ) {}

  /** The calls the vault received, Builder Code stripped. */
  calls() {
    return this.sender.sent.map((t) => decodeFunctionData({ abi: mandateVaultAbi, data: slice(t.data, 0, size(t.data) - this.suffixSize) }));
  }

  client(): ReceiptClient {
    return {
      waitForTransactionReceipt: (async ({ hash }: { hash: Hex }) => {
        const call = this.calls()[Number(hash) - 1]!;
        const logs = [];
        if (call.functionName === "execute") {
          const i = call.args[0] as OnchainIntent;
          const v = this.verdict(i);
          logs.push({
            address: this.vault,
            topics: encodeEventTopics({ abi: mandateVaultAbi, eventName: "Decision", args: { intentId: i.id, token: i.token } }),
            data: encodeAbiParameters(parseAbiParameters("uint8, uint256, bool, uint8, bytes32"), [i.action, i.amount, v.allowed, v.reason, i.rationaleHash]),
            blockNumber: 1n,
            blockHash: `0x${"00".repeat(32)}`,
            transactionHash: hash,
            transactionIndex: 0,
            logIndex: 0,
            removed: false,
          });
        }
        return { status: this.status, transactionHash: hash, logs } as unknown as TransactionReceipt;
      }) as ReceiptClient["waitForTransactionReceipt"],
    };
  }
}
