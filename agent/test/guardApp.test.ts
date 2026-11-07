import { decodePaymentResponseHeader, wrapFetchWithPayment } from "@x402/fetch";
import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { BASKET, USDC } from "../src/addresses.js";
import { createGuardApp, type GuardClient } from "../src/guard/app.js";
import type { FetchLike } from "../src/guard/coinbase.js";
import { EXECUTOR, FEEDS, VAULT, marketScene, type FakeChain } from "./fakes/fakeChain.js";
import { FakeFacilitator, fakeBuyer } from "./fakes/fakeFacilitator.js";

const NVDA = BASKET[0]!.address;
const NAV_ROW = { contract_address: NVDA.toLowerCase(), symbol: "NVDAc", multiplier: 1.0005, nav_price: 200.1, nav_price_updated_at: "2026-11-06T21:39:16Z" };
const coinbaseUp: FetchLike = async () => new Response(JSON.stringify({ tokens: [NAV_ROW] }), { status: 200 });
const coinbaseDown: FetchLike = async () => new Response("down", { status: 503 });

function setup(opts: { chain?: FakeChain; reason?: number; fetchFn?: FetchLike; perMinute?: number; builderCode?: string } = {}) {
  const chain = opts.chain ?? marketScene();
  const reads: { account: unknown; blockNumber: unknown; args: unknown }[] = [];
  const client = {
    ...chain.client(),
    readContract: async (p: { account: unknown; blockNumber: unknown; args: unknown }) => {
      reads.push(p);
      if (opts.reason === undefined) throw new Error("execution reverted");
      return opts.reason;
    },
  } as unknown as GuardClient;
  const facilitator = new FakeFacilitator();
  const app = createGuardApp({
    client,
    vault: VAULT,
    executor: EXECUTOR,
    payTo: VAULT,
    facilitator,
    rateLimitPerMinute: opts.perMinute ?? 60,
    corsOrigins: ["https://maatonbase.xyz"],
    fetchFn: opts.fetchFn ?? coinbaseUp,
    ...(opts.builderCode ? { builderCode: opts.builderCode } : {}),
  });
  const appFetch = (async (input: RequestInfo | URL, init?: RequestInit) => app.fetch(new Request(input, init))) as typeof fetch;
  const paidFetch = wrapFetchWithPayment(appFetch, fakeBuyer());
  return { app, chain, reads, facilitator, appFetch, paidFetch };
}

const url = (path: string) => `http://guard.test${path}`;

describe("guard app: free endpoints", () => {
  it("GET /health", async () => {
    const res = await setup().app.request("/health");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("GET /state/:token reads the chain and adds the Coinbase NAV", async () => {
    const res = await setup().app.request("/state/nvdac");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      symbol: "NVDAc",
      block: "100",
      marketStatus: "OPEN",
      sessionMode: "REGULAR",
      paused: false,
      chainlink: { price: "200.00363238", ageSeconds: "30" },
      dexTwap: { price: "200.00363238", tick: -6932, windowSeconds: 1800 },
      premiumBps: "0",
      multiplier: { pendingUpdate: false },
      pool: { stock: "50", usdc: "10000" },
      nav: { price: 200.1, multiplier: 1.0005 },
    });
  });

  it("still answers /state when Coinbase is down, with nav null", async () => {
    const res = await setup({ fetchFn: coinbaseDown }).app.request(`/state/${NVDA}`);
    expect(res.status).toBe(200);
    expect((await res.json()).nav).toBeNull();
  });

  it("404s a token outside the basket and 503s when the RPC is down", async () => {
    const { app } = setup();
    expect((await app.request(`/state/${USDC}`)).status).toBe(404);
    expect((await app.request("/state/TSLAc")).status).toBe(404);
    const down = setup({ chain: marketScene().fail(VAULT, "mandate") });
    const res = await down.app.request("/state/NVDAc");
    expect(res.status).toBe(503);
    expect((await res.json()).reason).toBe("UNKNOWN");
  });

  it("caches state for 15 seconds", async () => {
    const { app, chain } = setup();
    await app.request("/state/NVDAc");
    const n = chain.calls.length;
    await app.request("/state/NVDAc");
    expect(chain.calls.length).toBe(n);
  });

  it("POST /preview calls previewIntent as the executor, pinned to the latest block", async () => {
    const { app, reads } = setup({ reason: 0 });
    const res = await app.request("/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "BUY", token: NVDA, amount: "5000000" }),
    });
    expect(await res.json()).toEqual({ reason: "OK", allowed: true, block: "100" });
    expect(reads[0]?.account).toBe(EXECUTOR);
    expect(reads[0]?.blockNumber).toBe(100n);
    expect((reads[0]?.args as [{ action: number; amount: bigint }])[0]).toMatchObject({ action: 0, amount: 5_000_000n });
  });

  it("POST /preview names the refusal, rejects a bad body and 503s a failed eth_call", async () => {
    const refused = await setup({ reason: 6 }).app.request("/preview", {
      method: "POST",
      body: JSON.stringify({ action: "SELL", token: NVDA, amount: "1" }),
    });
    expect(await refused.json()).toMatchObject({ reason: "MARKET_CLOSED", allowed: false });
    const bad = await setup({ reason: 0 }).app.request("/preview", { method: "POST", body: JSON.stringify({ action: "BUY", token: NVDA, amount: "-1" }) });
    expect(bad.status).toBe(400);
    const notJson = await setup({ reason: 0 }).app.request("/preview", { method: "POST", body: "{" });
    expect(notJson.status).toBe(400);
    const down = await setup().app.request("/preview", { method: "POST", body: JSON.stringify({ action: "BUY", token: NVDA, amount: "1" }) });
    expect(down.status).toBe(503);
  });

  it("rate limits per client IP with Retry-After", async () => {
    const { app } = setup({ perMinute: 2 });
    const h = { "fly-client-ip": "203.0.113.7" };
    expect((await app.request("/state/NVDAc", { headers: h })).status).toBe(200);
    expect((await app.request("/state/NVDAc", { headers: h })).status).toBe(200);
    const limited = await app.request("/state/NVDAc", { headers: h });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect((await app.request("/state/NVDAc", { headers: { "fly-client-ip": "203.0.113.8" } })).status).toBe(200);
  });

  it("allows GET from the website origin (CORS)", async () => {
    const res = await setup().app.request("/state/NVDAc", { headers: { origin: "https://maatonbase.xyz" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://maatonbase.xyz");
  });
});

describe("guard app: paid GET /check", () => {
  const CHECK = "/check?token=NVDAc&side=buy&sizeUSD=1000";

  it("answers 402 with payTo = vault and 0.01 USDC on Base", async () => {
    const res = await setup().app.request(CHECK);
    expect(res.status).toBe(402);
    const header = res.headers.get("payment-required");
    expect(header).toBeTruthy();
    const required = JSON.parse(Buffer.from(header!, "base64").toString("utf8"));
    expect(required.x402Version).toBe(2);
    expect(required.accepts[0]).toMatchObject({
      scheme: "exact",
      network: "eip155:8453",
      amount: "10000",
      payTo: VAULT,
    });
    expect(getAddress(required.accepts[0].asset)).toBe(getAddress(USDC));
  });

  it("returns the verdict after payment and settles once to the vault", async () => {
    const { paidFetch, facilitator } = setup();
    const res = await paidFetch(url(CHECK));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ symbol: "NVDAc", side: "BUY", sizeUSD: "1000", reason: "OK", ok: true, premiumBps: "0", sizeShareBps: "999" }); // $1000 of 50 NVDAc at $200.0036
    expect(facilitator.settled).toHaveLength(1);
    expect(facilitator.settled[0]?.requirements).toMatchObject({ payTo: VAULT, amount: "10000" });
    expect(decodePaymentResponseHeader(res.headers.get("payment-response")!)).toMatchObject({ success: true });
  });

  it("returns a refusal reason as a paid 200: the verdict is the product", async () => {
    const chain = marketScene().set(FEEDS[0]!, "latestRoundData", [1n, 20_000_363_238n, 0n, 1_794_000_000n - 7200n, 1n]);
    const { paidFetch, facilitator } = setup({ chain });
    const res = await paidFetch(url(CHECK));
    expect((await res.json()).reason).toBe("FEED_STALE");
    expect(facilitator.settled).toHaveLength(1);
  });

  it("does not settle when the RPC is down (503 UNKNOWN)", async () => {
    const { paidFetch, facilitator } = setup({ chain: marketScene().fail(VAULT, "mandate") });
    const res = await paidFetch(url(CHECK));
    expect(res.status).toBe(503);
    expect((await res.json()).reason).toBe("UNKNOWN");
    expect(facilitator.verified).toHaveLength(1);
    expect(facilitator.settled).toHaveLength(0);
  });

  it("rejects bad queries before asking for payment", async () => {
    const { app, facilitator } = setup();
    for (const q of ["/check?token=NVDAc&side=HOLD&sizeUSD=1", "/check?token=NVDAc&side=BUY&sizeUSD=0", "/check?token=NVDAc&side=BUY", "/check?token=TSLAc&side=BUY&sizeUSD=1"]) {
      const res = await app.request(q);
      expect([400, 404]).toContain(res.status);
      expect(res.headers.get("payment-required")).toBeNull();
    }
    expect(facilitator.verified).toHaveLength(0);
  });

  it("declares the builder-code extension when a code is configured", async () => {
    const res = await setup({ builderCode: "bc_maat" }).app.request(CHECK);
    const required = JSON.parse(Buffer.from(res.headers.get("payment-required")!, "base64").toString("utf8"));
    expect(required.extensions["builder-code"].info).toMatchObject({ a: "bc_maat" });
  });
});
