import { encodeFunctionData, type WalletClient } from "viem";
import { describe, expect, it } from "vitest";
import { mandateVaultAbi } from "../src/abi/index.js";
import { builderSuffix, codesIn } from "../src/exec/builderCode.js";
import { MAX_GAS, encodeExecute, encodeSyncMultiplier } from "../src/exec/calls.js";
import { GuardedSender, RpcSender, SendRefused, type TxRequest } from "../src/exec/sender.js";
import type { OnchainIntent } from "../src/types.js";
import { FakeSender } from "./fakes/fakeSender.js";

const VAULT = "0x1111111111111111111111111111111111111111" as const;
const suffix = builderSuffix("bc_maattest");
const G = 2_500_000n;
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
    await g.send({ to: VAULT, data: encodeExecute(intent), idempotencyKey: "k1", gas: G });
    await g.send({ to: VAULT, data: encodeSyncMultiplier(intent.token), idempotencyKey: "k2", gas: G });
    expect(inner.sent.map((t) => codesIn(t.data))).toEqual([["bc_maattest"], ["bc_maattest"]]);
    expect(inner.sent.map((t) => t.idempotencyKey)).toEqual(["k1", "k2"]);
    expect(g.address).toBe(inner.address);
  });

  it("compares the vault address case-insensitively", async () => {
    const inner = new FakeSender();
    const checksummed = "0xABcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD" as const;
    await new GuardedSender(inner, { vault: checksummed, suffix }).send({ to: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd", data: encodeExecute(intent), idempotencyKey: "k", gas: G });
    expect(inner.sent).toHaveLength(1);
  });

  it("refuses another target", async () => {
    const g = new GuardedSender(new FakeSender(), { vault: VAULT, suffix });
    await expect(g.send({ to: "0x9999999999999999999999999999999999999999", data: encodeExecute(intent), idempotencyKey: "k", gas: G })).rejects.toBeInstanceOf(SendRefused);
  });

  it("refuses owner functions", async () => {
    const g = new GuardedSender(new FakeSender(), { vault: VAULT, suffix });
    const data = encodeFunctionData({ abi: mandateVaultAbi, functionName: "withdraw", args: [intent.token, 1n] });
    await expect(g.send({ to: VAULT, data, idempotencyKey: "k", gas: G })).rejects.toThrow(/function withdraw is not allowed/);
  });

  it("refuses calldata that does not decode", async () => {
    const g = new GuardedSender(new FakeSender(), { vault: VAULT, suffix });
    await expect(g.send({ to: VAULT, data: "0xdeadbeef", idempotencyKey: "k", gas: G })).rejects.toThrow(/does not decode/);
  });

  it("forwards the gas limit", async () => {
    const inner = new FakeSender();
    await new GuardedSender(inner, { vault: VAULT, suffix }).send({ to: VAULT, data: encodeExecute(intent), idempotencyKey: "k", gas: G });
    expect(inner.sent[0]?.gas).toBe(G);
  });

  it("refuses a missing, zero or over-cap gas limit", async () => {
    const inner = new FakeSender();
    const g = new GuardedSender(inner, { vault: VAULT, suffix });
    const base = { to: VAULT, data: encodeExecute(intent), idempotencyKey: "k" };
    await expect(g.send(base as unknown as TxRequest)).rejects.toThrow(/gas limit is missing/);
    await expect(g.send({ ...base, gas: 0n })).rejects.toBeInstanceOf(SendRefused);
    await expect(g.send({ ...base, gas: MAX_GAS + 1n })).rejects.toThrow(/above the cap/);
    await g.send({ ...base, gas: MAX_GAS });
    expect(inner.sent).toHaveLength(1);
  });
});

describe("RpcSender", () => {
  it("forwards to, data, zero value and the gas limit", async () => {
    let seen: unknown;
    const wallet = { chain: undefined, sendTransaction: async (a: unknown) => ((seen = a), `0x${"ab".repeat(32)}`) } as unknown as WalletClient;
    await new RpcSender(wallet, "0x2222222222222222222222222222222222222222").send({ to: VAULT, data: "0x1234", idempotencyKey: "k", gas: G });
    expect(seen).toEqual({ account: "0x2222222222222222222222222222222222222222", chain: null, to: VAULT, data: "0x1234", value: 0n, gas: G });
  });
});
