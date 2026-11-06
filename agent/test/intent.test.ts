import { encodePacked, keccak256, toBytes, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";
import { addressOf, USDC } from "../src/addresses.js";
import { readVaultState } from "../src/chain/state.js";
import { buildIntent, intentId, rationaleHash, type Proposal } from "../src/intent.js";
import { CREDIT, VAULT, standardScene } from "./fakes/fakeChain.js";

const PAYEE = "0x3333333333333333333333333333333333333333" as const;
const ctx = { runId: "run-1", index: 0, expensePayee: PAYEE };
const p = (over: Partial<Proposal>): Proposal => ({ action: "BUY", symbol: "NVDAc", amountUsd: 20, rationale: "buy the dip", ...over });

describe("buildIntent", async () => {
  const scene = standardScene()
    .set(addressOf("NVDAc"), "balanceOf", 10_713_815n) // $20 of NVDAc in the wallet
    .set(CREDIT, "suppliedOf", (a) => (a[0] === addressOf("NVDAc") ? 5_000_000n : 0n))
    .set(CREDIT, "debt", 3_000_000n)
    .set(CREDIT, "healthFactor", 3n * 10n ** 18n);
  const state = await readVaultState(scene.client(), VAULT);

  it("builds a BUY in USDC units", () => {
    const r = buildIntent(p({}), state, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.intent).toEqual({
      id: keccak256(encodePacked(["string", "uint256"], ["run-1", 0n])),
      action: 0,
      token: addressOf("NVDAc"),
      amount: 20_000_000n,
      minOut: 0n,
      payee: zeroAddress,
      rationaleHash: keccak256(toBytes("buy the dip")),
    });
    expect(r.clamped).toBe(false);
  });

  it("clamps a BUY to the USDC balance", () => {
    const r = buildIntent(p({ amountUsd: 500 }), state, ctx);
    expect(r.ok && r.intent.amount).toBe(100_000_000n);
    expect(r.ok && r.clamped).toBe(true);
  });

  it("converts a SELL to raw units and clamps to the wallet balance", () => {
    const r = buildIntent(p({ action: "SELL", amountUsd: 10 }), state, ctx);
    expect(r.ok && r.intent.amount).toBe(5_356_907n); // rawForUsd6(10e6, 18667486580, 8)
    const all = buildIntent(p({ action: "SELL", amountUsd: 999 }), state, ctx);
    expect(all.ok && all.intent.amount).toBe(10_713_815n);
  });

  it("clamps WITHDRAW_COLLATERAL to the supplied amount", () => {
    const r = buildIntent(p({ action: "WITHDRAW_COLLATERAL", amountUsd: 999 }), state, ctx);
    expect(r.ok && r.intent.amount).toBe(5_000_000n);
  });

  it("clamps REPAY to the debt", () => {
    const r = buildIntent(p({ action: "REPAY", symbol: "USDC", amountUsd: 50 }), state, ctx);
    expect(r.ok && r.intent).toMatchObject({ action: 5, token: USDC, amount: 3_000_000n });
  });

  it("sets the payee only for PAY_EXPENSE", () => {
    const r = buildIntent(p({ action: "PAY_EXPENSE", symbol: "USDC", amountUsd: 0.42 }), state, ctx);
    expect(r.ok && r.intent).toMatchObject({ action: 6, token: USDC, amount: 420_000n, payee: PAYEE });
  });

  it("rejects a symbol that does not fit the action", () => {
    expect(buildIntent(p({ action: "BORROW", symbol: "NVDAc" }), state, ctx)).toMatchObject({ ok: false, error: "symbol NVDAc does not fit BORROW" });
    expect(buildIntent(p({ action: "BUY", symbol: "USDC" }), state, ctx)).toMatchObject({ ok: false, error: "symbol USDC does not fit BUY" });
  });

  it("rejects a stock action without a price", async () => {
    const s2 = await readVaultState(standardScene().fail(state.tokens[0]!.config.feed, "latestRoundData").client(), VAULT);
    expect(buildIntent(p({ action: "SELL" }), s2, ctx)).toMatchObject({ ok: false, error: "no price for NVDAc" });
  });

  it("rejects an amount that rounds to zero", () => {
    expect(buildIntent(p({ amountUsd: 0.0000001 }), state, ctx)).toMatchObject({ ok: false, error: "amount rounds to zero" });
  });

  it("gives every index of a run its own id", () => {
    expect(intentId("run-1", 0)).not.toBe(intentId("run-1", 1));
    expect(intentId("run-1", 0)).not.toBe(intentId("run-2", 0));
    expect(rationaleHash("a")).toBe(keccak256(toBytes("a")));
  });
});
