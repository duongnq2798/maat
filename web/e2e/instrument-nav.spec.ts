import { expect, type Page, test } from "@playwright/test";
import { LIVE_RPCS } from "../lib/live/rpc";
import { routeLiveRpc, WEEKEND_TS } from "./fake-live-rpc";

// The nav bar and its docked reading (spec 2026-11-23 sections 6.1 and 7.5), against the fake RPC of
// e2e/fake-live-rpc.ts. The landing tests set the browser's clock 5 s after the weekend block, so the reading is LIVE.

const navBar = (page: Page) => page.locator("[data-nav-bar]");
const dock = (page: Page) => page.locator("[data-nav-dock]");

async function liveWeekend(page: Page, width: number, height = 900) {
  await page.setViewportSize({ width, height });
  await page.clock.install({ time: (WEEKEND_TS + 5) * 1000 });
  await routeLiveRpc(page, "weekend");
  await page.goto("/");
  await expect(page.locator("#top [data-live-strip]")).toHaveAttribute("data-live-strip", "live");
}

const scrollTo = (page: Page, selector: string) =>
  page.evaluate((s) => document.querySelector(s)!.scrollIntoView({ block: "start", behavior: "instant" }), selector);
const scrollHome = (page: Page) => page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));

test("from lg the nav stays at the top, white, with a hairline once the page has scrolled", async ({ page }) => {
  await liveWeekend(page, 1440);
  await expect(navBar(page)).not.toHaveAttribute("data-scrolled");
  await scrollTo(page, "#how");
  await expect(navBar(page)).toHaveAttribute("data-scrolled", "");
  expect(await navBar(page).evaluate((el) => el.getBoundingClientRect().top)).toBe(0);
  expect(await navBar(page).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
  await expect.poll(() => navBar(page).evaluate((el) => getComputedStyle(el).borderBottomColor)).not.toBe("rgba(0, 0, 0, 0)");
  await scrollHome(page);
  await expect(navBar(page)).not.toHaveAttribute("data-scrolled");
});

test("on the landing the nav docks the live reading once the hero has gone, from xl only", async ({ page }) => {
  await liveWeekend(page, 1440);
  await expect(dock(page)).toHaveCount(0);
  await scrollTo(page, "#how");
  await expect(dock(page)).toBeVisible();
  await expect(dock(page)).toHaveText("● 60,013,066 · Saturday · NYSE closed");
  await expect(dock(page)).toHaveAttribute("aria-hidden", "true");
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(dock(page)).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 900 });
  await scrollHome(page);
  await expect(dock(page)).toHaveCount(0);
});

// Below lg the nav can wrap to two rows (at 768 px it does), so it is not pinned there: on a phone, nor at 800 px.
for (const [width, height] of [
  [390, 844],
  [800, 900],
] as const) {
  test(`below lg, at ${width} px, the nav scrolls away with the page`, async ({ page }) => {
    await liveWeekend(page, width, height);
    await scrollTo(page, "#how");
    expect(await navBar(page).evaluate((el) => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(0);
  });
}

for (const width of [1024, 1440]) {
  test(`from lg, at ${width} px, a nav link lands its section below the pinned bar`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await liveWeekend(page, width);
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Try it" }).click();
    await expect(page).toHaveURL(/#try$/);
    const navBottom = await navBar(page).evaluate((el) => el.getBoundingClientRect().bottom);
    const sectionTop = await page.locator("#try").evaluate((el) => el.getBoundingClientRect().top);
    expect(sectionTop).toBeGreaterThanOrEqual(navBottom - 1);
  });
}

test("/ledger keeps the bar without a docked reading, and reads no chain", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // Serve a deployments file that names no vault, so /ledger stays in its waiting view and reads nothing from Base,
  // whatever deployments/README.md records by the time this runs. PR #15's ledger client uses the same two hosts.
  await page.route("**/data/deployments.json", (r) =>
    r.fulfill({ json: { network: "Base mainnet", chainId: 8453, vault: null, deployTx: null, contracts: [] } }),
  );
  const rpc = await routeLiveRpc(page, "weekend");
  const rpcRequests: string[] = [];
  page.on("request", (r) => {
    if (LIVE_RPCS.some((host) => r.url().startsWith(host))) rpcRequests.push(r.url());
  });
  await page.goto("/ledger", { waitUntil: "networkidle" });
  await expect(navBar(page)).toHaveCount(1);
  await page.mouse.wheel(0, 1500);
  await expect(navBar(page)).toHaveAttribute("data-scrolled", "");
  await expect(dock(page)).toHaveCount(0);
  expect(rpc.calls()).toBe(0);
  expect(rpcRequests).toEqual([]);
});
