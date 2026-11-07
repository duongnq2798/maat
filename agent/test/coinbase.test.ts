import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { CoinbaseUnavailable, fetchNavQuotes, type FetchLike } from "../src/guard/coinbase.js";

const NVDA = "0xb20000000000000000000078ee7ce2fE4908108C";
// Shape copied from a live response on 2026-11-06 (description and icon fields dropped).
const NVDA_ROW = {
  contract_address: NVDA.toLowerCase(),
  symbol: "NVDAc",
  name: "NVIDIA Corporation",
  decimals: 8,
  multiplier: 1.0005379395763694,
  nav_price: 187.96606001,
  nav_price_updated_at: "2026-11-06T21:39:16Z",
};

function pages(...bodies: unknown[]): { fetchFn: FetchLike; urls: string[] } {
  const urls: string[] = [];
  const fetchFn: FetchLike = async (url) => {
    urls.push(url);
    const body = bodies[urls.length - 1];
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetchFn, urls };
}

describe("fetchNavQuotes", () => {
  it("walks next_page_token and keys quotes by checksummed address", async () => {
    const { fetchFn, urls } = pages(
      { tokens: [{ contract_address: "0xb200000000000000000000000000000000000001", symbol: "BIRDc", multiplier: 1 }], next_page_token: "abc=" },
      { tokens: [NVDA_ROW] },
    );
    const q = await fetchNavQuotes(fetchFn, "https://x.test/v1/tokenized-stocks");
    expect(urls).toEqual(["https://x.test/v1/tokenized-stocks?page_size=500", "https://x.test/v1/tokenized-stocks?page_size=500&page_token=abc%3D"]);
    expect(q.get(NVDA)).toEqual({ symbol: "NVDAc", navPrice: 187.96606001, navUpdatedAt: "2026-11-06T21:39:16Z", multiplier: 1.0005379395763694 });
    expect(q.get(getAddress("0xb200000000000000000000000000000000000001"))?.navPrice).toBeNull();
  });

  it("skips rows that do not match the schema", async () => {
    const { fetchFn } = pages({ tokens: [{ symbol: "BROKEN" }, { ...NVDA_ROW, contract_address: "not-an-address" }, NVDA_ROW] });
    const q = await fetchNavQuotes(fetchFn);
    expect([...q.keys()]).toEqual([NVDA]);
  });

  it("throws CoinbaseUnavailable on HTTP errors, bad bodies and network failures", async () => {
    const http500: FetchLike = async () => new Response("down", { status: 500 });
    const notJson: FetchLike = async () => new Response("<html>", { status: 200 });
    const wrongShape: FetchLike = async () => new Response(JSON.stringify({ items: [] }), { status: 200 });
    const offline: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    for (const f of [http500, notJson, wrongShape, offline]) {
      await expect(fetchNavQuotes(f)).rejects.toBeInstanceOf(CoinbaseUnavailable);
    }
  });

  it("stops after 10 pages instead of looping forever", async () => {
    const endless: FetchLike = async () => new Response(JSON.stringify({ tokens: [], next_page_token: "again" }), { status: 200 });
    await expect(fetchNavQuotes(endless)).rejects.toThrow(/more than 10 pages/);
  });
});
