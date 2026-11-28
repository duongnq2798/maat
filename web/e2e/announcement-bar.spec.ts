import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { routeLiveRpc } from "./fake-live-rpc";
import { collectErrors, expectTapTargets, measureFit } from "./helpers";

// The bar over the landing's nav (components/sections/AnnouncementBar.tsx). Below sm (640 px) it shows its short line,
// "Live on Base · Unaudited · Follow →", on one row; from sm, its long line. Both lines are in the HTML and CSS picks
// one, so the row is right at first paint (PR #123 review, finding 37: three rows at 360 px before).
const PHRASES = [
  ["Live on Base", "Live on Base mainnet"],
  ["Unaudited", "Unaudited · small treasury on purpose"],
  ["Follow →", "Follow the build"],
] as const;

for (const width of [360, 390, 768, 1440]) {
  const phone = width < 640;
  test(`at ${width} px the bar shows its ${phone ? "short line on one row" : "long line"}, with no sideways scroll and passes axe`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await routeLiveRpc(page, "weekend");
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);

    const bar = page.locator("[data-announcement-bar]");
    for (const [short, long] of PHRASES) {
      const [shown, hidden] = phone ? [short, long] : [long, short];
      await expect(bar.getByText(shown, { exact: true })).toBeVisible();
      // The other line is in the page too, hidden by CSS alone.
      await expect(bar.getByText(hidden, { exact: true })).toHaveCount(1);
      await expect(bar.getByText(hidden, { exact: true })).toBeHidden();
    }

    const link = bar.getByRole("link", { name: "Follow the build" });
    await expect(link).toHaveAttribute("href", "https://x.com/maatonbase");
    await expectTapTargets([link]);

    if (phone) {
      // One row: every shown item on one centre line, and the bar no taller than one line and its padding.
      const items = [bar.getByText("Live on Base", { exact: true }), bar.getByText("Unaudited", { exact: true }), link];
      const centres = await Promise.all(items.map(async (el) => ((b) => b.y + b.height / 2)((await el.boundingBox())!)));
      for (const c of centres) expect(Math.abs(c - centres[0]!)).toBeLessThan(1);
      expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(40);
    }

    expect((await measureFit(page)).overflow).toBeLessThanOrEqual(0);
    expect(await bar.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    const { violations } = await new AxeBuilder({ page }).include("[data-announcement-bar]").analyze();
    expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    expect(errors).toEqual([]);
  });
}
