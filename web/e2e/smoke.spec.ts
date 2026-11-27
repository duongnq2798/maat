import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { routeLiveRpc } from "./fake-live-rpc";
import { collectErrors, contentRight, lineCount, measureFit, rightEdge } from "./helpers";

// The live strip under the H1 reads Base mainnet from the browser. Both RPC hosts answer from the recorded weekend
// reading of e2e/fake-live-rpc.ts, so no test here touches the network; e2e/live.spec.ts tests the strip itself.
test.beforeEach(async ({ page }) => {
  await routeLiveRpc(page, "weekend");
});

/**
 * The hero's engine card opens on the mainnet vault; the scripted fork run, with its moment toggle and its verdict
 * window, is the "Before mainnet (fork test)" tab (spec 2026-11-27 section 3).
 */
async function openForkReplay(page: Page) {
  const tab = page.locator("#top").getByRole("tab", { name: "Before mainnet (fork test)" });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

// 1024: the narrowest width that keeps the hero in two columns, so the engine card shares its row.
const WIDTHS = [360, 768, 1024, 1440, 1920] as const;

for (const width of WIDTHS) {
  test(`fits ${width}px: no page scroll, nothing clipped, no console errors`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);

    // The first screen: the engine card on its mainnet face.
    const mainnet = await measureFit(page);
    expect(mainnet.overflow).toBeLessThanOrEqual(0);
    expect(mainnet.clipped).toEqual([]);
    await page.screenshot({
      path: `test-results/screens/landing-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });

    // The fork replay's default moment: Saturday, Refused.
    await openForkReplay(page);
    const saturday = await measureFit(page);
    expect(saturday.overflow).toBeLessThanOrEqual(0);
    expect(saturday.clipped).toEqual([]);
    // `animations: "disabled"` fast-forwards the intro, so the owner sees all nine rows and the verdict.
    await page.screenshot({
      path: `test-results/screens/landing-${width}-fork.png`,
      fullPage: true,
      animations: "disabled",
    });

    // Thursday: the longest mono detail (`$20 ≤ $50 · $100/day`) only renders in this moment.
    const thu = page.locator("#top").getByRole("button", { name: "Thu 5 Nov · 10:30" });
    await thu.click();
    await expect(thu).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#top").getByRole("status").locator("> [data-verdict]")).toHaveAttribute("data-verdict", "allowed");
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
  await openForkReplay(page);
  const hero = page.locator("#top");
  // The decision engine's live region, the one that holds the verdict: the live strip above it has a status of its own.
  const verdict = hero.getByRole("status").filter({ has: page.locator("[data-verdict]") });
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

// 1280: the default desktop width, where the verdict fits on one row. 375: a phone, where the right column wraps
// under the verdict word and must still end at the box's right edge.
for (const width of [1280, 375]) {
  test(`the hero verdict reads the plain label over its code, right-aligned above the outcome line, at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    // Reduced motion shows the verdict at its final size at once, so its lines are measured unscaled.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    await openForkReplay(page);
    const hero = page.locator("#top");
    const box = hero.locator('[role="status"] > div');
    const tag = hero.locator('[role="status"] [data-reason-tag]');
    // Where the text of each line ends: the tag's label, its code, then the outcome line under the tag. The column that
    // holds the three ends at the box's content edge.
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
      expect(Math.abs((await rightEdge(tag.locator(".."))) - (await contentRight(box)))).toBeLessThanOrEqual(1);
    };

    await expect(tag).toHaveAttribute("data-reason-tag", "MARKET_CLOSED");
    await expect(tag).toHaveText(/^Market closed\s*MARKET_CLOSED$/);
    // The label and the code are separate boxes, so the rendered text breaks between them; textContent has no break.
    expect(await tag.innerText()).toMatch(/^Market closed\s+MARKET_CLOSED$/);
    await expectOneRightEdge();

    await hero.getByRole("button", { name: "Thu 5 Nov · 10:30" }).click();
    await expect(tag).toHaveAttribute("data-reason-tag", "OK");
    await expect(tag).toHaveText(/^All checks passed\s*OK$/);
    expect(await tag.innerText()).toMatch(/^All checks passed\s+OK$/);
    await expectOneRightEdge();
  });
}

// Each problem card's header holds the eyebrow on the left and the trap's label over its code on the right. When the two
// do not fit side by side, the tag drops under the eyebrow, so neither breaks mid-phrase. 375: a phone. 1440: three
// columns, where card 03's eyebrow and label are both long.
for (const width of [375, 1440]) {
  test(`each problem card keeps its eyebrow and its label on one line, the tag flush right, at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    const cards = page.locator('section[aria-labelledby="problem-title"] article');
    await expect(cards).toHaveCount(3);
    for (const [i, card] of (await cards.all()).entries()) {
      const tag = card.locator("[data-reason-tag]");
      expect(await lineCount(card.locator("> div:first-child > span:first-child")), `card ${i + 1} eyebrow lines`).toBe(1);
      expect(await lineCount(tag.locator("> :first-child")), `card ${i + 1} label lines`).toBe(1);
      expect(Math.abs((await rightEdge(tag)) - (await contentRight(card))), `card ${i + 1} tag to right edge`).toBeLessThanOrEqual(1);
    }
  });
}

// The fork run's ledger left the landing for /ledger, under the mainnet ledger (spec 2026-11-27 section 3).
test("the fork ledger filters, on /ledger", async ({ page }) => {
  await page.goto("/ledger#fork");
  const fork = page.locator("#fork");
  const rows = fork.getByRole("table").locator("tbody tr");
  await expect(rows).toHaveCount(4);
  await fork.getByRole("button", { name: "Refused", exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Refused · Market closed");
  await expect(rows.first().locator("code")).toHaveText("MARKET_CLOSED");
  await fork.getByRole("button", { name: "Allowed", exact: true }).click();
  await expect(rows).toHaveCount(3);
});

// Spec 2026-11-27 section 3: the five groups show their plain labels by default, and "Show all 19" opens the codes;
// MARKET_CLOSED, the refusal the vault recorded, is the one label filled in red in both views.
test("the Refusals section fills only the recorded refusal's label in red, in the groups and in all 19", async ({ page }) => {
  await page.goto("/");
  const section = page.locator("#reasons");
  const chip = section.locator('li[data-label][data-hot="true"]');
  await expect(chip).toHaveText("Market closed");
  await expect(chip).toBeVisible();
  // --color-refuse #C2410C, white text on it.
  await expect(chip).toHaveCSS("background-color", "rgb(194, 65, 12)");
  await expect(chip).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(section.locator('li[data-label="FEED_STALE"]')).not.toHaveCSS("background-color", "rgb(194, 65, 12)");
  await expect(section.locator("li[data-code]").first()).toBeHidden();

  await section.getByRole("button", { name: "Show all 19" }).click();
  await expect(section.locator("li[data-code]")).toHaveCount(19);
  for (const li of await section.locator("li[data-code]").all()) await expect(li).toBeVisible();
  await expect(chip).toBeHidden();
  const hot = section.locator('li[data-hot] [data-reason-tag="MARKET_CLOSED"]');
  const label = hot.locator("> :first-child");
  await expect(label).toHaveText("Market closed");
  await expect(label).toHaveCSS("background-color", "rgb(194, 65, 12)");
  await expect(label).toHaveCSS("color", "rgb(255, 255, 255)");
  // The code beside it stays a muted tag: --color-ink-2 #5A6170, nothing filled.
  await expect(hot.locator("> :last-child")).toHaveCSS("color", "rgb(90, 97, 112)");
  await expect(hot.locator("> :last-child")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  // Any other refusal's label has no fill.
  await expect(section.locator('li[data-code="FEED_STALE"] [data-reason-tag] > :first-child')).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await section.getByRole("button", { name: "Show the groups only" }).click();
  await expect(section.locator("li[data-code]").first()).toBeHidden();
  await expect(chip).toBeVisible();
  // Closing the long list keeps its toggle on screen, so the reader does not lose their place.
  await expect(section.getByRole("button", { name: "Show all 19" })).toBeInViewport();
});

// On a phone "Show all 19" opens the codes where the reader is (review of PR #116): its toggle sits above the groups,
// and tapped from low on the screen it moves to the top, so the toggle stays on screen and MARKET_CLOSED, the first
// code, shows under it, above the thumb bar. Tapped from the middle of the screen, nothing needs to move.
for (const [where, at] of [
  ["the middle", 0.5],
  ["low on the screen", 0.88],
] as const) {
  test(`at 390 px Show all 19, tapped from ${where}, opens the codes on screen from MARKET_CLOSED down`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    const section = page.locator("#reasons");
    const open = section.getByRole("button", { name: "Show all 19" });
    await open.evaluate((el, at) => {
      const box = el.getBoundingClientRect();
      window.scrollBy({ top: box.top + box.height / 2 - window.innerHeight * at, behavior: "instant" });
    }, at);
    await open.click();
    const close = section.getByRole("button", { name: "Show the groups only" });
    await expect(close).toHaveAttribute("aria-expanded", "true");
    await expect(close).toBeInViewport({ ratio: 1 });
    const code = section.locator('li[data-code="MARKET_CLOSED"]');
    await expect(code).toBeInViewport({ ratio: 1 });
    // Whole above the thumb bar, once any scroll has settled.
    await expect
      .poll(() =>
        code.evaluate((el) => {
          const bar = document.querySelector('[data-thumb-bar="shown"]');
          return el.getBoundingClientRect().bottom <= (bar ? bar.getBoundingClientRect().top : window.innerHeight);
        }),
      )
      .toBe(true);
  });
}

test("reduced motion shows the final state at once", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await openForkReplay(page);
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
// once. Its default state holds the vault card's recorded Decisions and the simulator's allowed verdict on accent
// (verdict), the problem cards (refuse) with their fork badges, the simulator's badges and the Refusals groups; the
// hero's fork replay adds its refused verdict on ink and its fork badge, and "Show all 19" the nineteen codes.
test("the landing has no serious or critical axe violations", async ({ page }) => {
  // Reduced motion shows the hero's intro in its final state at once, so axe never measures a row mid-fade.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  // Hydrated: Post on X carries the absolute share link only once the simulator has read the page's address.
  await expect(page.locator("#try").getByRole("link", { name: "Post on X" })).toHaveAttribute("href", /&url=/);
  const { violations } = await new AxeBuilder({ page }).analyze();
  await openForkReplay(page);
  const replay = await new AxeBuilder({ page }).include("#top").analyze();
  await page.locator("#reasons").getByRole("button", { name: "Show all 19" }).click();
  await expect(page.locator('#reasons li[data-code="MARKET_CLOSED"]')).toBeVisible();
  const refusals = await new AxeBuilder({ page }).include("#reasons").analyze();
  const blocking = [...violations, ...replay.violations, ...refusals.violations]
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 5) }));
  expect(blocking).toEqual([]);
});

// On a phone every label must wrap inside its own box: the default page holds all nineteen refusal labels in the
// Refusals groups, the three problem cards and their badges, the hero and simulator verdicts and the decoded event. The page never scrolls
// sideways, the simulator's verdict tag stays flush right, and the decoded reason's "//" stays on the line of the label
// after it. The problem cards and the hero verdict have their own tests at this width above.
test("at 375 px the landing does not scroll sideways, and the simulator verdict and the decoded note stay whole", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);

  // The simulator verdict: the tag ends at the box's content edge, and its label and code end together, on the default
  // yes and on a Saturday no.
  const sim = page.locator("#try");
  const box = sim.locator('[role="status"] > div');
  const tag = box.locator("[data-reason-tag]");
  const expectFlushRight = async () => {
    expect(Math.abs((await rightEdge(tag)) - (await contentRight(box)))).toBeLessThanOrEqual(1);
    const edges = await tag.evaluate((el) =>
      [...el.children].map((line) => {
        const range = document.createRange();
        range.selectNodeContents(line);
        return Math.round(range.getBoundingClientRect().right);
      }),
    );
    expect(edges).toHaveLength(2);
    expect(Math.max(...edges) - Math.min(...edges)).toBeLessThanOrEqual(1);
  };
  // Hydrated: Post on X carries the absolute share link only once the simulator runs, so the click below lands.
  await expect(sim.getByRole("link", { name: "Post on X" })).toHaveAttribute("href", /&url=/);
  await expect(box).toHaveAttribute("data-reason", "OK");
  await expectFlushRight();
  await sim.getByRole("button", { name: "Sat 7 Nov", exact: true }).click();
  await expect(box).toHaveAttribute("data-reason", "MARKET_CLOSED");
  await expectFlushRight();

  // The decoded event: "// Market closed" moves to the next line whole, so the marker never ends the line above.
  expect(await lineCount(page.locator("#how dd span", { hasText: "// Market closed" }))).toBe(1);
});
