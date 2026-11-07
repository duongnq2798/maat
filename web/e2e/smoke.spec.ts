import { expect, type Page, test } from "@playwright/test";

// 1024: the narrowest width that keeps the hero in two columns, so the engine card shares its row.
const WIDTHS = [360, 768, 1024, 1440, 1920] as const;

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

/** Horizontal overflow of the page, and the `.card`s whose content is wider than the card (deliberate scroll regions excluded). */
async function measureFit(page: Page) {
  return page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    clipped: [...document.querySelectorAll<HTMLElement>(".card")]
      .filter((el) => !el.hasAttribute("data-scroll-x") && el.scrollWidth > el.clientWidth + 1)
      .map((el) => (el.textContent ?? "").trim().slice(0, 60)),
  }));
}

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
    const thu = page.getByRole("button", { name: "Thu 5 Nov · 10:30" });
    await thu.click();
    await expect(thu).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("status").locator("> div")).toHaveAttribute("data-verdict", "allowed");
    await expect(page.getByText("$20 ≤ $50 · $100/day")).toBeVisible();
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
  const verdict = page.getByRole("status");
  const thu = page.getByRole("button", { name: "Thu 5 Nov · 10:30" });
  const sat = page.getByRole("button", { name: "Sat 7 Nov" });
  await expect(verdict).toContainText("Refused");
  await expect(verdict).toContainText("MARKET_CLOSED");

  await thu.click();
  await expect(verdict).toContainText("Allowed");
  await expect(thu).toHaveAttribute("aria-pressed", "true");

  await sat.focus();
  await page.keyboard.press("Enter");
  await expect(verdict).toContainText("Refused");
  await expect(sat).toHaveAttribute("aria-pressed", "true");
});

test("the ledger filters", async ({ page }) => {
  await page.goto("/#ledger");
  const rows = page.getByRole("table").locator("tbody tr");
  await expect(rows).toHaveCount(4);
  await page.getByRole("button", { name: "Refused", exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("REFUSED · MARKET_CLOSED");
  await page.getByRole("button", { name: "Allowed", exact: true }).click();
  await expect(rows).toHaveCount(3);
});

test("reduced motion shows the final state at once", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const opacities = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>('[aria-label="Mandate checks"] li'),
      ...document.querySelectorAll<HTMLElement>('[role="status"] > div'),
    ].map((el) => getComputedStyle(el).opacity),
  );
  expect(opacities).toHaveLength(10);
  expect(opacities.every((o) => o === "1")).toBe(true);
});
