import { Attribution } from "ox/erc8021";
import { concat, decodeFunctionData, encodeFunctionData, keccak256, size, toBytes, toHex, type WalletClient } from "viem";
import { describe, expect, it } from "vitest";
import { mandateVaultAbi } from "../src/abi/index.js";
import { builderSuffix, codesIn } from "../src/exec/builderCode.js";
import { MAX_GAS, encodeExecute, encodeSyncMultiplier } from "../src/exec/calls.js";
import { GuardedSender, RpcSender, SendRefused, type TxRequest } from "../src/exec/sender.js";
import { BLOB_PREFIX, encodeBlob, GENESIS, MAX_BLOB_BYTES } from "../src/rationale/blob.js";
import { decodeExecuteInput } from "../src/rationale/calldata.js";
import type { OnchainIntent } from "../src/types.js";
import { FakeSender } from "./fakes/fakeSender.js";

const VAULT = "0x1111111111111111111111111111111111111111" as const;
const CODE = "bc_maattest";
const suffix = builderSuffix(CODE);
const G = 2_500_000n;
const { blob } = encodeBlob({ b: 100, c: "0123456789abcdef0123456789abcdef01234567", j: GENESIS, m: "fixed", r: "run-1", s: [["NVDAc", "1", 1_794_000_000, 3]], text: "underweight" });
const withHash = (h: `0x${string}`): OnchainIntent => ({
  id: `0x${"11".repeat(32)}`,
  action: 0,
  token: "0xb20000000000000000000078ee7ce2fE4908108C",
  amount: 20_000_000n,
  minOut: 0n,
  payee: "0x0000000000000000000000000000000000000000",
  rationaleHash: h,
});
const intent = withHash(keccak256(toBytes(blob)));
const execute: TxRequest = { to: VAULT, data: encodeExecute(intent), blob, idempotencyKey: "k1", gas: G };

describe("GuardedSender", () => {
  it("sends execute ‖ blob ‖ Builder Code, and syncMultiplier ‖ Builder Code", async () => {
    const inner = new FakeSender();
    const g = new GuardedSender(inner, { vault: VAULT, suffix });
    await g.send(execute);
    await g.send({ to: VAULT, data: encodeSyncMultiplier(intent.token), idempotencyKey: "k2", gas: G });
    expect(inner.sent[0]?.data).toBe(concat([encodeExecute(intent), toHex(blob), suffix]));
    expect(inner.sent[1]?.data).toBe(concat([encodeSyncMultiplier(intent.token), suffix]));
    expect(inner.sent.map((t) => codesIn(t.data))).toEqual([[CODE], [CODE]]);
    expect(inner.sent.map((t) => t.idempotencyKey)).toEqual(["k1", "k2"]);
    expect(inner.sent[0]).not.toHaveProperty("blob");
    expect(g.address).toBe(inner.address);
  });

  it("gives the full calldata it would send, for the gas estimate", async () => {
    const inner = new FakeSender();
    const g = new GuardedSender(inner, { vault: VAULT, suffix });
    const full = g.calldata(execute);
    await g.send(execute);
    expect(full).toBe(inner.sent[0]?.data);
    expect(size(full)).toBe(228 + toBytes(blob).length + size(suffix));
  });

  it("leaves the Builder Code readable and the execute call decodable with the blob in place", async () => {
    const inner = new FakeSender();
    await new GuardedSender(inner, { vault: VAULT, suffix }).send(execute);
    const data = inner.sent[0]!.data;
    expect(Attribution.fromData(data)).toMatchObject({ codes: [CODE] });
    expect(decodeFunctionData({ abi: mandateVaultAbi, data })).toMatchObject({ functionName: "execute", args: [intent] });
    expect(decodeExecuteInput(data)).toMatchObject({ status: "v1", blob, hashTick: true, codes: [CODE] });
  });

  it("compares the vault address case-insensitively", async () => {
    const inner = new FakeSender();
    const checksummed = "0xABcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD" as const;
    await new GuardedSender(inner, { vault: checksummed, suffix }).send({ ...execute, to: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" });
    expect(inner.sent).toHaveLength(1);
  });

  it("refuses another target", async () => {
    const g = new GuardedSender(new FakeSender(), { vault: VAULT, suffix });
    await expect(g.send({ ...execute, to: "0x9999999999999999999999999999999999999999" })).rejects.toBeInstanceOf(SendRefused);
  });

  it("refuses owner functions", async () => {
    const g = new GuardedSender(new FakeSender(), { vault: VAULT, suffix });
    const data = encodeFunctionData({ abi: mandateVaultAbi, functionName: "withdraw", args: [intent.token, 1n] });
    await expect(g.send({ to: VAULT, data, idempotencyKey: "k", gas: G })).rejects.toThrow(/function withdraw is not allowed/);
  });

  it("refuses calldata that does not decode, or carries bytes after the call", async () => {
    const g = new GuardedSender(new FakeSender(), { vault: VAULT, suffix });
    await expect(g.send({ to: VAULT, data: "0xdeadbeef", idempotencyKey: "k", gas: G })).rejects.toThrow(/does not decode/);
    await expect(g.send({ ...execute, data: concat([encodeExecute(intent), "0x00"]) })).rejects.toThrow(/bytes after the call/);
    await expect(g.send({ to: VAULT, data: concat([encodeSyncMultiplier(intent.token), toHex(blob)]), idempotencyKey: "k", gas: G })).rejects.toThrow(/bytes after the call/);
  });

  it("refuses an execute without a blob, and a blob on any other call", async () => {
    const g = new GuardedSender(new FakeSender(), { vault: VAULT, suffix });
    const { blob: _none, ...bare } = execute;
    await expect(g.send(bare)).rejects.toThrow(/execute needs a maat:v1 blob/);
    await expect(g.send({ to: VAULT, data: encodeSyncMultiplier(intent.token), blob, idempotencyKey: "k", gas: G })).rejects.toThrow(/only execute carries a blob/);
  });

  it("refuses a blob without the prefix, over 1,024 bytes, outside printable ASCII or not canonical", async () => {
    const g = new GuardedSender(new FakeSender(), { vault: VAULT, suffix });
    const sendBlob = (b: string) => g.send({ ...execute, data: encodeExecute(withHash(keccak256(toBytes(b)))), blob: b });
    await expect(sendBlob(blob.replace(BLOB_PREFIX, "maat:v2:"))).rejects.toThrow(/does not start with maat:v1:/);
    await expect(sendBlob(`${blob.slice(0, -2)}${"x".repeat(MAX_BLOB_BYTES)}"}`)).rejects.toThrow(/more than 1024 bytes/);
    await expect(sendBlob(blob.replace("underweight", "underéweight"))).rejects.toThrow(/printable ASCII/);
    await expect(sendBlob(blob.replace("underweight", "under\nweight"))).rejects.toThrow(/printable ASCII/);
    await expect(sendBlob(blob.replace('"b":100,', '"b":100, '))).rejects.toThrow(/not a valid maat:v1 blob: .*canonical/);
  });

  it("refuses a blob whose keccak256 is not the intent's rationaleHash", async () => {
    const g = new GuardedSender(new FakeSender(), { vault: VAULT, suffix });
    await expect(g.send({ ...execute, data: encodeExecute(withHash(`0x${"22".repeat(32)}`)) })).rejects.toThrow(/rationaleHash/);
    expect(() => g.calldata({ ...execute, data: encodeExecute(withHash(`0x${"22".repeat(32)}`)) })).toThrow(SendRefused);
  });

  it("forwards the gas limit", async () => {
    const inner = new FakeSender();
    await new GuardedSender(inner, { vault: VAULT, suffix }).send(execute);
    expect(inner.sent[0]?.gas).toBe(G);
  });

  it("refuses a missing, zero or over-cap gas limit", async () => {
    const inner = new FakeSender();
    const g = new GuardedSender(inner, { vault: VAULT, suffix });
    const { gas: _gas, ...base } = execute;
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
