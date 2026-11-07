import { getAddress, isAddress, type Address } from "viem";
import { z } from "zod";

/** docs.base.org/sdks/tokenized-stocks/overview: read-only, no API key. */
export const COINBASE_STOCKS_URL = "https://api.coinbase.com/v1/tokenized-stocks";
const PAGE_SIZE = 500; // the documented cap
const MAX_PAGES = 10;

/** Only the fields the guard shows. nav_price is absent on many tokens; it already includes the multiplier. */
const tokenSchema = z.object({
  contract_address: z.string(),
  symbol: z.string(),
  multiplier: z.number(),
  nav_price: z.number().optional(),
  nav_price_updated_at: z.string().optional(),
});
const pageSchema = z.object({ tokens: z.array(z.unknown()), next_page_token: z.string().optional() });

export interface NavQuote {
  symbol: string;
  /** Coinbase does not document the currency; the dashboard labels it "NAV", not "USD". */
  navPrice: number | null;
  navUpdatedAt: string | null;
  multiplier: number;
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

export class CoinbaseUnavailable extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CoinbaseUnavailable";
  }
}

/** Walks every page of GET /v1/tokenized-stocks. Tokens that fail the schema are skipped, not fatal. */
export async function fetchNavQuotes(
  fetchFn: FetchLike = fetch,
  baseUrl = COINBASE_STOCKS_URL,
  timeoutMs = 5_000,
): Promise<Map<Address, NavQuote>> {
  const quotes = new Map<Address, NavQuote>();
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${baseUrl}?page_size=${PAGE_SIZE}${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ""}`;
    let body: unknown;
    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      body = await res.json();
    } catch (e) {
      throw new CoinbaseUnavailable(`tokenized-stocks list failed: ${(e as Error).message}`, { cause: e });
    }
    const p = pageSchema.safeParse(body);
    if (!p.success) throw new CoinbaseUnavailable("tokenized-stocks list has an unexpected shape");
    for (const raw of p.data.tokens) {
      const t = tokenSchema.safeParse(raw);
      if (!t.success || !isAddress(t.data.contract_address, { strict: false })) continue;
      quotes.set(getAddress(t.data.contract_address), {
        symbol: t.data.symbol,
        navPrice: t.data.nav_price ?? null,
        navUpdatedAt: t.data.nav_price_updated_at ?? null,
        multiplier: t.data.multiplier,
      });
    }
    pageToken = p.data.next_page_token;
    if (!pageToken) return quotes;
  }
  throw new CoinbaseUnavailable(`tokenized-stocks list has more than ${MAX_PAGES} pages`);
}
