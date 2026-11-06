import type { CdpClient } from "@coinbase/cdp-sdk";
import { describe, expect, it } from "vitest";
import { CdpSender, uuidFromKey, type CdpLike } from "../src/exec/cdpSender.js";

const EXEC = "0x2222222222222222222222222222222222222222" as const;
const VAULT = "0x1111111111111111111111111111111111111111" as const;

function fakeCdp(address: string = EXEC) {
  const sent: unknown[] = [];
  const cdp: CdpLike = {
    evm: {
      getAccount: async ({ name }) => {
        if (name !== "maat-executor") throw new Error("account not found");
        return { address: address as `0x${string}` };
      },
      sendTransaction: async (o) => (sent.push(o), { transactionHash: `0x${"ab".repeat(32)}` }),
    },
  };
  return { cdp, sent };
}

// Compile-time: what CdpSender passes is a valid argument for the real SDK (viem TransactionRequestEIP1559, incl. gas).
type Ours = Parameters<CdpLike["evm"]["sendTransaction"]>[0];
type Theirs = Parameters<CdpClient["evm"]["sendTransaction"]>[0];
const fitsSdk: Ours extends Theirs ? true : false = true;

describe("CdpSender", () => {
  it("passes the SDK's own sendTransaction options type", () => {
    expect(fitsSdk).toBe(true);
  });
  it("connects to the named account and checks its address", async () => {
    const { cdp } = fakeCdp();
    const s = await CdpSender.connect({ accountName: "maat-executor", expectedAddress: EXEC, cdp });
    expect(s.address).toBe(EXEC);
  });
  it("refuses an account whose address is not MAAT_EXECUTOR", async () => {
    const { cdp } = fakeCdp("0x9999999999999999999999999999999999999999");
    await expect(CdpSender.connect({ accountName: "maat-executor", expectedAddress: EXEC, cdp })).rejects.toThrow(/does not match MAAT_EXECUTOR/);
  });
  it("never creates an account", async () => {
    const { cdp } = fakeCdp();
    await expect(CdpSender.connect({ accountName: "other", expectedAddress: EXEC, cdp })).rejects.toThrow(/account not found/);
  });
  it("sends on base with zero value, the gas limit and a stable idempotency key", async () => {
    const { cdp, sent } = fakeCdp();
    const s = await CdpSender.connect({ accountName: "maat-executor", expectedAddress: EXEC, cdp });
    const hash = await s.send({ to: VAULT, data: "0x1234", idempotencyKey: "intent-1", gas: 2_500_000n });
    expect(hash).toBe(`0x${"ab".repeat(32)}`);
    expect(sent[0]).toEqual({
      address: EXEC,
      network: "base",
      transaction: { to: VAULT, data: "0x1234", value: 0n, gas: 2_500_000n },
      idempotencyKey: uuidFromKey("intent-1"),
    });
  });
  it("formats keys as deterministic v4-shaped UUIDs", () => {
    const u = uuidFromKey("intent-1");
    expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidFromKey("intent-1")).toBe(u);
    expect(uuidFromKey("intent-2")).not.toBe(u);
  });
});
