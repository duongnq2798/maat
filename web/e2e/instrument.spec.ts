import { mkdirSync, writeFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { FACTS } from "../content/facts";
import { REFRESH_MS } from "../lib/live/freshness";
import { LIVE_RPCS } from "../lib/live/rpc";
import { fixtureResults, routeLiveRpc, SESSION_TS, twapOf, WEEKEND_TS, withFeed } from "./fake-live-rpc";
import { collectErrors, measureFit } from "./helpers";

// The landing's first viewport and the hero instrument end to end (spec 2026-11-23 sections 6.2, 11 and 13), against
// the fake RPC of e2e/fake-live-rpc.ts. Each landing test sets the browser's clock 5 s after the weekend block, so the
// reading is LIVE. The clock then runs on in real time, unless a test moves it with runFor.

const strip = (page: Page) => page.locator("#top [data-live-strip]");
const bottom = (l: Locator) => l.evaluate((el) => el.getBoundingClientRect().bottom);

async function liveWeekend(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.clock.install({ time: (WEEKEND_TS + 5) * 1000 });
  const rpc = await routeLiveRpc(page, "weekend");
  await page.goto("/");
  await expect(strip(page)).toHaveAttribute("data-live-strip", "live");
  await page.evaluate(() => document.fonts.ready);
  return rpc;
}

/** Puts `selector` at the top (or the bottom) of the screen at once, past the page's smooth scrolling. */
const scrollTo = (page: Page, selector: string, block: ScrollLogicalPosition = "start") =>
  page.evaluate(({ s, b }) => document.querySelector(s)!.scrollIntoView({ block: b, behavior: "instant" }), {
    s: selector,
    b: block,
  });

test("at 1440x900 the H1, the definition, the three steps, both CTAs, the live Readout, its block and its verdict line are in the first screen", async ({
  page,
}) => {
  await liveWeekend(page, 1440, 900);
  const s = strip(page);
  await expect(s.locator(".readout-digits")).toHaveText("60,013,066");
  const parts: [string, Locator][] = [
    ["H1", page.getByRole("heading", { level: 1 })],
    ["definition", page.locator("#top [data-hero-definition]")],
    ["audience", page.locator("#top [data-hero-audience]")],
    ["steps", page.locator("#top [data-hero-steps]")],
    ["Readout", s],
    ["block", s.getByRole("link", { name: "Base block 60,013,066" })],
    ["verdict line", s.locator("[data-verdict-line]")],
  ];
  const ctas = await page.locator("[data-hero-cta]").all();
  expect(ctas).toHaveLength(2);
  for (const cta of ctas) parts.push([`CTA ${await cta.textContent()}`, cta]);
  // Soft, so a miss reports every part's bottom edge, which Step 3's fallback reads.
  for (const [name, l] of parts) expect.soft(await bottom(l), name).toBeLessThanOrEqual(900);
});

test("at 390x844 the H1, the definition, the three steps and the live verdict line are in the first screen", async ({ page }) => {
  await liveWeekend(page, 390, 844);
  expect(await bottom(page.getByRole("heading", { level: 1 })), "H1").toBeLessThanOrEqual(844);
  // Spec 2026-11-27 section 1: a phone reader learns what Maat is before scrolling.
  expect(await bottom(page.locator("#top [data-hero-definition]")), "definition").toBeLessThanOrEqual(844);
  // Cold read of 2026-11-28, gap 1: and who it is for.
  expect(await bottom(page.locator("#top [data-hero-audience]")), "audience").toBeLessThanOrEqual(844);
  expect(await bottom(page.locator("#top [data-hero-steps]")), "steps").toBeLessThanOrEqual(844);
  expect(await bottom(strip(page).locator("[data-verdict-line]")), "verdict line").toBeLessThanOrEqual(844);
  // Amendment A10 applies only if the CTAs end below the first screen here.
  const ctaBottoms = await Promise.all((await page.locator("[data-hero-cta]").all()).map(bottom));
  mkdirSync("test-results/fold", { recursive: true });
  writeFileSync("test-results/fold/cta-bottom-390.txt", `${Math.ceil(Math.max(...ctaBottoms))}\n`);
});

test("#top keeps two status regions, the engine's verdict window is the only div in them, and the Balance is outside both", async ({
  page,
}) => {
  await liveWeekend(page, 1440, 900);
  await expect(page.locator('#top [role="status"]')).toHaveCount(2);
  await expect(page.locator('#top [role="status"] > div')).toHaveCount(1);
  await expect(page.locator("#top svg.balance")).toHaveCount(1);
  await expect(page.locator('#top [role="status"] svg.balance, #top [aria-label="Mandate checks"] svg.balance')).toHaveCount(0);
});

test("on a phone the ThumbBar rises once both CTAs are above the screen, and steps aside over #try and the footer", async ({
  page,
}) => {
  await liveWeekend(page, 390, 844);
  const bar = page.locator("[data-thumb-bar]");
  await expect(bar).toHaveCount(0);
  await scrollTo(page, "#how");
  await expect(bar).toHaveAttribute("data-thumb-bar", "shown");
  await expect(bar).toBeVisible();
  await expect(bar.locator("[data-lamp]")).toHaveAttribute("data-lamp", "refuse");
  // Cold read of 2026-11-28, gap 5: the hero line's verdict words.
  await expect(bar.locator("[data-thumb-verdict]")).toHaveText("A buy right now: Refused · Market closed");
  await expect(bar).not.toContainText("Basket");
  await expect(bar.getByRole("link", { name: "Try to make it say no" })).toHaveAttribute("href", "#try");
  await scrollTo(page, "#try");
  await expect(bar).toHaveAttribute("data-thumb-bar", "hidden");
  await expect(bar).toHaveAttribute("inert", "");
  await scrollTo(page, "#how");
  await expect(bar).toHaveAttribute("data-thumb-bar", "shown");
  await scrollTo(page, "footer", "end");
  await expect(bar).toHaveAttribute("data-thumb-bar", "hidden");
  await scrollTo(page, "#how");
  await expect(bar).toHaveAttribute("data-thumb-bar", "shown");
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(bar).toBeHidden();
});

test("nothing scrolls sideways at 360 px, with the live Readout and with the ThumbBar up", async ({ page }) => {
  await liveWeekend(page, 360, 800);
  const first = await measureFit(page);
  expect(first.overflow).toBeLessThanOrEqual(0);
  expect(first.clipped).toEqual([]);
  await scrollTo(page, "#how");
  await expect(page.locator("[data-thumb-bar]")).toHaveAttribute("data-thumb-bar", "shown");
  const scrolled = await measureFit(page);
  expect(scrolled.overflow).toBeLessThanOrEqual(0);
  expect(scrolled.clipped).toEqual([]);
});

/**
 * In session, the first two basket stocks refused on their pool premium and the third passing: the ThumbBar's longest
 * live words, "Refused for NVDAc and GOOGLc" (review of PR #120).
 */
function twoRefusedOnePasses() {
  const basket = FACTS.basket.value;
  const { maxPremiumBps, twapWindowSec } = FACTS.mandate.value;
  let results = fixtureResults(SESSION_TS);
  for (const symbol of basket) {
    const twap = twapOf(results, symbol, twapWindowSec);
    const answer = symbol === basket[2] ? twap : (twap * 10_000n) / BigInt(10_000 + 2 * maxPremiumBps + 100);
    results = withFeed(results, symbol, answer, SESSION_TS - 10);
  }
  return { results, open: true };
}

for (const width of [360, 320]) {
  test(`at ${width} px the ThumbBar holds its longest live words inside its row, on screen, and nothing scrolls sideways`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.clock.install({ time: (SESSION_TS + 5) * 1000 });
    await routeLiveRpc(page, twoRefusedOnePasses());
    await page.goto("/");
    await expect(strip(page)).toHaveAttribute("data-live-strip", "live");
    await page.evaluate(() => document.fonts.ready);
    await scrollTo(page, "#how");
    const bar = page.locator("[data-thumb-bar]");
    await expect(bar).toHaveAttribute("data-thumb-bar", "shown");
    const [a, b] = FACTS.basket.value;
    const verdict = bar.locator("[data-thumb-verdict]");
    await expect(verdict).toHaveText(`A buy right now: Refused for ${a} and ${b}`);
    // Past the slide-up, the words sit inside the bar's own box, and the bar ends at the screen's bottom edge.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const barBox = document.querySelector("[data-thumb-bar]")!.getBoundingClientRect();
          const words = document.querySelector("[data-thumb-verdict]")!.getBoundingClientRect();
          return { inside: words.top >= barBox.top && words.bottom <= barBox.bottom, onScreen: Math.round(barBox.bottom) <= window.innerHeight };
        }),
      )
      .toEqual({ inside: true, onScreen: true });
    const fit = await measureFit(page);
    expect(fit.overflow).toBeLessThanOrEqual(0);
    expect(fit.clipped).toEqual([]);
  });
}

test("Pause holds the page at one read through two refresh intervals, and one interval after release adds one more", async ({
  page,
}) => {
  const rpc = await liveWeekend(page, 1440, 900);
  const s = strip(page);
  expect(rpc.calls()).toBe(1);
  const hold = s.locator("[data-readout-keys]").getByRole("button", { name: "Pause" });
  await hold.click();
  await expect(hold).toHaveAttribute("aria-pressed", "true");
  await expect(s.locator("[data-read-age]")).toContainText("paused · ");
  await page.clock.runFor(2 * REFRESH_MS);
  expect(rpc.calls()).toBe(1);
  await expect(s).toHaveAttribute("data-live-strip", "live");
  await hold.click();
  await expect(hold).toHaveAttribute("aria-pressed", "false");
  // Held for longer than REFRESH_MS, so the release reads at once (Task 1).
  await expect.poll(() => rpc.calls()).toBe(2);
  await page.clock.runFor(REFRESH_MS);
  await expect.poll(() => rpc.calls()).toBe(3);
});

test("/gap-index shows the docked plate unlit, linked to /now, and reads no chain", async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  const rpc = await routeLiveRpc(page, "weekend");
  const rpcRequests: string[] = [];
  page.on("request", (r) => {
    if (LIVE_RPCS.some((host) => r.url().startsWith(host))) rpcRequests.push(r.url());
  });
  await page.goto("/gap-index", { waitUntil: "networkidle" });
  const plate = page.getByRole("navigation", { name: "Main" }).locator("[data-docked-plate]");
  await expect(plate).toBeVisible();
  await expect(plate).toHaveAttribute("data-docked-plate", "unlit");
  await expect(plate).toHaveAttribute("href", "/now");
  await expect(plate).toHaveText("Live on / and /now");
  await expect(plate.locator("[data-lamp]")).toHaveAttribute("data-lamp", "reading");
  expect(rpc.calls()).toBe(0);
  expect(rpcRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("the live hero has no serious or critical axe violations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await liveWeekend(page, 1440, 900);
  const { violations } = await new AxeBuilder({ page }).include("#top").analyze();
  const blocking = violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 5) }));
  expect(blocking).toEqual([]);
});
