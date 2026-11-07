import { expect, type Page, test } from "@playwright/test";
import { FACT_TEXT } from "../lib/docs/fact-text";

const WIDTHS = [360, 768, 1024, 1440, 1920] as const;
/** Pages checked at every width: the docs home, then the longest pages as they ship (Tasks 8, 13, 14, 15 and 16). */
const PAGES: string[] = [
  "/docs",
  "/docs/concepts/nine-checks",
  "/docs/guides/run-the-tests",
  "/docs/guides/reproduce-the-fork-run",
  "/docs/guides/deploy-your-own-vault",
  "/docs/guides/configure-a-mandate",
  "/docs/guides/run-the-agent",
  "/docs/guides/change-a-rule",
  "/docs/guides/pause-withdraw-recover",
  "/docs/guides/watch-decisions-onchain",
  "/docs/reference/mandate-vault",
  "/docs/reference/adapters",
  "/docs/reference/agent-configuration",
  "/docs/reference/agent-scripts",
  "/docs/reference/base-addresses",
  "/docs/reference/default-parameters",
];

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

for (const width of WIDTHS) {
  for (const path of PAGES) {
    test(`${path} fits ${width}px: no page scroll, no console errors`, async ({ page }) => {
      const errors = collectErrors(page);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      // Text in a docs diagram must fit its card; page scroll cannot see this. The li itself is skipped: its arrow sits in the gap.
      const overflowingText = await page.evaluate(
        () => [...document.querySelectorAll("figure ol li p")].filter((p) => p.scrollWidth > p.clientWidth).length,
      );
      expect(overflowingText).toBe(0);
      await page.screenshot({ path: `test-results/screens/docs${path.replace(/\//g, "-")}-${width}.png`, fullPage: true });
      expect(errors).toEqual([]);
    });
  }
}

/** Opens search the way a reader does. Playwright sends "K" for "Control+K"; a real Ctrl+K sends "k", which Fumadocs matches. */
async function openSearch(page: Page) {
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("search", () => {
  test("Ctrl+K opens it and \"maat\" finds the docs home", async ({ page }) => {
    await page.goto("/docs");
    const dialog = await openSearch(page);
    await dialog.getByRole("combobox").fill("maat");
    // Every other result's breadcrumb starts with "Maat docs" (the FAQ one comes first), so a name match is not enough.
    // Fumadocs gives each result the id fd-search-option-<url>, so this is the result for the /docs page itself.
    await dialog.locator('[role="option"][id="fd-search-option-/docs"]').click();
    await expect(page).toHaveURL(/\/docs$/);
  });

  test("a query with no match shows the empty state", async ({ page }) => {
    await page.goto("/docs");
    const dialog = await openSearch(page);
    await dialog.getByRole("combobox").fill("zzzzqqq");
    await expect(dialog.getByRole("status").filter({ hasText: "No results" })).toHaveText(
      'No results for "zzzzqqq". Try a reason code like MARKET_CLOSED.',
    );
  });

  test("a slow index shows the loading state, then the results", async ({ page }) => {
    await page.route("**/api/search**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    await page.goto("/docs");
    const dialog = await openSearch(page);
    await dialog.getByRole("combobox").fill("maat");
    await expect(dialog.getByRole("status").filter({ hasText: "Searching..." })).toBeVisible();
    await expect(dialog.getByRole("option", { name: /Maat docs/ }).first()).toBeVisible();
  });

  test("an index that cannot load shows the error state, not a spinner", async ({ page }) => {
    await page.route("**/api/search**", (route) => route.abort());
    await page.goto("/docs");
    const dialog = await openSearch(page);
    await dialog.getByRole("combobox").fill("maat");
    await expect(dialog.getByRole("alert")).toContainText("Search is unavailable. Check your connection and try again.");
    await expect(dialog.getByText("Searching...")).toHaveCount(0);

    // Back online: "Try again" downloads the index again and the results come back.
    await page.unroute("**/api/search**");
    await dialog.getByRole("button", { name: "Try again" }).click();
    await expect(dialog.getByRole("option", { name: /Maat docs/ }).first()).toBeVisible();
  });

  test("the search index loads on the first search, not with the page", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/search")) requested.push(request.url());
    });
    await page.goto("/docs", { waitUntil: "networkidle" });
    expect(requested).toEqual([]);
    const dialog = await openSearch(page);
    await dialog.getByRole("combobox").fill("maat");
    await expect(dialog.getByRole("option", { name: /Maat docs/ }).first()).toBeVisible();
    expect(requested.length).toBeGreaterThan(0);
  });
});

test("the 404 page offers search and the docs sections", async ({ page }) => {
  for (const path of ["/does-not-exist", "/docs/does-not-exist"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page does not exist.");
    await expect(page.getByRole("link", { name: "Maat docs" })).toHaveAttribute("href", "/docs");
  }
  await page.locator("button[data-search-full]").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox").fill("maat");
  await expect(dialog.getByRole("option", { name: /Maat docs/ }).first()).toBeVisible();
});

test.describe("copy", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("Copy page as Markdown copies the page with its facts filled in", async ({ page }) => {
    // networkidle: the button only works once the page has hydrated.
    await page.goto("/docs", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Copy page as Markdown" }).click();
    await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Copied" })).toHaveText("Copied");
    // The Windows clipboard stores line breaks as CRLF.
    const text = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n");
    expect(text).toMatch(/^# Maat docs\n\nURL: https?:\/\/[^\n]+\/docs\n/);
    expect(text).toContain(`passes ${FACT_TEXT.checksPerTrade.text} checks`);
    expect(text).not.toContain("<Fact");
  });

  test("Copy page as Markdown says so when the file cannot load", async ({ page }) => {
    await page.route("**/md/**", (route) => route.abort());
    await page.goto("/docs", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Copy page as Markdown" }).click();
    await expect(page.getByRole("button", { name: "Copy failed. Try again" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Copy failed. Try again" })).toHaveText("Copy failed. Try again");
  });
});

test("the theme toggles and persists across a reload", async ({ page }) => {
  await page.goto("/docs");
  const html = page.locator("html");
  await expect(html).not.toHaveClass(/\bdark\b/);
  await page.locator("[data-theme-toggle]").first().click();
  await expect(html).toHaveClass(/\bdark\b/);
  await page.reload();
  await expect(html).toHaveClass(/\bdark\b/);
  // A single "d" keypress must not flip the theme back (Fumadocs' hotkey is off).
  await page.locator("body").press("d");
  await expect(html).toHaveClass(/\bdark\b/);
});

test("dark docs do not reach the landing page", async ({ page }) => {
  await page.goto("/docs");
  await page.locator("[data-theme-toggle]").first().click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await page.goto("/");
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(255, 255, 255)");
});

test("at 360px the sidebar drawer opens and closes by keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/docs");
  // The drawer has its own copy of the button; the one in the page header opens it.
  const header = page.locator("#nd-subnav");
  const open = header.getByRole("button", { name: "Open Sidebar" });
  const drawer = page.locator("#nd-sidebar-mobile");
  await open.focus();
  await page.keyboard.press("Enter");
  await expect(drawer).toHaveAttribute("data-state", "open");
  await expect(drawer.getByRole("link", { name: "Maat docs" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveAttribute("data-state", "closed");
  // Focus goes back to the button that opened the drawer.
  await expect(header.getByRole("button", { name: "Open Sidebar" })).toBeFocused();
});

test.describe("concept pages", () => {
  test("\"nine\" lists The nine checks first", async ({ page }) => {
    await page.goto("/docs");
    const dialog = await openSearch(page);
    await dialog.getByRole("combobox").fill("nine");
    await expect(dialog.getByRole("option").first()).toContainText("The nine checks");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/docs\/concepts\/nine-checks$/);
  });

  test("a reason code finds its entry first", async ({ page }) => {
    await page.goto("/docs");
    const dialog = await openSearch(page);
    await dialog.getByRole("combobox").fill("MARKET_CLOSED");
    await expect(dialog.getByRole("option").first()).toContainText(/Refusal codes|MARKET_CLOSED/);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/docs\/concepts\/refusal-codes(#market_closed)?$/);
  });

  test("a deep link loaded cold scrolls to its heading", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/docs/concepts/nine-checks#why-the-order-matters");
    await expect(page.locator("#why-the-order-matters")).toBeInViewport();
    await context.close();
  });

  test.describe("copy", () => {
    test.use({ permissions: ["clipboard-read", "clipboard-write"] });

    test("the copy button on a code block copies the code", async ({ page }) => {
      await page.goto("/docs/concepts/nine-checks", { waitUntil: "networkidle" });
      const figure = page.locator("figure").filter({ has: page.locator("pre", { hasText: "function checkMarket" }) });
      await figure.hover();
      await figure.getByRole("button", { name: /copy/i }).click();
      const text = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n");
      expect(text.trim()).toMatch(/^function checkMarket\(MarketCheck memory c\)/);
    });
  });
});

test.describe("contract reference", () => {
  test("a function name finds its entry first", async ({ page }) => {
    await page.goto("/docs");
    const dialog = await openSearch(page);
    await dialog.getByRole("combobox").fill("queueMandate");
    await expect(dialog.getByRole("option").first()).toContainText(/MandateVault|queueMandate/);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/docs\/reference\/mandate-vault(#queuemandate)?$/);
  });

  test("a deep link to a function, loaded cold, scrolls to it", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/docs/reference/mandate-vault#queuemandate");
    await expect(page.locator("#queuemandate")).toBeInViewport();
    await context.close();
  });
});

test("a setting name finds its entry first", async ({ page }) => {
  await page.goto("/docs");
  const dialog = await openSearch(page);
  await dialog.getByRole("combobox").fill("MAAT_MODE");
  await expect(dialog.getByRole("option").first()).toContainText(/Agent configuration|MAAT_MODE/);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/docs\/reference\/agent-configuration(#maat_mode)?$/);
});
