import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// The docs home and one page of each kind with the most varied markup: tables, steps, code, signatures, grouped cards.
const PAGES = [
  "/docs",
  "/docs/concepts/nine-checks",
  "/docs/guides/run-the-tests",
  "/docs/reference/mandate-vault",
  "/docs/reference",
] as const;

for (const theme of ["light", "dark"] as const) {
  for (const path of PAGES) {
    test(`${path} in ${theme} has no serious or critical axe violations`, async ({ page }) => {
      // next-themes reads the stored choice before first paint, the same as a returning reader.
      await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
      await page.goto(path, { waitUntil: "networkidle" });
      await expect(page.locator("html")).toHaveClass(theme === "dark" ? /\bdark\b/ : /^(?!.*\bdark\b)/);
      const { violations } = await new AxeBuilder({ page }).analyze();
      const blocking = violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 5) }));
      expect(blocking).toEqual([]);
    });
  }
}
