import { expect, type Page, test } from "@playwright/test";
import { SELECTORS } from "../lib/live/abi";
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

// The deployments table names a MarketCalendar, and a failed isOpen call gives a reading that is still LIVE its longest
// detail, "MarketCalendar unreadable · counted closed" (lib/live/verdict.ts). At xl's narrowest width the docked reading
// must not wrap the bar onto a second row, which would move the page under it.
test("at 1280 px the docked reading keeps the bar on one row, even with the longest detail", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.clock.install({ time: (WEEKEND_TS + 5) * 1000 });
  await routeLiveRpc(page, "weekend");
  // Routed after the fake, so this handler runs first: an isOpen call gets a JSON-RPC error, anything else goes on to
  // the fake.
  for (const url of LIVE_RPCS) {
    await page.route(`${url}/**`, async (route) => {
      const request = route.request();
      const rpc = request.method() === "POST" ? ((request.postDataJSON() ?? {}) as { id?: unknown; params?: [{ data?: string }?] }) : {};
      if (!(rpc.params?.[0]?.data ?? "").startsWith(SELECTORS.isOpen)) return route.fallback();
      await route.fulfill({
        status: 200,
        headers: { "access-control-allow-origin": "*" },
        contentType: "application/json",
        body: JSON.stringify({ jsonrpc: "2.0", id: rpc.id ?? null, error: { code: -32000, message: "execution reverted" } }),
      });
    });
  }
  await page.goto("/");
  const strip = page.locator("#top [data-live-strip]");
  await expect(strip).toHaveAttribute("data-live-strip", "live");
  await expect(strip).toContainText("MarketCalendar unreadable · counted closed");
  const before = await navBar(page).evaluate((el) => el.getBoundingClientRect().height);
  await scrollTo(page, "#how");
  await expect(dock(page)).toBeVisible();
  await expect(dock(page)).toHaveText("● 60,013,066 · MarketCalendar unreadable · counted closed");
  expect(await navBar(page).evaluate((el) => el.getBoundingClientRect().height)).toBe(before);
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

// The nav links pages only, so the hero's own link to the simulator stands in for any link to a section of the landing.
for (const width of [1024, 1440]) {
  test(`from lg, at ${width} px, an in-page link lands its section below the pinned bar`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await liveWeekend(page, width);
    await page.locator("#top").getByRole("link", { name: "Try to make it say no" }).click();
    await expect(page).toHaveURL(/#try$/);
    const navBottom = await navBar(page).evaluate((el) => el.getBoundingClientRect().bottom);
    const sectionTop = await page.locator("#try").evaluate((el) => el.getBoundingClientRect().top);
    expect(sectionTop).toBeGreaterThanOrEqual(navBottom - 1);
  });
}

// Focus that moves back up the page lands on a control that may already be on screen, right under the pinned bar, so
// the browser does not scroll for it unless the page pads its scrollport by the bar (WCAG 2.2 SC 2.4.11). The hero's
// block link is such a control: put the next tab stop 140 px from the top, which leaves the block link under the bar,
// and step back to it.
for (const width of [1024, 1440]) {
  test(`from lg, at ${width} px, Shift+Tab does not leave the focused control under the pinned bar`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await liveWeekend(page, width);
    const blockLink = page.locator("#top [data-live-strip]").getByRole("link", { name: /^Base block / });
    await blockLink.focus();
    await page.keyboard.press("Tab");
    await expect(blockLink).not.toBeFocused();
    const placed = await page.evaluate(() => {
      const next = document.activeElement as HTMLElement;
      window.scrollBy({ top: next.getBoundingClientRect().top - 140, behavior: "instant" });
      next.focus({ preventScroll: true });
      return { inMain: document.getElementById("main")!.contains(next), top: Math.round(next.getBoundingClientRect().top) };
    });
    expect(placed).toEqual({ inMain: true, top: 140 });
    await page.keyboard.press("Shift+Tab");
    await expect(blockLink).toBeFocused();
    const barBottom = await navBar(page).evaluate((el) => el.getBoundingClientRect().bottom);
    await expect.poll(() => page.evaluate(() => document.activeElement!.getBoundingClientRect().bottom)).toBeGreaterThan(barBottom);
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
