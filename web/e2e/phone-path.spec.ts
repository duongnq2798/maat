import { expect, type Page, test } from "@playwright/test";
import { routeLiveRpc, WEEKEND_TS } from "./fake-live-rpc";
import { collectErrors, expectTapTargets, measureFit } from "./helpers";

// The judge's path on a phone (judge rehearsal 2026-11-27): the landing, then the Menu to /ledger, or /now and the Gap
// Index from the landing's links. At 390 px every page there has the site's nav with its Menu (M5), the small links on
// the way are 44 px targets (m4), and the live strip shows no blank band above its bezel (m5). No test here touches the
// network: e2e/fake-live-rpc.ts answers for Base.

const PHONE = { width: 390, height: 844 } as const;

/** The nav's Menu, opened, and the link to the ledger in it. */
async function menuToLedger(page: Page) {
  const nav = page.getByRole("navigation", { name: "Main" });
  const summary = nav.locator("[data-phone-menu] > summary");
  await expect(summary).toBeVisible();
  await expectTapTargets([summary]);
  await summary.click();
  const pages = nav.getByRole("list", { name: "Pages" });
  await expect(pages).toBeVisible();
  await expectTapTargets(await pages.getByRole("link").all());
  return pages.getByRole("link", { name: "Ledger", exact: true });
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.emulateMedia({ reducedMotion: "reduce" });
  // The recorded weekend's block, read 5 s after it was made, so the strip reads it as live.
  await page.clock.install({ time: (WEEKEND_TS + 5) * 1000 });
  await routeLiveRpc(page, "weekend");
});

test("the landing's small links are 44 px targets, its strip has no blank band, and the Menu leads to /ledger", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/");
  const strip = page.locator("#top [data-live-strip]");
  await expect(strip).toHaveAttribute("data-live-strip", "live");
  await page.evaluate(() => document.fonts.ready);

  // m5: the basket's last row sits close to the bezel's read age, whatever room the reserve leaves.
  const last = (await strip.locator("[data-basket-token]").last().boundingBox())!;
  const age = (await strip.locator("[data-read-age]").boundingBox())!;
  expect(age.y - (last.y + last.height)).toBeLessThan(48);
  await strip.screenshot({ path: "test-results/screens/phone-strip-390.png" });

  await expectTapTargets([
    page.getByRole("link", { name: "Follow the build" }),
    strip.getByRole("link", { name: /^All \d+ B20s/ }),
    strip.getByRole("link", { name: /^Base block/ }),
    page.locator("#top").getByRole("link", { name: "Run the tests in 5 minutes" }),
    page.locator("[data-vault-card]").getByRole("link", { name: /Open the ledger/ }),
    ...(await page.locator("[data-vault-card]").getByRole("link", { name: /on Basescan$/ }).all()),
    ...(await page.getByRole("list", { name: "Project links" }).getByRole("link").all()),
  ]);
  await expect(page.locator("#top").getByRole("link", { name: "Run the tests in 5 minutes" })).toHaveAttribute("href", "/docs/get-started/quickstart");

  const ledger = await menuToLedger(page);
  await expect(ledger).toHaveAttribute("href", "/ledger");
  expect((await measureFit(page)).overflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

for (const path of ["/now", "/gap-index"] as const) {
  test(`${path} has the site's nav, whose Menu leads to /ledger, and no sideways scroll`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(path);
    await page.evaluate(() => document.fonts.ready);
    const ledger = await menuToLedger(page);
    await expect(ledger).toHaveAttribute("href", "/ledger");
    if (path === "/now") {
      await expect(page.locator("[data-live-strip], [data-now-board], main").first()).toBeVisible();
      const refresh = page.getByRole("button", { name: "Refresh" });
      await expect(refresh).toBeVisible();
      await expectTapTargets([refresh]);
    }
    await expectTapTargets(await page.getByRole("list", { name: "Project links" }).getByRole("link").all());
    expect((await measureFit(page)).overflow).toBeLessThanOrEqual(0);
    await ledger.click();
    await expect(page).toHaveURL(/\/ledger$/);
    expect(errors).toEqual([]);
  });
}

test("the docs' icon buttons are 44 px targets on a phone, in the header and in the sidebar", async ({ page }) => {
  await page.goto("/docs");
  await page.evaluate(() => document.fonts.ready);
  const header = page.locator("#nd-subnav");
  await expectTapTargets([header.getByRole("button", { name: "Open Search" }), header.getByRole("button", { name: "Open Sidebar" })]);
  await header.getByRole("button", { name: "Open Sidebar" }).click();
  const sidebar = page.locator("#nd-sidebar-mobile");
  await expect(sidebar.getByRole("link", { name: "GitHub" })).toBeVisible();
  await expectTapTargets([
    sidebar.getByRole("link", { name: "GitHub" }),
    sidebar.getByRole("button", { name: "Toggle Theme" }),
    sidebar.getByRole("button", { name: "Close Sidebar" }),
  ]);
});
