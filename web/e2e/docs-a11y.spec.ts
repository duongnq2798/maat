import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// The docs home and one page of each kind with the most varied markup: tables, steps, code, signatures, grouped cards.
// Then the pages of the health-factor scale and the multiplier flow, whose colours and cards no page above has.
// Then the reference data pages: the address table's group header rows and Basescan links, the deployments note (a table once a row has an address) and the fact tables.
const PAGES = [
  "/docs",
  "/docs/concepts/nine-checks",
  "/docs/guides/run-the-tests",
  "/docs/reference/mandate-vault",
  "/docs/reference",
  "/docs/concepts/credit-and-health-factor",
  "/docs/concepts/splits-and-multiplier",
  "/docs/reference/base-addresses",
  "/docs/reference/default-parameters",
] as const;

for (const theme of ["light", "dark"] as const) {
  for (const path of PAGES) {
    test(`${path} in ${theme} has no serious or critical axe violations`, async ({ page }) => {
      // next-themes reads the stored choice before first paint, the same as a returning reader.
      await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
      await page.goto(path, { waitUntil: "networkidle" });
      await expect(page.locator("html")).toHaveClass(theme === "dark" ? /\bdark\b/ : /^(?!.*\bdark\b)/);
      // Hydrated: each block that scrolls sideways has measured itself, so it is a tab stop only if it scrolls.
      await expect(page.locator('[data-overflow="unmeasured"]')).toHaveCount(0);
      const { violations } = await new AxeBuilder({ page }).analyze();
      const blocking = violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 5) }));
      expect(blocking).toEqual([]);
    });
  }
}
