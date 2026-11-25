// @vitest-environment node
import { getAddress, keccak256, toBytes, zeroAddress, zeroHash, type Address } from "viem";
import { describe, expect, it } from "vitest";
import { ACTIONS } from "@/content/decisions";
import type { LedgerClient } from "@/lib/chain/load";
import { amountUnit, parseAmount, PREVIEW_ID, previewIntent, previewIntentArgs, previewTokens, tokenDecimals, vaultPayees } from "@/lib/chain/preview";

const VAULT: Address = "0x00000000000000000000000000000000000Aa001";
const NVDAC: Address = "0xb20000000000000000000078ee7ce2fE4908108C";
const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/** A client whose previewIntent answers `reason` at block `head`, recording each call. */
function fakeClient(reason: number | Error, head = 61_000_000n) {
  const calls: { functionName: string; args?: readonly unknown[]; blockNumber?: bigint; address: Address }[] = [];
  const client = {
    getBlockNumber: async () => head,
    readContract: async (c: { functionName: string; args?: readonly unknown[]; blockNumber?: bigint; address: Address }) => {
      calls.push(c);
      if (c.functionName === "decimals") return 18;
      if (c.functionName !== "previewIntent") throw new Error(`unexpected ${c.functionName}`);
      if (reason instanceof Error) throw reason;
      return reason;
    },
  } as unknown as LedgerClient;
  return { client, calls };
}

describe("the preview's inputs", () => {
  it("offers the basket, then USDC, with the addresses of content/generated/base-addresses.json", () => {
    expect(previewTokens()).toEqual([
      { symbol: "NVDAc", address: NVDAC },
      { symbol: "GOOGLc", address: "0xb2000000000000000000002D0BA3164cc74f58B7" },
      { symbol: "AAPLc", address: "0xb200000000000000000000C2e324d24d7eEcd1fb" },
      { symbol: "USDC", address: USDC },
    ]);
  });

  it("takes USDC for BUY, BORROW, REPAY and PAY_EXPENSE, and token units for the rest (contracts/src/Types.sol, Intent)", () => {
    expect(ACTIONS.map((a) => [a, amountUnit(a)])).toEqual([
      ["BUY", "usdc"],
      ["SELL", "token"],
      ["SUPPLY", "token"],
      ["WITHDRAW_COLLATERAL", "token"],
      ["BORROW", "usdc"],
      ["REPAY", "usdc"],
      ["PAY_EXPENSE", "usdc"],
    ]);
  });

  it("parses a decimal amount into units, and refuses anything else", () => {
    expect(parseAmount("50", 6)).toBe(50_000_000n);
    expect(parseAmount(" 12.5 ", 6)).toBe(12_500_000n);
    expect(parseAmount("0.000001", 6)).toBe(1n);
    expect(parseAmount("1.5", 18)).toBe(1_500_000_000_000_000_000n);
    for (const bad of ["", "abc", "-1", "1e3", "0.0000001", "1,000", "0x10"]) expect(parseAmount(bad, 6), bad).toBeNull();
  });

  it("puts the payee in the Intent when one is given, as PAY_EXPENSE needs (MandateVault._checkExpense)", () => {
    const payee: Address = "0x00000000000000000000000000000000000000A1";
    expect(previewIntentArgs({ action: "PAY_EXPENSE", token: USDC, amount: 7n, payee }).payee).toBe(payee);
  });

  it("builds the Intent previewIntent takes: a fixed id, no minOut, no payee and a zero rationale hash", () => {
    expect(PREVIEW_ID).toBe(keccak256(toBytes("maat:ask:preview")));
    expect(previewIntentArgs({ action: "SELL", token: NVDAC, amount: 7n })).toEqual({
      id: PREVIEW_ID,
      action: 1,
      token: NVDAC,
      amount: 7n,
      minOut: 0n,
      payee: zeroAddress,
      rationaleHash: zeroHash,
    });
  });
});

describe("previewIntent", () => {
  it("asks the vault at the head block and gives the typed reason", async () => {
    const { client, calls } = fakeClient(6);
    expect(await previewIntent(client, VAULT, { action: "BUY", token: NVDAC, amount: 50_000_000n })).toEqual({ reason: "MARKET_CLOSED", blockNumber: 61_000_000n });
    expect(calls).toEqual([
      expect.objectContaining({ address: VAULT, functionName: "previewIntent", blockNumber: 61_000_000n, args: [previewIntentArgs({ action: "BUY", token: NVDAC, amount: 50_000_000n })] }),
    ]);
  });

  it("reads 0 as OK and the last enum member as DERISK_WINDOW", async () => {
    expect((await previewIntent(fakeClient(0).client, VAULT, { action: "BUY", token: NVDAC, amount: 1n })).reason).toBe("OK");
    expect((await previewIntent(fakeClient(19).client, VAULT, { action: "BORROW", token: USDC, amount: 1n })).reason).toBe("DERISK_WINDOW");
  });

  it("throws on a number the Reason enum does not have, and passes an RPC error on", async () => {
    await expect(previewIntent(fakeClient(20).client, VAULT, { action: "BUY", token: NVDAC, amount: 1n })).rejects.toThrow(/20 is not a Reason/);
    await expect(previewIntent(fakeClient(new Error("HTTP 429")).client, VAULT, { action: "BUY", token: NVDAC, amount: 1n })).rejects.toThrow("HTTP 429");
  });
});

describe("vaultPayees", () => {
  it("reads the vault's payees(), checksummed", async () => {
    const client = {
      readContract: async (c: { functionName: string; address: Address }) => {
        expect(c).toMatchObject({ functionName: "payees", address: VAULT });
        return ["0x00000000000000000000000000000000000000a1"];
      },
    } as unknown as LedgerClient;
    expect(await vaultPayees(client, VAULT)).toEqual([getAddress("0x00000000000000000000000000000000000000a1")]);
  });
});

describe("tokenDecimals", () => {
  it("is 6 for USDC without a call, and the token's decimals() otherwise", async () => {
    const { client, calls } = fakeClient(0);
    expect(await tokenDecimals(client, USDC)).toBe(6);
    expect(calls).toEqual([]);
    expect(await tokenDecimals(client, NVDAC)).toBe(18);
    expect(calls.map((c) => c.functionName)).toEqual(["decimals"]);
  });
});
