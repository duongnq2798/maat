import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, test } from "@playwright/test";
import { ASK_OPEN } from "../content/ask-open";
import { routeLiveRpc } from "./fake-live-rpc";
import { collectErrors, lineCount } from "./helpers";

// The landing's nav (components/sections/Nav.tsx) at the widths smoke.spec.ts checks, and at 390 px, a phone. Pages
// first (spec 2026-11-23 section 2, decision 3): the bar and the phone menu list the same pages, Now, Gap Index, Ledger
// and Docs, and no section of the landing. The owner's switch, content/ask-open.ts, adds Ask and Proof after Ledger in
// both; while it is off, neither is there. Up to 720 px the bar's links give way to the Menu.
const ASK = ASK_OPEN ? ["Ask", "Proof"] : [];
const BAR = ["Now", "Gap Index", "Ledger", ...ASK, "Docs"];
const MENU = BAR;
const PILL = "View on GitHub ↗";

for (const width of [360, 390, 768, 1024, 1440, 1920]) {
  test(`at ${width} px the nav ${ASK_OPEN ? "links" : "leaves out"} Ask and Proof, fits, tabs in order and passes axe`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await routeLiveRpc(page, "weekend");
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);

    const nav = page.getByRole("navigation", { name: "Main" });
    const home = nav.getByRole("link", { name: "Maat home" });
    const github = nav.getByRole("link", { name: "GitHub" });
    const summary = nav.locator("[data-phone-menu] > summary");
    const pages = nav.getByRole("list", { name: "Pages" });
    const phone = width <= 720;
    const link = (scope: Locator, name: string) => scope.getByRole("link", { name, exact: true });

    // Keyboard order: the home link, then the bar's links in reading order, or on a phone the Menu, opened with Enter,
    // and its pages; the GitHub pill last.
    const order = phone ? [summary, ...MENU.map((n) => link(pages, n))] : BAR.map((n) => link(nav, n));
    await home.focus();
    for (const next of [...order, github]) {
      await page.keyboard.press("Tab");
      await expect(next).toBeFocused();
      if (next === summary) {
        await page.keyboard.press("Enter");
        await expect(pages).toBeVisible();
      }
    }
    await expect(summary).toBeVisible({ visible: phone });
    // Only the shown links: the bar's are display: none on a phone, and the menu's are while it is hidden or closed.
    await expect(nav.getByRole("link")).toHaveText(["maat", ...(phone ? MENU : BAR), PILL]);

    // Nothing clipped: no page scroll, every shown control inside the viewport, and each text link on one line.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    for (const el of [...(await nav.getByRole("link").all()), ...(phone ? [summary, pages] : [])]) {
      const box = (await el.boundingBox())!;
      const label = (await el.textContent()) ?? "";
      expect(box.x, label).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, label).toBeLessThanOrEqual(width);
    }
    for (const el of order.filter((l) => l !== summary)) expect(await lineCount(el), (await el.textContent()) ?? "").toBe(1);
    // From lg the bar is pinned, and the page pads its scrollport by the bar's height: it stays one row that tall.
    if (width >= 1024) {
      const { bar, padding } = await page.evaluate(() => ({
        bar: document.querySelector("[data-nav-bar]")!.getBoundingClientRect().height,
        padding: parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop),
      }));
      expect(bar).toBeLessThanOrEqual(padding);
    }

    const { violations } = await new AxeBuilder({ page }).include("[data-nav-bar]").analyze();
    const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.help}`);
    expect(blocking).toEqual([]);
    expect(errors).toEqual([]);
  });
}
