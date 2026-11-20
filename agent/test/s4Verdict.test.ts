import type { FacilitatorClient } from "@x402/core/server";
import { wrapFetchWithPayment } from "@x402/fetch";
import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, erc20Abi, type Address, type Hex } from "viem";
import { judgePaidResponse, usdcPaidTo } from "../scripts/s4-verdict.js";
import { USDC } from "../src/addresses.js";
import { createGuardApp, type GuardClient } from "../src/guard/app.js";
import { EXECUTOR, VAULT as VAULT_ADDR, marketScene } from "./fakes/fakeChain.js";
import { FakeFacilitator, fakeBuyer } from "./fakes/fakeFacilitator.js";

const VAULT: Address = "0x1111111111111111111111111111111111111111";
const OTHER: Address = "0x2222222222222222222222222222222222222222";
const BUYER: Address = "0x9999999999999999999999999999999999999999";
const OTHER_TOKEN: Address = "0x3333333333333333333333333333333333333333";

/** A hand-built ERC-20 Transfer log, as a settlement receipt would carry it. */
function transfer(token: Address, to: Address, value: bigint, from: Address = BUYER) {
  return {
    address: token.toLowerCase() as Address,
    topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from, to } }) as Hex[],
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
  };
}

describe("usdcPaidTo", () => {
  it("returns the amount of a USDC transfer to the vault", () => {
    expect(usdcPaidTo({ logs: [transfer(USDC, VAULT, 10_000n)] }, USDC, VAULT)).toBe(10_000n);
  });

  it("returns 0 for a transfer of the same amount to another address", () => {
    expect(usdcPaidTo({ logs: [transfer(USDC, OTHER, 10_000n)] }, USDC, VAULT)).toBe(0n);
  });

  it("returns 0 for a Transfer from a different token contract to the vault", () => {
    expect(usdcPaidTo({ logs: [transfer(OTHER_TOKEN, VAULT, 10_000n)] }, USDC, VAULT)).toBe(0n);
  });

  it("sums two USDC transfers to the vault", () => {
    const logs = [transfer(USDC, VAULT, 10_000n), transfer(USDC, OTHER, 777n), transfer(USDC, VAULT, 2_500n)];
    expect(usdcPaidTo({ logs }, USDC, VAULT)).toBe(12_500n);
  });

  it("returns 0 for a receipt with no logs", () => {
    expect(usdcPaidTo({ logs: [] }, USDC, VAULT)).toBe(0n);
  });

  it("ignores logs that are not Transfer events", () => {
    const approval = {
      address: USDC.toLowerCase() as Address,
      topics: encodeEventTopics({ abi: erc20Abi, eventName: "Approval", args: { owner: BUYER, spender: VAULT } }) as Hex[],
      data: encodeAbiParameters([{ type: "uint256" }], [10_000n]),
    };
    expect(usdcPaidTo({ logs: [approval] }, USDC, VAULT)).toBe(0n);
  });

  it("matches addresses in any case", () => {
    const log = transfer(USDC, VAULT, 10_000n);
    expect(usdcPaidTo({ logs: [log] }, USDC.toUpperCase().replace("0X", "0x") as Address, VAULT.toLowerCase() as Address)).toBe(10_000n);
  });
});

// What the guard really sends back when the facilitator refuses: built with the real x402 middleware and a facilitator
// that says no, so the verdicts below are the ones the owner's S4 run would see.
class RefusingFacilitator implements FacilitatorClient {
  private readonly ok = new FakeFacilitator();
  onVerify: FacilitatorClient["verify"] | undefined;
  onSettle: FacilitatorClient["settle"] | undefined;
  settleCalls = 0;
  getSupported = () => this.ok.getSupported();
  async verify(p: Parameters<FacilitatorClient["verify"]>[0], r: Parameters<FacilitatorClient["verify"]>[1]) {
    return this.onVerify ? this.onVerify(p, r) : this.ok.verify(p, r);
  }
  async settle(p: Parameters<FacilitatorClient["settle"]>[0], r: Parameters<FacilitatorClient["settle"]>[1]) {
    this.settleCalls++;
    return this.onSettle ? this.onSettle(p, r) : this.ok.settle(p, r);
  }
}

async function paidResponse(f: RefusingFacilitator) {
  const chain = marketScene();
  const app = createGuardApp({
    client: chain.client() as unknown as GuardClient,
    vault: VAULT_ADDR,
    executor: EXECUTOR,
    payTo: VAULT_ADDR,
    facilitator: f,
    rateLimitPerMinute: 60,
    corsOrigins: [],
    fetchFn: async () => new Response(JSON.stringify({ tokens: [] }), { status: 200 }),
  });
  const appFetch = (async (input: RequestInfo | URL, init?: RequestInit) => app.fetch(new Request(input, init))) as typeof fetch;
  const res = await wrapFetchWithPayment(appFetch, fakeBuyer())("http://guard.test/check?token=NVDAc&side=BUY&sizeUSD=100");
  return { status: res.status, paymentRequired: res.headers.get("payment-required"), paymentResponse: res.headers.get("payment-response") };
}

describe("judgePaidResponse", () => {
  it("returns the settlement tx when the payment settled", async () => {
    const out = judgePaidResponse(await paidResponse(new RefusingFacilitator()));
    expect(out).toEqual({ settlementTx: `0x${"ab".repeat(32)}` });
  });

  it("names the reason when the facilitator refuses to verify", async () => {
    const f = new RefusingFacilitator();
    f.onVerify = async () => ({ isValid: false, invalidReason: "invalid_exact_evm_payload_signature" });
    const r = await paidResponse(f);
    expect(r.status).toBe(402);
    expect(r.paymentResponse).toBeNull();
    expect(judgePaidResponse(r)).toEqual({ fail: "S4 FAIL (facilitator refused): invalid_exact_evm_payload_signature" });
    expect(f.settleCalls).toBe(0);
  });

  it("names the reason when verify throws", async () => {
    const f = new RefusingFacilitator();
    f.onVerify = async () => {
      throw new Error("payTo is a contract");
    };
    const out = judgePaidResponse(await paidResponse(f));
    expect(out).toEqual({ fail: expect.stringMatching(/^S4 FAIL \(facilitator refused\): .*payTo is a contract/) });
  });

  it("names the reason when the settlement fails", async () => {
    const f = new RefusingFacilitator();
    f.onSettle = async (_p, r) => ({ success: false, errorReason: "insufficient_funds", transaction: "", network: r.network });
    const r = await paidResponse(f);
    expect(r.status).toBe(402);
    expect(r.paymentRequired).toBeNull();
    expect(judgePaidResponse(r)).toEqual({ fail: "S4 FAIL (facilitator refused): insufficient_funds" });
  });

  it("names the reason when the settlement throws", async () => {
    const f = new RefusingFacilitator();
    f.onSettle = async () => {
      throw new Error("facilitator offline");
    };
    const out = judgePaidResponse(await paidResponse(f));
    expect(out).toEqual({ fail: expect.stringMatching(/^S4 FAIL \(facilitator refused\): .*facilitator offline/) });
  });

  it("fails with 'no settlement' when neither header is present", () => {
    expect(judgePaidResponse({ status: 502, paymentRequired: null, paymentResponse: null })).toEqual({ fail: "S4 FAIL (no settlement): status 502" });
    expect(judgePaidResponse({ status: 402, paymentRequired: null, paymentResponse: null })).toEqual({ fail: "S4 FAIL (no settlement): status 402" });
  });
});
