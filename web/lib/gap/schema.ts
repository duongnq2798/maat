import { z } from "zod";
import { NAV_TOKENS, type NavToken } from "@/content/b20-nav";
import { ANSWER_UPDATED_TOPIC, SWAP_TOPIC } from "./decode";
import type { TokenFigures } from "./measure";
import { GAP_RPC } from "./rpc";

const SCALE = 100_000_000n;

/** An 8-decimal fixed-point integer as a decimal string, so no float rounds it: 16_076_543_559n gives "160.76543559". */
export function formatDec8(v: bigint): string {
  const abs = v < 0n ? -v : v;
  return `${v < 0n ? "-" : ""}${abs / SCALE}.${(abs % SCALE).toString().padStart(8, "0")}`;
}

const count = z.number().int().nonnegative();
const price = z.string().regex(/^-?\d+\.\d{8}$/);
const address = z.string().regex(/^0x[0-9a-f]{40}$/);
const hash = z.string().regex(/^0x[0-9a-f]{64}$/);

const update = z.strictObject({ block: count, logIndex: count, ts: count, answer: price, tx: hash });

const token = z.strictObject({
  symbol: z.string().min(1),
  token: address,
  pool: address,
  feed: address,
  aggregator: address,
  phase: z.number().int().positive(),
  feedLive: z.boolean(),
  swapsInWindow: count,
  freeze: z.nullable(
    z.strictObject({
      from: update,
      to: update,
      hours: z.number().nonnegative(),
      returnMoveBps: z.number().int(),
      swapsWhileFrozen: count,
      swapsRead: z.strictObject({ from: count, to: count }),
    }),
  ),
  largestGap: z.nullable(
    z.strictObject({ bps: count, above: z.boolean(), block: count, logIndex: count, ts: count, tx: hash, pool: price, held: price }),
  ),
  series: z.strictObject({
    pool: z.array(z.tuple([count, price])),
    feed: z.array(z.tuple([count, price])),
  }),
});

const windowBase = {
  id: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  closeTs: count,
  openTs: count,
  closeLabel: z.string().min(1),
  openLabel: z.string().min(1),
};

const symbols = NAV_TOKENS.map((t) => t.symbol);

/** The tokens of a complete window: all of NAV_TOKENS in order, or (partial) a non-empty subsequence of it. */
function inOrder(partial: boolean) {
  return (rows: { symbol: string }[], ctx: z.core.$RefinementCtx) => {
    const got = rows.map((r) => r.symbol);
    if (!partial) {
      if (got.length !== symbols.length || got.some((s, i) => s !== symbols[i])) {
        ctx.addIssue({ code: "custom", message: `a complete window holds exactly the ${symbols.length} tokens in NAV_TOKENS order` });
      }
      return;
    }
    let at = -1;
    for (const s of got) {
      const next = symbols.indexOf(s, at + 1);
      if (next < 0) {
        ctx.addIssue({ code: "custom", message: `token ${s} is unknown or out of NAV_TOKENS order` });
        return;
      }
      at = next;
    }
    if (got.length < 1) ctx.addIssue({ code: "custom", message: "a complete window holds at least one token" });
  };
}

export function editionSchema({ partial }: { partial: boolean }) {
  const pending = z.strictObject({ status: z.literal("pending"), ...windowBase });
  const complete = z.strictObject({
    status: z.literal("complete"),
    ...windowBase,
    blocks: z.strictObject({ from: count, to: count }),
    tokens: z.array(token).superRefine(inOrder(partial)),
  });
  return z.strictObject({
    edition: count,
    title: z.string().min(1),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    rpc: z.literal(GAP_RPC),
    topics: z.strictObject({ answerUpdated: z.literal(ANSWER_UPDATED_TOPIC), swap: z.literal(SWAP_TOPIC) }),
    head: z.strictObject({ block: count, ts: count }),
    windows: z.array(z.discriminatedUnion("status", [pending, complete])),
  });
}

export const EditionFileSchema = editionSchema({ partial: false });
export type EditionFile = z.infer<typeof EditionFileSchema>;
export type TokenRow = Extract<EditionFile["windows"][number], { status: "complete" }>["tokens"][number];

const lower = (s: string) => s.toLowerCase();

export function toTokenRow(
  nav: NavToken,
  read: { aggregator: string; phase: number },
  figures: TokenFigures,
  swapsRead: { from: number; to: number } | null,
): TokenRow {
  const { freeze, largestGap } = figures;
  if (freeze && !swapsRead) throw new Error(`${nav.symbol}: a freeze needs the block range its swaps were read over`);
  const asUpdate = (u: { block: number; logIndex: number; ts: number; answer: bigint; tx: string }) => ({
    block: u.block,
    logIndex: u.logIndex,
    ts: u.ts,
    answer: formatDec8(u.answer),
    tx: u.tx,
  });
  return {
    symbol: nav.symbol,
    token: lower(nav.token),
    pool: lower(nav.pool),
    feed: lower(nav.feed),
    aggregator: lower(read.aggregator),
    phase: read.phase,
    feedLive: figures.feedLive,
    swapsInWindow: figures.swapsInWindow,
    freeze: freeze
      ? {
          from: asUpdate(freeze.from),
          to: asUpdate(freeze.to),
          hours: freeze.hours,
          returnMoveBps: freeze.returnMoveBps,
          swapsWhileFrozen: figures.swapsWhileFrozen ?? 0,
          swapsRead: swapsRead!,
        }
      : null,
    largestGap: largestGap
      ? {
          bps: largestGap.bps,
          above: largestGap.above,
          block: largestGap.block,
          logIndex: largestGap.logIndex,
          ts: largestGap.ts,
          tx: largestGap.tx,
          pool: formatDec8(largestGap.pool8),
          held: formatDec8(largestGap.held8),
        }
      : null,
    series: {
      pool: figures.series.pool.map(([ts, v]): [number, string] => [ts, formatDec8(v)]),
      feed: figures.series.feed.map(([ts, v]): [number, string] => [ts, formatDec8(v)]),
    },
  };
}
