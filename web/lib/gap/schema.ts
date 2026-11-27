import { z } from "zod";
import { NAV_TOKENS, type NavToken } from "@/content/b20-nav";
import { DECISION_TOPIC, decisionCounts, REASON_CODES, SENDERS, type Sender } from "./decisions";
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

const senderCount = z.strictObject({ count, marketClosed: count });

/** The vault's Decision logs in a window's blocks, and their counts (lib/gap/vault.ts reads them). */
const decisions = z.strictObject({
  vault: address,
  topic: z.literal(DECISION_TOPIC),
  count,
  marketClosed: count,
  bySender: z.strictObject(Object.fromEntries(SENDERS.map((s) => [s, senderCount])) as Record<Sender, typeof senderCount>),
  list: z.array(
    z.strictObject({ block: count, logIndex: count, ts: count, tx: hash, sender: z.enum(SENDERS), allowed: z.boolean(), reason: z.enum(REASON_CODES) }),
  ),
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

/** Rules across fields that a per-field schema cannot state; they also hold for every committed file. */
function consistent(file: { windows: unknown[] }, ctx: z.core.$RefinementCtx): void {
  const bad = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
  type Win = { status: string; id: string; closeTs: number; openTs: number; blocks?: { from: number; to: number }; decisions?: Decisions; tokens?: TokenRow[] };
  (file.windows as Win[]).forEach((w, wi) => {
    const at = ["windows", wi];
    if (!(w.closeTs < w.openTs)) bad(at, `window ${w.id}: closeTs must be before openTs`);
    if (w.status !== "complete") return;
    if (w.blocks && !(w.blocks.from <= w.blocks.to)) bad([...at, "blocks"], `window ${w.id}: blocks.from must not exceed blocks.to`);
    if (w.decisions && w.blocks) {
      const d = w.decisions;
      const dat = [...at, "decisions"];
      const { count: n, marketClosed, bySender } = decisionCounts(d.list);
      if (n !== d.count || marketClosed !== d.marketClosed || SENDERS.some((s) => bySender[s].count !== d.bySender[s].count || bySender[s].marketClosed !== d.bySender[s].marketClosed)) {
        bad(dat, `window ${w.id}: the Decision counts are not those of its list`);
      }
      d.list.forEach((x, i) => {
        if (x.block < w.blocks!.from || x.block > w.blocks!.to) bad([...dat, "list", i], `window ${w.id}: a Decision at block ${x.block} lies outside blocks ${w.blocks!.from} to ${w.blocks!.to}`);
        if (x.allowed !== (x.reason === "OK")) bad([...dat, "list", i], `window ${w.id}: the Decision at block ${x.block} log ${x.logIndex} is allowed only if its reason is OK`);
        const prev = d.list[i - 1];
        if (prev && (prev.block > x.block || (prev.block === x.block && prev.logIndex >= x.logIndex))) bad([...dat, "list", i], `window ${w.id}: the Decisions are not in block and log order`);
      });
    }
    (w.tokens ?? []).forEach((t, ti) => {
      const tat = [...at, "tokens", ti];
      const name = `${w.id} ${t.symbol}`;
      if (!t.feedLive && t.freeze) bad([...tat, "freeze"], `${name}: a dead feed has no freeze`);
      if (t.freeze && !(t.freeze.swapsRead.from <= t.freeze.swapsRead.to)) bad([...tat, "freeze", "swapsRead"], `${name}: swapsRead.from must not exceed swapsRead.to`);
      if (t.largestGap) {
        if (!t.freeze) bad([...tat, "largestGap"], `${name}: a largest gap needs a freeze`);
        else {
          if (t.largestGap.block < t.freeze.from.block || t.largestGap.block > t.freeze.to.block) bad([...tat, "largestGap", "block"], `${name}: the largest gap lies outside the freeze`);
          if (t.largestGap.held !== t.freeze.from.answer) bad([...tat, "largestGap", "held"], `${name}: the held price is not the freeze's opening answer`);
        }
      }
      for (const k of ["pool", "feed"] as const) {
        t.series[k].forEach(([ts], pi) => {
          if (ts < w.closeTs || ts >= w.openTs) bad([...tat, "series", k, pi], `${name}: a ${k} point at ${ts} lies outside [closeTs, openTs)`);
        });
      }
    });
  });
}

export function editionSchema({ partial }: { partial: boolean }) {
  const pending = z.strictObject({ status: z.literal("pending"), ...windowBase });
  const complete = z.strictObject({
    status: z.literal("complete"),
    ...windowBase,
    blocks: z.strictObject({ from: count, to: count }),
    // Only an edition whose definition counts Decisions has them, so edition 0's windows are written as before.
    decisions: decisions.optional(),
    tokens: z.array(token).superRefine(inOrder(partial)),
  });
  const file = z.strictObject({
    edition: count,
    title: z.string().min(1),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    rpc: z.literal(GAP_RPC),
    topics: z.strictObject({ answerUpdated: z.literal(ANSWER_UPDATED_TOPIC), swap: z.literal(SWAP_TOPIC) }),
    head: z.strictObject({ block: count, ts: count }),
    windows: z.array(z.discriminatedUnion("status", [pending, complete])),
  });
  return file.superRefine(consistent);
}

export const EditionFileSchema = editionSchema({ partial: false });
export type EditionFile = z.infer<typeof EditionFileSchema>;
export type TokenRow = Extract<EditionFile["windows"][number], { status: "complete" }>["tokens"][number];
export type Decisions = z.infer<typeof decisions>;

const lower = (s: string) => s.toLowerCase();

export function toTokenRow(
  nav: NavToken,
  read: { aggregator: string; phase: number },
  figures: TokenFigures,
  swapsRead: { from: number; to: number } | null,
): TokenRow {
  const { freeze, largestGap, swapsWhileFrozen } = figures;
  if (freeze && swapsWhileFrozen === null) throw new Error(`${nav.symbol}: a freeze needs its swapsWhileFrozen count`);
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
          swapsWhileFrozen: swapsWhileFrozen!,
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
