import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { collectErrors, measureFit } from "./helpers";

// 1024: the narrowest width that keeps the hero in two columns, so the engine card shares its row.
const WIDTHS = [360, 768, 1024, 1440, 1920] as const;

for (const width of WIDTHS) {
  test(`fits ${width}px: no page scroll, nothing clipped, no console errors`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);

    // Default moment: Saturday, Refused.
    const saturday = await measureFit(page);
    expect(saturday.overflow).toBeLessThanOrEqual(0);
    expect(saturday.clipped).toEqual([]);
    // `animations: "disabled"` fast-forwards the intro, so the owner sees all nine rows and the verdict.
    await page.screenshot({
      path: `test-results/screens/landing-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });

    // Thursday: the longest mono detail (`$20 ≤ $50 · $100/day`) only renders in this moment.
    const thu = page.locator("#top").getByRole("button", { name: "Thu 5 Nov · 10:30" });
    await thu.click();
    await expect(thu).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#top").getByRole("status").locator("> div")).toHaveAttribute("data-verdict", "allowed");
    await expect(page.locator("#top").getByText("$20 ≤ $50 · $100/day")).toBeVisible();
    // Wait for the intro animations to end; the live dot loops forever, so it is skipped.
    await page.waitForFunction(() =>
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .every((a) => a.playState === "finished"),
    );
    const thursday = await measureFit(page);
    expect(thursday.overflow).toBeLessThanOrEqual(0);
    expect(thursday.clipped).toEqual([]);

    expect(errors).toEqual([]);
  });
}

test("the moment toggle works by mouse and keyboard", async ({ page }) => {
  await page.goto("/");
  const hero = page.locator("#top");
  const verdict = hero.getByRole("status");
  const thu = hero.getByRole("button", { name: "Thu 5 Nov · 10:30" });
  const sat = hero.getByRole("button", { name: "Sat 7 Nov" });
  await expect(verdict).toContainText("Refused");
  await expect(verdict).toContainText("Market closed");
  await expect(verdict).toContainText("MARKET_CLOSED");

  await thu.click();
  await expect(verdict).toContainText("Allowed");
  await expect(verdict).toContainText("All checks passed");
  await expect(thu).toHaveAttribute("aria-pressed", "true");

  await sat.focus();
  await page.keyboard.press("Enter");
  await expect(verdict).toContainText("Refused");
  await expect(sat).toHaveAttribute("aria-pressed", "true");
});

test("the hero verdict reads the plain label over its code, right-aligned above the outcome line", async ({ page }) => {
  // Reduced motion shows the verdict at its final size at once, so its lines are measured unscaled.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const hero = page.locator("#top");
  const tag = hero.locator('[role="status"] [data-reason-tag]');
  // Where the text of each line ends: the tag's label, its code, then the outcome line under the tag.
  const expectOneRightEdge = async () => {
    const edges = await tag.evaluate((el) =>
      [...el.children, el.nextElementSibling].map((line) => {
        const range = document.createRange();
        range.selectNodeContents(line!);
        return Math.round(range.getBoundingClientRect().right);
      }),
    );
    expect(edges).toHaveLength(3);
    expect(Math.max(...edges) - Math.min(...edges)).toBeLessThanOrEqual(1);
  };

  await expect(tag).toHaveAttribute("data-reason-tag", "MARKET_CLOSED");
  await expect(tag).toHaveText(/^Market closed\s*MARKET_CLOSED$/);
  await expectOneRightEdge();

  await hero.getByRole("button", { name: "Thu 5 Nov · 10:30" }).click();
  await expect(tag).toHaveAttribute("data-reason-tag", "OK");
  await expect(tag).toHaveText(/^All checks passed\s*OK$/);
  await expectOneRightEdge();
});

test("the ledger filters", async ({ page }) => {
  await page.goto("/#ledger");
  const rows = page.getByRole("table").locator("tbody tr");
  await expect(rows).toHaveCount(4);
  await page.getByRole("button", { name: "Refused", exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Refused · Market closed");
  await expect(rows.first().locator("code")).toHaveText("MARKET_CLOSED");
  await page.getByRole("button", { name: "Allowed", exact: true }).click();
  await expect(rows).toHaveCount(3);
});

test("the Refusals section fills only the recorded refusal's label in red", async ({ page }) => {
  await page.goto("/");
  const hot = page.locator('#reasons li[data-hot] [data-reason-tag="MARKET_CLOSED"]');
  const label = hot.locator("> :first-child");
  await expect(label).toHaveText("Market closed");
  // --color-refuse #C2410C, white text on it.
  await expect(label).toHaveCSS("background-color", "rgb(194, 65, 12)");
  await expect(label).toHaveCSS("color", "rgb(255, 255, 255)");
  // The code beside it stays a muted tag: --color-ink-2 #5A6170, nothing filled.
  await expect(hot.locator("> :last-child")).toHaveCSS("color", "rgb(90, 97, 112)");
  await expect(hot.locator("> :last-child")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  // Any other refusal's label has no fill.
  await expect(page.locator('#reasons li[data-code="FEED_STALE"] [data-reason-tag] > :first-child')).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
});

test("reduced motion shows the final state at once", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const opacities = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>('#top [aria-label="Mandate checks"] li'),
      ...document.querySelectorAll<HTMLElement>('#top [role="status"] > div'),
    ].map((el) => getComputedStyle(el).opacity),
  );
  expect(opacities).toHaveLength(10);
  expect(opacities.every((o) => o === "1")).toBe(true);
});

// The same check as e2e/docs-a11y.spec.ts, on the landing. The landing has one theme (no dark variant), so it runs
// once. Its default state holds every ReasonTag tone: the hero's refused verdict on ink and the simulator's allowed
// verdict on accent (verdict), the problem cards (refuse) and the Refusals list (neutral); and the ledger's code tags
// (`text-ink-2` on white, components/LedgerTable.tsx).
test("the landing has no serious or critical axe violations", async ({ page }) => {
  // Reduced motion shows the hero's intro in its final state at once, so axe never measures a row mid-fade.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  // Hydrated: Post on X carries the absolute share link only once the simulator has read the page's address.
  await expect(page.locator("#try").getByRole("link", { name: "Post on X" })).toHaveAttribute("href", /&url=/);
  const { violations } = await new AxeBuilder({ page }).analyze();
  const blocking = violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 5) }));
  expect(blocking).toEqual([]);
});

// Review Focus 1: on a phone, the longest labels ("Pool price too far from oracle", "Price feed out of date") wrap
// inside the Refusals items, the ledger cell and the simulator verdict, and the page never scrolls sideways.
test("the landing does not scroll sideways at 375 px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
});
