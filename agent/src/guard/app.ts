import type { FacilitatorClient } from "@x402/core/server";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { isAddress, type Address, type PublicClient } from "viem";
import { z } from "zod";
import { readMarketState, TokenNotCovered, type MarketState } from "../chain/market.js";
import { previewIntent } from "../chain/preview.js";
import { StateUnavailable } from "../chain/state.js";
import { ACTIONS, actionId } from "../types.js";
import { usdToUsdc6 } from "../units.js";
import { TtlCache } from "./cache.js";
import { CoinbaseUnavailable, fetchNavQuotes, type FetchLike, type NavQuote } from "./coinbase.js";
import { rateLimit, RateLimiter } from "./rateLimit.js";
import { stateView, resolveToken, toJson, verdictView } from "./views.js";
import { verdict } from "./verdict.js";
import { checkPayment } from "./x402.js";

export type GuardClient = Pick<PublicClient, "getBlock" | "multicall" | "readContract">;

export interface GuardDeps {
  client: GuardClient;
  vault: Address;
  executor: Address;
  payTo: Address;
  facilitator: FacilitatorClient;
  builderCode?: string;
  rateLimitPerMinute: number;
  corsOrigins: string[];
  fetchFn?: FetchLike;
  now?: () => number;
}

const ZERO32 = `0x${"00".repeat(32)}` as const;
const uint = z.string().regex(/^\d{1,78}$/, "a non-negative integer string").transform((v) => BigInt(v));
const previewBody = z.object({
  action: z.enum(ACTIONS),
  token: z.string().refine((v) => isAddress(v, { strict: false }), "not an address"),
  amount: uint,
  minOut: uint.optional(),
  payee: z.string().refine((v) => isAddress(v, { strict: false }), "not an address").optional(),
});
const checkQuery = z.object({
  token: z.string(),
  side: z.string().transform((v) => v.toUpperCase()).pipe(z.enum(["BUY", "SELL"])),
  sizeUSD: z.coerce.number().positive().max(1_000_000_000),
});

function send(c: Context, body: unknown, status: 200 | 400 | 404 | 500 | 503 = 200) {
  return c.body(toJson(body), status, { "content-type": "application/json; charset=utf-8" });
}

export function createGuardApp(d: GuardDeps): Hono {
  const now = d.now ?? Date.now;
  const states = new TtlCache<MarketState>(15_000, now);
  const previews = new TtlCache<{ reason: string; block: bigint }>(15_000, now);
  const navs = new TtlCache<Map<Address, NavQuote>>(60_000, now);

  const state = (token: Address) => states.get(token, () => readMarketState(d.client, d.vault, token));
  const nav = async (token: Address): Promise<NavQuote | null> => {
    try {
      return (await navs.get("all", () => fetchNavQuotes(d.fetchFn))).get(token) ?? null;
    } catch (e) {
      if (e instanceof CoinbaseUnavailable) return null; // NAV is context; the verdict reads only the chain
      throw e;
    }
  };
  // RPC down, or a token the vault does not cover, become answers instead of 500s. 503 also cancels x402 settlement.
  const failure = (c: Context, e: unknown) => {
    if (e instanceof TokenNotCovered) return send(c, { error: "TOKEN_NOT_COVERED" }, 404);
    if (e instanceof StateUnavailable) return send(c, { reason: "UNKNOWN", error: e.message }, 503);
    throw e;
  };

  const app = new Hono();
  // Backstop for anything unexpected. Only the first line of the message is logged: a viem error's later lines can carry
  // the RPC URL (an API key). 500 is at or above 400, so x402 does not settle and the caller is not charged.
  app.onError((e, c) => {
    console.error(`maat guard: unexpected error: ${String((e as Error)?.message ?? e).split("\n")[0]}`);
    return send(c, { error: "INTERNAL" }, 500);
  });
  app.use("*", cors({ origin: d.corsOrigins, allowMethods: ["GET", "POST"] }));
  app.get("/health", (c) => c.json({ ok: true }));
  app.use("/state/*", rateLimit(new RateLimiter(d.rateLimitPerMinute, now)));
  app.use("/preview", rateLimit(new RateLimiter(d.rateLimitPerMinute, now)));
  app.use("/check", rateLimit(new RateLimiter(d.rateLimitPerMinute, now)));

  app.get("/state/:token", async (c) => {
    const token = resolveToken(c.req.param("token"));
    if (!token) return send(c, { error: "TOKEN_NOT_COVERED" }, 404);
    try {
      const [s, q] = await Promise.all([state(token), nav(token)]);
      return send(c, stateView(s, q));
    } catch (e) {
      return failure(c, e);
    }
  });

  app.post("/preview", async (c) => {
    const parsed = previewBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return send(c, { error: "BAD_REQUEST", issues: parsed.error.issues.map((i) => i.message) }, 400);
    const p = parsed.data;
    const intent = {
      id: ZERO32,
      action: actionId(p.action),
      token: p.token as Address,
      amount: p.amount,
      minOut: p.minOut ?? 0n,
      payee: (p.payee ?? "0x0000000000000000000000000000000000000000") as Address,
      rationaleHash: ZERO32,
    };
    const key = toJson(intent);
    try {
      const r = await previews.get(key, async () => {
        const block = await d.client.getBlock({ blockTag: "latest" }).catch((e: unknown) => {
          throw new StateUnavailable("getBlock failed", { cause: e });
        });
        if (block.number === null) throw new StateUnavailable("latest block has no number");
        const pr = await previewIntent(d.client, d.vault, d.executor, intent, block.number);
        if (pr.result === "UNKNOWN") throw new StateUnavailable(pr.error ?? "previewIntent failed");
        return { reason: pr.result, block: block.number };
      });
      return send(c, { reason: r.reason, allowed: r.reason === "OK", block: r.block });
    } catch (e) {
      return failure(c, e);
    }
  });

  // Validate before the payment middleware, so a bad request costs the caller nothing and signs nothing.
  app.use("/check", async (c, next) => {
    const q = checkQuery.safeParse(c.req.query());
    if (!q.success) return send(c, { error: "BAD_REQUEST", issues: q.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, 400);
    if (!resolveToken(q.data.token)) return send(c, { error: "TOKEN_NOT_COVERED" }, 404);
    await next();
  });
  app.use("/check", checkPayment(d.facilitator, d.payTo, d.builderCode));
  app.get("/check", async (c) => {
    const q = checkQuery.parse(c.req.query());
    const token = resolveToken(q.token)!;
    try {
      const s = await state(token);
      return send(c, verdictView(s, verdict(s, q.side, usdToUsdc6(q.sizeUSD))));
    } catch (e) {
      return failure(c, e);
    }
  });

  return app;
}
