import { mkdirSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { NAV_TOKENS } from "../content/b20-nav";
import { FACTS } from "../content/facts";
import { type CallResult, word } from "../lib/live/abi";
import { HEAD_MAX_LAG_SEC, REFRESH_MS } from "../lib/live/freshness";
import { LIVE_RPCS } from "../lib/live/rpc";
import {
  fixtureResults,
  type LiveRpc,
  routeLiveRpc,
  type Scenario,
  SESSION_TS,
  twapOf,
  WEEKEND_TS,
  withFeed,
} from "./fake-live-rpc";

// Every frame the landing's live Readout can show, at six widths, under reduced motion so each frame is final at once
// (spec 2026-11-23 sections 3.5, 6.2 and 13). Each test writes the Readout's natural height, measured with its
// min-height lifted, to test-results/readout-heights/<frame>-<width>.txt; STRIP_RESERVE in components/live/LiveStrip.tsx
// comes from those files. No test here touches the network: e2e/fake-live-rpc.ts answers for Base.

const WIDTHS = [360, 640, 1000, 1280, 1440, 1920] as const;
const HEIGHTS = "test-results/readout-heights";
const READING = "Reading Base mainnet…";
const FAILED = "Could not read Base mainnet (both public RPCs failed). Nothing is shown rather than old data.";

const strip = (page: Page) => page.locator("#top [data-live-strip]");

/** Each basket feed fresh at its pool's TWAP, 10 s before the in-session block: every market check passes. */
function passAll(): CallResult[] {
  let r = fixtureResults(SESSION_TS);
  for (const symbol of FACTS.basket.value) {
    r = withFeed(r, symbol, twapOf(r, symbol, FACTS.mandate.value.twapWindowSec), SESSION_TS - 10);
  }
  return r;
}

/**
 * The longest verdict the strip can print: each basket token refused for its own reason. The first one's feed is
 * older than maxStalenessSec (FEED_STALE). The second has a multiplier change scheduled an hour after the block
 * (MULTIPLIER_COOLDOWN). The third's feed sits below its pool's TWAP by about 2 × maxPremiumBps + 100 bps
 * (PREMIUM_TOO_HIGH).
 */
function threeRefusals(): CallResult[] {
  const [stale, cooling, premium] = FACTS.basket.value;
  const { maxPremiumBps, maxStalenessSec, twapWindowSec } = FACTS.mandate.value;
  let r = fixtureResults(SESSION_TS);
  for (const symbol of FACTS.basket.value) {
    const twap = twapOf(r, symbol, twapWindowSec);
    const answer = symbol === premium ? (twap * 10_000n) / BigInt(10_000 + 2 * maxPremiumBps + 100) : twap;
    r = withFeed(r, symbol, answer, symbol === stale ? SESSION_TS - maxStalenessSec - 600 : SESSION_TS - 10);
  }
  // effectiveAt: the third of each token's five calls, after the block number and the timestamp.
  const i = NAV_TOKENS.findIndex((t) => t.symbol === cooling);
  if (i < 0) throw new Error(`no NAV token ${cooling}`);
  r[2 + i * 5 + 2] = { success: true, returnData: `0x${word(BigInt(SESSION_TS + 3600))}` };
  return r;
}

interface Frame {
  name: string;
  /** The browser's clock when the page loads, s. */
  clock: number;
  scenario: Scenario;
  /** Keep every answer in flight: the strip stays in its first read, for 8 s per host. */
  hold?: boolean;
  /** What moves the strip on from its first answer to this frame. */
  then?: (page: Page, rpc: LiveRpc) => Promise<void>;
  state: "reading" | "live" | "stale" | "behind" | "error";
  words: readonly string[];
  /** The reason codes the verdict line tags, in basket order. */
  tags?: readonly string[];
}

const FRAMES: readonly Frame[] = [
  { name: "reading", clock: WEEKEND_TS + 5, scenario: "weekend", hold: true, state: "reading", words: [READING] },
  {
    name: "live-weekend",
    clock: WEEKEND_TS + 5,
    scenario: "weekend",
    state: "live",
    words: ["LIVE", "Saturday · NYSE closed", "opens Mon 09:30 ET · in 1 d 23 h", "would REFUSE"],
    tags: ["MARKET_CLOSED"],
  },
  {
    name: "live-session",
    clock: SESSION_TS + 5,
    scenario: { results: passAll(), open: true },
    state: "live",
    words: ["LIVE", "Friday · open until 16:00 ET", "would pass the market checks"],
  },
  {
    name: "live-three-refusals",
    clock: SESSION_TS + 5,
    scenario: { results: threeRefusals(), open: true },
    state: "live",
    words: ["LIVE", "would REFUSE"],
    tags: ["FEED_STALE", "MULTIPLIER_COOLDOWN", "PREMIUM_TOO_HIGH"],
  },
  {
    name: "stale",
    clock: WEEKEND_TS + 5,
    scenario: "weekend",
    then: async (page, rpc) => {
      await expect(strip(page)).toHaveAttribute("data-live-strip", "live");
      rpc.set("down");
      await page.clock.runFor(REFRESH_MS);
    },
    state: "stale",
    words: ["NOT LIVE", "last read block", "the RPC did not answer since"],
  },
  {
    name: "behind",
    clock: WEEKEND_TS + HEAD_MAX_LAG_SEC + 60,
    scenario: "weekend",
    state: "behind",
    words: ["NOT LIVE", "behind your clock"],
  },
  { name: "error", clock: WEEKEND_TS + 5, scenario: "down", state: "error", words: [FAILED, "Retry"] },
];

/** Console errors with the URL each is logged against, so the 503s a frame asks for can be told from real errors. */
function errorsWithUrl(page: Page): { text: string; url: string }[] {
  const errors: { text: string; url: string }[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push({ text: m.text(), url: m.location().url });
  });
  page.on("pageerror", (e) => errors.push({ text: e.message, url: "" }));
  return errors;
}

const originOf = (url: string) => (URL.canParse(url) ? new URL(url).origin : "");

for (const frame of FRAMES) {
  for (const width of WIDTHS) {
    test(`the ${frame.name} frame fits the Readout at ${width} px`, async ({ page }) => {
      const errors = errorsWithUrl(page);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 900 });
      await page.clock.install({ time: frame.clock * 1000 });
      const rpc = await routeLiveRpc(page, frame.scenario, { hold: frame.hold });
      await page.goto("/");
      const s = strip(page);
      await frame.then?.(page, rpc);
      await expect(s).toHaveAttribute("data-live-strip", frame.state);
      for (const w of frame.words) await expect(s).toContainText(w);
      if (frame.tags !== undefined) {
        const tags = s.locator("[data-reason-tag]");
        await expect(tags).toHaveCount(frame.tags.length);
        expect(await tags.evaluateAll((els) => els.map((el) => el.getAttribute("data-reason-tag")))).toEqual(frame.tags);
      }
      await page.evaluate(() => document.fonts.ready);

      // Every row of the one <p> holds words, and HOLD is on the bezel in every frame (amendment A7).
      const empty = await s.evaluate(
        (el) => [...el.querySelectorAll(":scope > p > span")].filter((row) => (row.textContent ?? "").trim() === "").length,
      );
      expect(empty).toBe(0);
      await expect(s.locator("[data-readout-keys]").getByRole("button", { name: "Hold" })).toBeVisible();

      // The natural height: the Readout with its reserved min-height lifted for one measurement. The box itself
      // grows past the reserve rather than overflow, so the frame is checked against the reserve, not the box.
      const { reserve, box, natural } = await s.evaluate((el) => {
        const reserved = Number.parseFloat(getComputedStyle(el).minHeight);
        const shown = el.getBoundingClientRect().height;
        el.style.minHeight = "0px";
        const content = el.getBoundingClientRect().height;
        el.style.minHeight = "";
        return { reserve: reserved, box: shown, natural: content };
      });
      mkdirSync(HEIGHTS, { recursive: true });
      writeFileSync(`${HEIGHTS}/${frame.name}-${width}.txt`, `${Math.ceil(natural)}\n`);
      await page.screenshot({ path: `test-results/screens/states-${frame.name}-${width}.png` });
      expect(natural, `${frame.name} at ${width} px needs ${Math.ceil(natural)} px`).toBeLessThanOrEqual(reserve);
      expect(box, "the Readout keeps its reserved height").toBe(reserve);

      // The only errors are the 503s the frame asked for; any other error fails the test.
      const expected = errors.filter((e) => LIVE_RPCS.includes(originOf(e.url)) && /status of 503\b/.test(e.text));
      expect(errors.filter((e) => !expected.includes(e))).toEqual([]);
    });
  }
}
