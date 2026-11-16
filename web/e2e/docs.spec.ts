import { expect, type Locator, type Page, test } from "@playwright/test";
import { FACT_TEXT } from "../lib/docs/fact-text";

const WIDTHS = [360, 768, 1024, 1440, 1920] as const;
/** Pages checked at every width: the docs home, then the longest pages as they ship (Tasks 8, 13, 14, 15, 16, 17 and 18). */
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
  "/docs/security/model",
  "/docs/security/threat-model",
  "/docs/security/not-claimed",
  "/docs/security/testing",
  "/docs/security/report-a-vulnerability",
  "/docs/help/troubleshooting",
  "/docs/help/changelog",
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

/** The characters on the first line of the page's first body paragraph, as the browser wrapped them. */
async function firstLineLength(page: Page): Promise<number> {
  return page.evaluate(() => {
    const paragraph = document.querySelector("#nd-page .prose > p");
    if (!paragraph) throw new Error("the page has no body paragraph");
    const range = document.createRange();
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    let top: number | undefined;
    let count = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (let i = 0; i < (node.textContent ?? "").length; i++) {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        // A space where the line breaks may have no box of its own.
        const box = range.getClientRects()[0];
        if (!box) continue;
        top ??= box.top;
        if (box.top > top + box.height / 2) return count;
        count++;
      }
    }
    return count;
  });
}

test.describe("reading comfort", () => {
  for (const width of [1440, 1920] as const) {
    test(`at ${width}px a body line holds about 72 characters, and callouts and tables keep the full column`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/docs/guides/deploy-your-own-vault");
      await page.evaluate(() => document.fonts.ready);
      const length = await firstLineLength(page);
      expect(length).toBeGreaterThanOrEqual(64);
      expect(length).toBeLessThanOrEqual(80);
      const widths = await page.evaluate(() => {
        const width = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().width;
        return {
          column: width("#nd-page .prose"),
          callout: width("#nd-page .prose > [data-callout]"),
          table: width("#nd-page .prose > div:has(> table)"),
        };
      });
      expect(widths.column).toBeGreaterThan(0);
      expect(widths.callout).toBe(widths.column);
      expect(widths.table).toBe(widths.column);
    });

    test(`at ${width}px the docs home's router cards, a component, keep the full column`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/docs");
      const widths = await page.evaluate(() => {
        const width = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().width;
        return { column: width("#nd-page .prose"), router: width('#nd-page .prose > [aria-label="Where to start"]') };
      });
      expect(widths.column).toBeGreaterThan(0);
      expect(widths.router).toBe(widths.column);
    });
  }

  // The site chrome each layout shows on screen. A4 paper lays out at about 718 to 794 CSS px, below Fumadocs' md
  // breakpoint, so a printout gets the mobile header and the "On this page" bar, not the sidebar and the TOC.
  for (const { width, shown } of [
    { width: 1440, shown: ["#nd-sidebar", "#nd-toc", "button[data-search-full]"] },
    { width: 718, shown: ["#nd-subnav", "#nd-subnav [data-search]", "[data-toc-popover]"] },
  ]) {
    test(`a printed runbook at ${width}px shows the article only, with every command line wrapped and link targets spelled out`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/docs/guides/deploy-your-own-vault", { waitUntil: "networkidle" });
      // Visible on screen at this width, so only the print rules can hide it.
      for (const selector of shown) await expect(page.locator(selector)).toBeVisible();
      await page.emulateMedia({ media: "print" });
      const article = page.locator("#nd-page");
      for (const chrome of [
        page.locator("#nd-sidebar"),
        page.locator("#nd-subnav"),
        page.locator("#nd-subnav [data-search]"),
        page.locator("#nd-toc"),
        page.locator("[data-toc-popover]"),
        page.locator("button[data-search-full]"),
        article.locator('nav[aria-labelledby="read-next"]'),
        article.locator('[aria-labelledby="page-helpful"]'),
        article.getByRole("button", { name: "Copy page as Markdown" }),
        article.locator("figure").first().getByRole("button", { name: "Copy Text" }),
        // Fumadocs' previous and next cards.
        article.locator("a:has(> div > svg.lucide-chevron-left)"),
        article.locator("a:has(> div > svg.lucide-chevron-right)"),
      ]) {
        await expect(chrome).toBeHidden();
      }
      await expect(article.locator(".prose")).toBeVisible();
      await expect(article.getByRole("heading", { level: 1 })).toBeVisible();
      const layout = await page.evaluate(() => {
        const regions = [...document.querySelectorAll("#nd-page figure [role=region]")];
        const external = document.querySelector<HTMLAnchorElement>('#nd-page .prose a[href^="https://"]');
        return {
          articleWidth: document.querySelector("#nd-page")?.getBoundingClientRect().width,
          pageWidth: document.documentElement.clientWidth,
          codeBlocks: regions.length,
          clipped: regions.filter((r) => r.scrollWidth > r.clientWidth || r.scrollHeight > r.clientHeight).length,
          unwrapped: regions.filter((r) => getComputedStyle(r.querySelector("pre") ?? r).whiteSpace !== "pre-wrap").length,
          externalHref: external?.getAttribute("href"),
          externalAfter: external ? getComputedStyle(external, "::after").content : undefined,
        };
      });
      expect(layout.articleWidth).toBe(layout.pageWidth);
      expect(layout.codeBlocks).toBeGreaterThan(0);
      expect(layout.clipped).toBe(0);
      expect(layout.unwrapped).toBe(0);
      expect(layout.externalHref).toBeTruthy();
      expect(layout.externalAfter).toContain(layout.externalHref);
    });
  }

  test("a web font that arrives after the first paint does not move the page", async ({ page }) => {
    // Lighthouse's mobile screen, where a reference page moved when Geist swapped in.
    await page.setViewportSize({ width: 412, height: 823 });
    await page.route("**/*.woff2", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    await page.addInitScript(() => {
      const w = window as unknown as { layoutShift: number };
      w.layoutShift = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
          if (!entry.hadRecentInput) w.layoutShift += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    // networkidle: both fonts have arrived.
    await page.goto("/docs/reference/mandate-vault", { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    // Two frames, so a shift from the last font is reported.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const shift = await page.evaluate(() => (window as unknown as { layoutShift: number }).layoutShift);
    expect(shift).toBeLessThan(0.01);
  });
});

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

  test("a query with no match shows the empty state, with the FAQ and the Glossary to browse", async ({ page }) => {
    await page.goto("/docs");
    const dialog = await openSearch(page);
    await dialog.getByRole("combobox").fill("zzzzqqq");
    const empty = dialog.getByRole("status").filter({ hasText: "No results" });
    await expect(empty).toHaveText('No results for "zzzzqqq". Try a reason code like MARKET_CLOSED, or browse the FAQ and the Glossary.');
    await expect(empty.getByRole("link", { name: "FAQ" })).toHaveAttribute("href", "/docs/help/faq");
    await empty.getByRole("link", { name: "Glossary" }).click();
    await expect(page).toHaveURL(/\/docs\/help\/glossary$/);
    await expect(dialog).toBeHidden();
  });

  test("the open dialog lists where to start before anything is typed", async ({ page }) => {
    await page.goto("/docs");
    const dialog = await openSearch(page);
    await expect(dialog.getByRole("option").first()).toHaveText("What is Maat");
    await expect(dialog.getByRole("option", { name: "Refusal codes" })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/docs\/get-started\/what-is-maat$/);
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

  test("the search index loads when search opens, not with the page", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/search")) requested.push(request.url());
    });
    await page.goto("/docs", { waitUntil: "networkidle" });
    expect(requested).toEqual([]);
    const dialog = await openSearch(page);
    // Before anything is typed: opening search is what starts the download.
    await expect.poll(() => requested.length).toBeGreaterThan(0);
    await dialog.getByRole("combobox").fill("maat");
    await expect(dialog.getByRole("option", { name: /Maat docs/ }).first()).toBeVisible();
  });

  test("pointing at or focusing the search button downloads nothing; opening search downloads the index once", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/search")) requested.push(request.url());
    });
    await page.goto("/docs", { waitUntil: "networkidle" });
    expect(requested).toEqual([]);
    const button = page.locator("button[data-search-full]");
    // A download would start inside the pointer or focus event; a second is ample time for its request to show.
    const early = page.waitForRequest(/\/api\/search/, { timeout: 1_000 }).then(
      () => true,
      () => false,
    );
    await button.hover();
    await button.focus();
    expect(await early).toBe(false);
    expect(requested).toEqual([]);
    await button.click();
    await expect.poll(() => requested).toEqual([expect.stringMatching(/\/api\/search\.json$/)]);
    await page.getByRole("dialog").getByRole("combobox").fill("maat");
    await expect(page.getByRole("dialog").getByRole("option", { name: /Maat docs/ }).first()).toBeVisible();
    expect(requested).toHaveLength(1);
  });
});

/**
 * The pages a search lists, in order, once its results are in: a page's own option has the page URL as its id, and a
 * heading, text or table row has that URL plus "-n". Undefined while the dialog still shows its start pages.
 */
async function resultPages(dialog: Locator): Promise<string[] | undefined> {
  const ids = await dialog.getByRole("option").evaluateAll((options) => options.map((o) => o.id.replace(/^fd-search-option-/, "")));
  if (!ids.some((id) => /-\d+$/.test(id))) return undefined;
  return ids.filter((id) => !/-\d+$/.test(id));
}

async function searchFor(page: Page, query: string) {
  await page.goto("/docs");
  const dialog = await openSearch(page);
  await dialog.getByRole("combobox").fill(query);
  return dialog;
}

test.describe("search finds what readers type", () => {
  for (const [query, url] of [
    ["deploy", "/docs/guides/deploy-your-own-vault"],
    ["split", "/docs/concepts/splits-and-multiplier"],
    ["timelock", "/docs/concepts/timelock-and-roles"],
    ["credit", "/docs/concepts/credit-and-health-factor"],
    // Values only a component prints: the AddressTable rows.
    ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "/docs/reference/base-addresses"],
    ["AAVE_RESERVE_USDC", "/docs/reference/base-addresses"],
  ] as const) {
    test(`"${query}" lists ${url} first`, async ({ page }) => {
      const dialog = await searchFor(page, query);
      await expect.poll(async () => (await resultPages(dialog))?.[0]).toBe(url);
    });
  }

  for (const [query, url] of [
    ["agent", "/docs/guides/run-the-agent"],
    ["reason code", "/docs/concepts/refusal-codes"],
    ["environment variables", "/docs/reference/agent-configuration"],
  ] as const) {
    test(`"${query}" lists ${url} in the first three pages`, async ({ page }) => {
      const dialog = await searchFor(page, query);
      await expect.poll(async () => (await resultPages(dialog))?.slice(0, 3)).toContain(url);
    });
  }

  test('"execute(Intent" finds the execute entry of MandateVault', async ({ page }) => {
    const dialog = await searchFor(page, "execute(Intent");
    await dialog.getByRole("option", { name: "execute", exact: true }).click();
    await expect(page).toHaveURL(/\/docs\/reference\/mandate-vault#execute$/);
  });

  test("the meaning of a reason, as its table prints it, finds Refusal codes and that row", async ({ page }) => {
    const dialog = await searchFor(page, "or the calendar can't be read");
    await expect.poll(async () => (await resultPages(dialog))?.[0]).toBe("/docs/concepts/refusal-codes");
    await expect(dialog.getByRole("option").filter({ hasText: "MARKET_CLOSED" }).filter({ hasText: "or the calendar can't be read" })).toBeVisible();
  });

  test("a word that appears only inside a code block finds nothing", async ({ page }) => {
    // The market-hours code excerpt calls DateLib.civilFromDays, and no prose on any page names it.
    const markdown = await (await page.request.get("/md/docs/concepts/market-hours.md")).text();
    expect(markdown).toContain("DateLib.civilFromDays(");
    const dialog = await searchFor(page, "civilFromDays");
    await expect(dialog.getByRole("status").filter({ hasText: "No results" })).toBeVisible();
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
    expect(text).toContain(`passes up to ${FACT_TEXT.checksPerTrade.text} checks`);
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
