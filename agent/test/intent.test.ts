import { encodePacked, keccak256, toBytes, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";
import { addressOf, BASKET, USDC } from "../src/addresses.js";
import { readVaultState } from "../src/chain/state.js";
import { buildIntent, intentId, rationaleHash, sourcesOf, type Proposal } from "../src/intent.js";
import { encodeBlob, GENESIS } from "../src/rationale/blob.js";
import { CREDIT, FEEDS, POOL, PRICES, VAULT, standardScene } from "./fakes/fakeChain.js";

const PAYEE = "0x3333333333333333333333333333333333333333" as const;
const C = "0123456789abcdef0123456789abcdef01234567";
const J = "0x892d2dce569c783139f62dec297729642d35ff7e88bccd9d21dcb2defe2b84ff" as const;
const ctx = { runId: "run-1", index: 0, expensePayee: PAYEE, blob: { c: C, j: J, m: "claude-sonnet-5-5" } };
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
      rationaleHash: keccak256(toBytes(r.blob.blob)),
    });
    expect(r.clamped).toBe(false);
  });

  it("hashes the maat:v1 blob, not the rationale: block, commit, journal head, model, run, sources and text", () => {
    const r = buildIntent(p({}), state, ctx);
    if (!r.ok) throw new Error(r.error);
    expect(r.blob.fields).toEqual({ b: 100, c: C, j: J, m: "claude-sonnet-5-5", r: "run-1", s: sourcesOf(state), t: "buy the dip" });
    expect(r.intent.rationaleHash).toBe(r.blob.hash);
    expect(r.intent.rationaleHash).not.toBe(rationaleHash("buy the dip"));
    // What the closed-market rebuild starts from: the same input gives the same blob.
    expect(encodeBlob(r.blobInput)).toEqual(r.blob);
    expect(r.blobInput).toMatchObject({ text: "buy the dip", b: 100, r: "run-1" });
  });

  it("writes a compute bill's blob with k = bill and no model", () => {
    const text = "Compute bill: $0.420000 of Claude API usage unpaid as of UTC day 20763";
    const r = buildIntent(p({ action: "PAY_EXPENSE", symbol: "USDC", amountUsd: 0.42, rationale: text }), state, { ...ctx, blob: { c: C, j: GENESIS, k: "bill" } });
    if (!r.ok) throw new Error(r.error);
    expect(r.blob.fields).toMatchObject({ k: "bill", j: GENESIS, t: text });
    expect(r.blob.fields).not.toHaveProperty("m");
  });

  it("refuses an intent whose blob would break a rule, naming the rule", () => {
    expect(buildIntent(p({}), state, { ...ctx, blob: { c: C, j: J, m: "us.anthropic.claude-sonnet-5-5" } })).toMatchObject({ ok: false, error: expect.stringMatching(/^blob: m is not a model id/) });
    expect(buildIntent(p({}), state, { ...ctx, runId: "run 1" })).toMatchObject({ ok: false, error: expect.stringMatching(/^blob: r is not a run id/) });
    expect(buildIntent(p({}), state, { ...ctx, blob: { c: "dirty", j: J, m: "x" } })).toMatchObject({ ok: false, error: expect.stringMatching(/^blob: c is not/) });
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

  it("flags clamped for stock actions only when the cap lowered the amount", () => {
    const sell = buildIntent(p({ action: "SELL", amountUsd: 10 }), state, ctx);
    expect(sell.ok && sell.clamped).toBe(false);
    const sellAll = buildIntent(p({ action: "SELL", amountUsd: 999 }), state, ctx);
    expect(sellAll.ok && sellAll.clamped).toBe(true);
    const wd = buildIntent(p({ action: "WITHDRAW_COLLATERAL", amountUsd: 5 }), state, ctx);
    expect(wd.ok && wd.clamped).toBe(false);
    const wdAll = buildIntent(p({ action: "WITHDRAW_COLLATERAL", amountUsd: 999 }), state, ctx);
    expect(wdAll.ok && wdAll.clamped).toBe(true);
  });

  it("gives every index of a run its own id", () => {
    expect(intentId("run-1", 0)).not.toBe(intentId("run-1", 1));
    expect(intentId("run-1", 0)).not.toBe(intentId("run-2", 0));
    expect(rationaleHash("a")).toBe(keccak256(toBytes("a")));
  });
});

describe("sourcesOf: the blob's s, one entry per vault token in tokens() order", async () => {
  // Tick 0 prices every stock at $100 (see state.test.ts); the feeds say $186.67, $280 and $270.
  const scene = () => standardScene().set(POOL, "observe", () => [[0n, 0n], [0n, 0n]]).set(POOL, "token0", USDC);

  it("names each token, its round, its updatedAt and the signed premium of its pool over its feed", async () => {
    const s = await readVaultState(scene().client(), VAULT);
    const premium = (answer: bigint) => -Number(((answer - 10_000_000_000n) * 10_000n) / answer);
    expect(sourcesOf(s)).toEqual([
      ["NVDAc", "1", 1_794_000_000 - 30, premium(PRICES[0]!)],
      ["GOOGLc", "1", 1_794_000_000 - 30, premium(PRICES[1]!)],
      ["AAPLc", "1", 1_794_000_000 - 30, premium(PRICES[2]!)],
    ]);
    expect(sourcesOf(s)[0]![3]).toBe(-4643);
  });

  it("falls back to the lowercase address, and to null for a failed read or a price the vault would refuse", async () => {
    const odd = "0xb2000000000000000000000000000000000000aa" as const;
    const f = scene()
      .set(VAULT, "tokens", [...BASKET.map((t) => t.address), odd])
      .set(VAULT, "tokenConfig", ([token]) => [true, FEEDS[Math.max(0, BASKET.findIndex((t) => t.address.toLowerCase() === String(token).toLowerCase()))], POOL, 4000])
      .set(odd, "balanceOf", 0n)
      .set(odd, "decimals", 8)
      .set(odd, "uiMultiplier", 10n ** 18n)
      .set(FEEDS[1]!, "latestRoundData", [7n, 0n, 0n, 1_793_999_000n, 7n])
      .fail(FEEDS[2]!, "latestRoundData");
    const s = await readVaultState(f.client(), VAULT);
    const src = sourcesOf(s);
    expect(src[1]).toEqual(["GOOGLc", "7", 1_793_999_000, null]);
    expect(src[2]).toEqual(["AAPLc", null, null, null]);
    expect(src[3]![0]).toBe(odd.toLowerCase());
  });
});
