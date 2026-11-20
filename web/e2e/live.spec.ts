import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { NAV_TOKENS } from "../content/b20-nav";
import { FACTS } from "../content/facts";
import { andList } from "../content/format";
import { REASON_LABEL } from "../content/reasons";
import { REFRESH_MS } from "../lib/live/freshness";
import { LIVE_RPCS } from "../lib/live/rpc";
import { headlineText } from "../lib/live/verdict";
import { SITE } from "../lib/site";
import { fixtureResults, routeLiveRpc, SESSION_TS, twapOf, WEEKEND_TS, withFeed } from "./fake-live-rpc";
import { collectErrors, measureFit } from "./helpers";

// The live strip under the landing H1 and /now, end to end against the fake RPC of e2e/fake-live-rpc.ts: no test here
// touches the network. A reading shows as LIVE only while its block is at most 120 s behind the visitor's clock, so
// each test that expects LIVE sets the browser's clock a few seconds after the block it serves, before the page loads.
// The clock then runs on in real time: the hook's 30 s refresh, its 8 s fetch timeout and the age of a reading behave
// as they do for a visitor.

/** The recorded block, as the strip and /now print it and link it. */
const BLOCK_TEXT = "Base block 60,013,066";
const BLOCK_URL = "https://basescan.org/block/60013066";

async function clockAfter(page: Page, blockTs: number) {
  await page.clock.install({ time: (blockTs + 5) * 1000 });
}

const strip = (page: Page) => page.locator("#top [data-live-strip]");
const board = (page: Page) => page.locator("[data-now-board]");

/**
 * Console errors with the URL Chromium logs each against. A response with an error status is logged as "Failed to load
 * resource" at the resource's URL, so the expected failures of a scenario can be told apart by URL alone.
 */
function errorsWithUrl(page: Page): { text: string; url: string }[] {
  const errors: { text: string; url: string }[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push({ text: m.text(), url: m.location().url });
  });
  page.on("pageerror", (e) => errors.push({ text: e.message, url: "" }));
  return errors;
}

const originOf = (url: string) => (URL.canParse(url) ? new URL(url).origin : "");

test("the landing's strip reads a weekend block as LIVE, refuses with Market closed, and links /now", async ({ page }) => {
  const errors = collectErrors(page);
  await clockAfter(page, WEEKEND_TS);
  const rpc = await routeLiveRpc(page, "weekend");
  await page.goto("/");

  const s = strip(page);
  await expect(s).toHaveAttribute("data-live-strip", "live");
  await expect(s.getByText("LIVE", { exact: true })).toBeVisible();
  await expect(s.getByRole("link", { name: BLOCK_TEXT })).toHaveAttribute("href", BLOCK_URL);
  await expect(s).toContainText("15:00:00 UTC · 10:00 ET");
  await expect(s).toContainText("Saturday · NYSE closed");
  await expect(s).toContainText("An agent under Maat's default mandate would REFUSE");
  await expect(s.locator("[data-reason-tag]")).toHaveAttribute("data-reason-tag", "MARKET_CLOSED");
  await expect(s.locator("[data-reason-tag]")).toHaveText(/^Market closed\s*MARKET_CLOSED$/);
  await expect(s.getByRole("status")).toHaveText(`Live. ${headlineText({ kind: "refuse-all", reason: "MARKET_CLOSED" })}`);
  expect(rpc.calls()).toBeGreaterThanOrEqual(1);

  const all = s.getByRole("link", { name: `All ${NAV_TOKENS.length} B20s` });
  await expect(all).toHaveAttribute("href", "/now");
  await all.click();
  await expect(page).toHaveURL(/\/now$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Right now on Base");
  await expect(board(page)).toHaveAttribute("data-now-board", "live");
  expect(errors).toEqual([]);
});

test("in session the strip passes the market checks for two basket tokens and refuses the third on its pool premium", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const basket = FACTS.basket.value;
  const refused = basket[basket.length - 1]!;
  const passed = basket.slice(0, -1);
  const { maxPremiumBps, twapWindowSec } = FACTS.mandate.value;
  // Each basket feed fresh, 10 s before the block, at its pool's TWAP: every market check passes. The last one's feed
  // answers below its TWAP by about 2 × maxPremiumBps + 100 bps, so its pool price is too far from the oracle.
  let results = fixtureResults(SESSION_TS);
  for (const symbol of basket) {
    const twap = twapOf(results, symbol, twapWindowSec);
    const answer = symbol === refused ? (twap * 10_000n) / BigInt(10_000 + 2 * maxPremiumBps + 100) : twap;
    results = withFeed(results, symbol, answer, SESSION_TS - 10);
  }
  await clockAfter(page, SESSION_TS);
  await routeLiveRpc(page, { results, open: true });
  await page.goto("/");

  const s = strip(page);
  await expect(s).toHaveAttribute("data-live-strip", "live");
  await expect(s).toContainText("16:43:08 UTC · 11:43 ET");
  await expect(s).toContainText("Friday · open until 16:00 ET");
  await expect(s).toContainText(`would REFUSE ${refused}:`);
  await expect(s.locator("[data-reason-tag]")).toHaveAttribute("data-reason-tag", "PREMIUM_TOO_HIGH");
  await expect(s.locator("[data-reason-tag]")).toHaveText(new RegExp(`^${REASON_LABEL.PREMIUM_TOO_HIGH}\\s*PREMIUM_TOO_HIGH$`));
  await expect(s).toContainText(`Market checks pass for ${andList(passed)}.`);
  await expect(s.getByRole("status")).toHaveText(
    `Live. ${headlineText({ kind: "mixed", refused: [{ symbol: refused, reason: "PREMIUM_TOO_HIGH" }], passed: [...passed] })}`,
  );
  expect(errors).toEqual([]);
});

test("the strip says so when both RPCs fail, and reads again on Retry", async ({ page }) => {
  const errors = errorsWithUrl(page);
  await clockAfter(page, WEEKEND_TS);
  const rpc = await routeLiveRpc(page, "down");
  await page.goto("/");

  const s = strip(page);
  await expect(s).toHaveAttribute("data-live-strip", "error");
  await expect(s).toContainText("Could not read Base mainnet (both public RPCs failed). Nothing is shown rather than old data.");
  await expect(s).not.toContainText(BLOCK_TEXT);
  const retry = s.getByRole("button", { name: "Retry" });
  await expect(retry).toBeVisible();
  // One request to each host, in the order LIVE_RPCS gives.
  expect(rpc.calls()).toBe(LIVE_RPCS.length);

  rpc.set("weekend");
  await retry.click();
  await expect(s).toHaveAttribute("data-live-strip", "live");
  await expect(s.getByText("LIVE", { exact: true })).toBeVisible();
  await expect(s.getByRole("link", { name: BLOCK_TEXT })).toBeVisible();
  await expect(retry).toHaveCount(0);

  // The only errors are the two 503s, one from each RPC host; any other error fails the test.
  const expected = errors.filter((e) => LIVE_RPCS.includes(originOf(e.url)) && /status of 503\b/.test(e.text));
  expect(expected.map((e) => originOf(e.url))).toEqual([...LIVE_RPCS]);
  expect(errors.filter((e) => !expected.includes(e))).toEqual([]);
});

// The two timers of the hook run on the clock the tests install: runFor moves it on without waiting in real time.
test("on the page's clock the strip reads again every 30 s, and says NOT LIVE when a refresh fails", async ({ page }) => {
  const errors = errorsWithUrl(page);
  await clockAfter(page, WEEKEND_TS);
  const rpc = await routeLiveRpc(page, "weekend");
  await page.goto("/");
  const s = strip(page);
  await expect(s).toHaveAttribute("data-live-strip", "live");
  expect(rpc.calls()).toBe(1);

  await page.clock.runFor(REFRESH_MS);
  await expect.poll(() => rpc.calls()).toBe(2);
  await expect(s).toHaveAttribute("data-live-strip", "live");

  rpc.set("down");
  await page.clock.runFor(REFRESH_MS);
  await expect(s).toHaveAttribute("data-live-strip", "stale");
  await expect(s.getByText("NOT LIVE", { exact: true })).toBeVisible();
  await expect(s).toContainText("last read block 60,013,066");
  await expect(s).toContainText("the RPC did not answer since");
  await expect(s.locator("[data-verdict-line]")).toHaveAttribute("data-tone", "muted");

  const expected = errors.filter((e) => LIVE_RPCS.includes(originOf(e.url)) && /status of 503\b/.test(e.text));
  expect(expected.map((e) => originOf(e.url))).toEqual([...LIVE_RPCS]);
  expect(errors.filter((e) => !expected.includes(e))).toEqual([]);
});

test("the strip gives up on an RPC that does not answer in 8 s, tries the next, then says so", async ({ page }) => {
  const errors = collectErrors(page);
  await clockAfter(page, WEEKEND_TS);
  const rpc = await routeLiveRpc(page, "weekend", { hold: true });
  await page.goto("/");
  const s = strip(page);
  await expect.poll(() => rpc.calls()).toBe(1);

  // lib/live/rpc.ts waits 8 s for each endpoint.
  await page.clock.runFor(8_000);
  await expect.poll(() => rpc.calls()).toBe(2);
  await expect(s).toHaveAttribute("data-live-strip", "reading");
  await page.clock.runFor(8_000);
  await expect(s).toHaveAttribute("data-live-strip", "error");
  await expect(s.getByRole("button", { name: "Retry" })).toBeVisible();
  // The answers come too late: the page has given up on both requests.
  rpc.release();
  expect(errors).toEqual([]);
});

test("/now reads all 13 B20s in session: a row each, ANTc not allowed, and the method names both endpoints", async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await clockAfter(page, SESSION_TS);
  await routeLiveRpc(page, "session");
  await page.goto("/now");

  const b = board(page);
  await expect(b).toHaveAttribute("data-now-board", "live");
  await expect(b.getByText("LIVE", { exact: true })).toBeVisible();
  await expect(b.getByRole("link", { name: BLOCK_TEXT })).toHaveAttribute("href", BLOCK_URL);
  await expect(b).toContainText("16:43:08 UTC · 11:43 ET");
  await expect(b).toContainText("Friday · open until 16:00 ET");
  await expect(b).toContainText(`Read from ${LIVE_RPCS[0]}`);

  const rows = page.locator("[data-scroll-x] tbody tr");
  await expect(rows).toHaveCount(NAV_TOKENS.length);
  expect(NAV_TOKENS).toHaveLength(13);
  expect(await rows.evaluateAll((trs) => trs.map((tr) => tr.getAttribute("data-token")))).toEqual(NAV_TOKENS.map((t) => t.symbol));
  // Every cell holds a value read at the block: no dash is left from the reading state, and no call failed.
  await expect(page.locator("[data-scroll-x] tbody td", { hasText: /^—$|^could not read$/ })).toHaveCount(0);

  const ant = page.locator('[data-scroll-x] tr[data-token="ANTc"]');
  await expect(ant.locator('td[data-col="basket"]')).toHaveText("no");
  const mandate = ant.locator('td[data-col="mandate"] [data-reason-tag]');
  await expect(mandate).toHaveAttribute("data-reason-tag", "TOKEN_NOT_ALLOWED");
  await expect(mandate).toHaveText(/^Token not allowed\s*TOKEN_NOT_ALLOWED$/);

  await expect(page.locator("#method [data-endpoint]")).toHaveText([...LIVE_RPCS]);
  expect(errors).toEqual([]);
});

test("/now at 375 × 812 shows a card per token, not the table, and nothing is wider than the page", async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await clockAfter(page, SESSION_TS);
  await routeLiveRpc(page, "session");
  await page.goto("/now");
  // Widths depend on the web fonts.
  await page.evaluate(() => document.fonts.ready);
  await expect(board(page)).toHaveAttribute("data-now-board", "live");

  const cards = page.locator("[data-now-cards] article");
  await expect(page.locator("[data-now-cards]")).toBeVisible();
  await expect(cards).toHaveCount(NAV_TOKENS.length);
  for (const card of await cards.all()) await expect(card).toBeVisible();
  await expect(page.locator("[data-scroll-x]")).toHaveCount(1);
  await expect(page.locator("[data-scroll-x]")).toBeHidden();
  await expect(page.locator('[data-now-cards] article[data-token="ANTc"] dd[data-col="mandate"] [data-reason-tag]')).toHaveAttribute(
    "data-reason-tag",
    "TOKEN_NOT_ALLOWED",
  );

  const fit = await measureFit(page);
  expect(fit.overflow).toBeLessThanOrEqual(0);
  expect(fit.clipped).toEqual([]);
  expect(errors).toEqual([]);
});

for (const { width, height } of [
  { width: 1280, height: 800 },
  { width: 375, height: 812 },
]) {
  test(`/now has no axe violations once the reading arrives, at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    // Reduced motion stops the LIVE dot's pulse, so axe never measures a color mid-animation.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await clockAfter(page, SESSION_TS);
    await routeLiveRpc(page, "session");
    await page.goto("/now");
    await page.evaluate(() => document.fonts.ready);
    await expect(board(page)).toHaveAttribute("data-now-board", "live");
    await expect(page.locator('[data-now-rows] [data-reason-tag="TOKEN_NOT_ALLOWED"]').first()).toBeAttached();
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 5) }))).toEqual([]);
  });
}

test("the simulator's Now chip says the fork rows are not now, and links /now", async ({ page }) => {
  const errors = collectErrors(page);
  // The chip is offered when the visitor's clock falls on a day of the calendar's window: the weekend reading's day.
  await clockAfter(page, WEEKEND_TS);
  await routeLiveRpc(page, "weekend");
  await page.goto("/#try");
  const sim = page.locator("#try");
  // Hydrated: Post on X carries the absolute share link only once the simulator runs, so the click below lands.
  await expect(sim.getByRole("link", { name: "Post on X" })).toHaveAttribute("href", /&url=/);
  const note = sim.getByText(/^Now sets the time only\./);
  await expect(note).toHaveCount(0);

  const now = sim.getByRole("button", { name: "Now", exact: true });
  await now.click();
  await expect(now).toHaveAttribute("aria-pressed", "true");
  await expect(note).toBeVisible();
  await expect(note.getByRole("link", { name: "Read the live values on Right now on Base" })).toHaveAttribute("href", "/now");
  expect(errors).toEqual([]);
});

// Spec 5: the strip reserves its height, so the landing does not move when the reading arrives. The fake holds the
// answer until the lead paragraph has been measured in the reading state. The weekend line is the shortest common one;
// the in-session line, which passes the market checks for the three basket tokens, is the tallest common one.
for (const { scenario, name, blockTs, kind } of [
  { scenario: "weekend", name: "a weekend", blockTs: WEEKEND_TS, kind: "refuse-all" },
  { scenario: "session", name: "an in-session", blockTs: SESSION_TS, kind: "pass-all" },
] as const) {
  for (const { width, height } of [
    { width: 375, height: 812 },
    { width: 1280, height: 800 },
  ]) {
    test(`the landing does not move when ${name} reading arrives, at ${width} × ${height}`, async ({ page }) => {
      const errors = collectErrors(page);
      await page.setViewportSize({ width, height });
      // Reduced motion shows the hero's intro in its final state at once, so nothing but the strip can move the lead.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await clockAfter(page, blockTs);
      const rpc = await routeLiveRpc(page, scenario, { hold: true });
      await page.goto("/");
      await page.evaluate(() => document.fonts.ready);

      const s = strip(page);
      const lead = page.locator("#top [data-live-strip] + p");
      await expect(lead).toHaveText(SITE.description);
      const top = () => lead.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);

      await expect(s).toHaveAttribute("data-live-strip", "reading");
      await expect(s).toContainText("Reading Base mainnet…");
      // The read is in flight: the fake holds it.
      await expect.poll(() => rpc.calls()).toBe(1);
      const reading = await top();

      rpc.release();
      await expect(s).toHaveAttribute("data-live-strip", "live");
      await expect(s.getByText("LIVE", { exact: true })).toBeVisible();
      await expect(s.locator("[data-verdict-line]")).toHaveAttribute("data-verdict-line", kind);
      const live = await top();
      const line = await s.locator(":scope > p").evaluate((el) => el.getBoundingClientRect().height);
      const box = await s.evaluate((el) => el.getBoundingClientRect().height);
      test.info().annotations.push({
        type: "lead paragraph top",
        description: `reading ${reading} px, live ${live} px; the live line ${line} px in the strip's ${box} px`,
      });
      expect(Math.abs(live - reading)).toBeLessThanOrEqual(1);
      expect(errors).toEqual([]);
    });
  }
}
