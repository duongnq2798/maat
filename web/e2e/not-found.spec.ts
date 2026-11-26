import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { collectErrors, measureFit } from "./helpers";

// The 404 for any URL no route matches, landing or docs (app/global-not-found.tsx): the site's own white page, its mark,
// one line and the way back to the landing, the ledger and the docs. The page reads no chain, so no request is routed.

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
] as const;

for (const vp of VIEWPORTS) {
  test(`at ${vp.width} px a missing page says there is nothing here to weigh and links the landing, the ledger and the docs`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize(vp);
    for (const path of ["/does-not-exist", "/docs/does-not-exist"]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      await expect(page).toHaveTitle("Page not found · Maat");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nothing here to weigh.");
      const links = page.getByRole("main").getByRole("link");
      await expect(links).toHaveText(["Home", "Ledger", "Docs"]);
      expect(await links.evaluateAll((els) => els.map((el) => el.getAttribute("href")))).toEqual(["/", "/ledger", "/docs"]);
      // The site's white page, whatever the visitor's color scheme, and nothing wider than the screen.
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(255, 255, 255)");
      expect(await measureFit(page)).toEqual({ overflow: 0, clipped: [] });
    }
    await page.screenshot({ path: `test-results/screens/not-found-${vp.width}.png` });
    expect(errors).toEqual([]);
  });
}

test("the 404 page has no serious or critical axe violations, in either color scheme", async ({ page }) => {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto("/does-not-exist");
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  }
});
