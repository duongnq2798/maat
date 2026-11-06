import { encodeFunctionData } from "viem";
import { describe, expect, it } from "vitest";
import { mandateVaultAbi } from "../src/abi/index.js";
import { builderSuffix, codesIn } from "../src/exec/builderCode.js";
import { encodeExecute, encodeSyncMultiplier } from "../src/exec/calls.js";
import { GuardedSender, SendRefused } from "../src/exec/sender.js";
import type { OnchainIntent } from "../src/types.js";
import { FakeSender } from "./fakes/fakeSender.js";

const VAULT = "0x1111111111111111111111111111111111111111" as const;
const suffix = builderSuffix("bc_maattest");
const intent: OnchainIntent = {
  id: `0x${"11".repeat(32)}`,
  action: 0,
  token: "0xb20000000000000000000078ee7ce2fE4908108C",
  amount: 20_000_000n,
  minOut: 0n,
  payee: "0x0000000000000000000000000000000000000000",
  rationaleHash: `0x${"22".repeat(32)}`,
};

describe("GuardedSender", () => {
  it("appends the Builder Code to execute and syncMultiplier", async () => {
    const inner = new FakeSender();
    const g = new GuardedSender(inner, { vault: VAULT, suffix });
    await g.send({ to: VAULT, data: encodeExecute(intent), idempotencyKey: "k1" });
    await g.send({ to: VAULT, data: encodeSyncMultiplier(intent.token), idempotencyKey: "k2" });
    expect(inner.sent.map((t) => codesIn(t.data))).toEqual([["bc_maattest"], ["bc_maattest"]]);
    expect(inner.sent.map((t) => t.idempotencyKey)).toEqual(["k1", "k2"]);
    expect(g.address).toBe(inner.address);
  });

  it("compares the vault address case-insensitively", async () => {
    const inner = new FakeSender();
    const checksummed = "0xABcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD" as const;
    await new GuardedSender(inner, { vault: checksummed, suffix }).send({ to: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd", data: encodeExecute(intent), idempotencyKey: "k" });
    expect(inner.sent).toHaveLength(1);
  });

  it("refuses another target", async () => {
    const g = new GuardedSender(new FakeSender(), { vault: VAULT, suffix });
    await expect(g.send({ to: "0x9999999999999999999999999999999999999999", data: encodeExecute(intent), idempotencyKey: "k" })).rejects.toBeInstanceOf(SendRefused);
  });

  it("refuses owner functions", async () => {
    const g = new GuardedSender(new FakeSender(), { vault: VAULT, suffix });
    const data = encodeFunctionData({ abi: mandateVaultAbi, functionName: "withdraw", args: [intent.token, 1n] });
    await expect(g.send({ to: VAULT, data, idempotencyKey: "k" })).rejects.toThrow(/function withdraw is not allowed/);
  });

  it("refuses calldata that does not decode", async () => {
    const g = new GuardedSender(new FakeSender(), { vault: VAULT, suffix });
    await expect(g.send({ to: VAULT, data: "0xdeadbeef", idempotencyKey: "k" })).rejects.toThrow(/does not decode/);
  });
});
