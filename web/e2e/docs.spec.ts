import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { FACT_TEXT } from "../lib/docs/fact-text";
import { DOCS_IA } from "../lib/docs/ia";
import { SITE } from "../lib/site";

const WIDTHS = [360, 768, 1024, 1440, 1920] as const;
/**
 * Pages checked at every width: the docs home, the Reference section page (the one whose cards come in groups), then
 * the longest pages as they ship (Tasks 8, 13, 14, 15, 16, 17 and 18).
 */
const PAGES: string[] = [
  "/docs",
  "/docs/reference",
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

    test(`at ${width}px the docs home's router cards and section map, components, keep the full column`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/docs");
      const widths = await page.evaluate(() => {
        const width = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().width;
        return {
          column: width("#nd-page .prose"),
          router: width('#nd-page .prose > [aria-label="Where to start"]'),
          sections: width('#nd-page .prose > [data-section-index=""]'),
        };
      });
      expect(widths.column).toBeGreaterThan(0);
      expect(widths.router).toBe(widths.column);
      expect(widths.sections).toBe(widths.column);
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

  test("a page's description finds that page, and not the section page whose card repeats it", async ({ page }) => {
    // MarketCalendar's description, which the Reference page's card repeats; the Concepts card for Market hours shares words with it.
    const dialog = await searchFor(page, "holidays and early closes it ships with");
    await expect.poll(async () => (await resultPages(dialog))?.includes("/docs/reference/market-calendar")).toBe(true);
    const sectionPages = ["/docs", ...["get-started", "concepts", "guides", "reference", "security", "help"].map((dir) => `/docs/${dir}`)];
    expect((await resultPages(dialog))?.filter((url) => sectionPages.includes(url))).toEqual([]);
  });

  test("a word that appears only inside a code block finds nothing", async ({ page }) => {
    // The market-hours code excerpt calls DateLib.civilFromDays, and no prose on any page names it.
    const markdown = await (await page.request.get("/md/docs/concepts/market-hours.md")).text();
    expect(markdown).toContain("DateLib.civilFromDays(");
    const dialog = await searchFor(page, "civilFromDays");
    await expect(dialog.getByRole("status").filter({ hasText: "No results" })).toBeVisible();
  });
});

test.describe("sections", () => {
  const SECTIONS = [
    ["get-started", "Get started"],
    ["concepts", "Concepts"],
    ["guides", "Guides"],
    ["reference", "Reference"],
    ["security", "Security"],
    ["help", "Help"],
  ] as const;

  test("the docs home maps every section, and each one opens its own page", async ({ page }) => {
    await page.goto("/docs");
    const map = page.locator('#nd-page [data-section-index=""]');
    await expect(map.getByRole("link")).toHaveText(SECTIONS.map(([, title]) => title));
    for (const [dir, title] of SECTIONS) {
      await expect(map.getByRole("link", { name: title, exact: true })).toHaveAttribute("href", `/docs/${dir}`);
    }
    for (const [dir, title] of SECTIONS) {
      const response = await page.goto(`/docs/${dir}`);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
      await expect(page.locator(`#nd-page [data-section-index="${dir}"] li`).first()).toBeVisible();
    }
  });

  test("a page's breadcrumb links its section", async ({ page }) => {
    await page.goto("/docs/concepts/nine-checks");
    await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Concepts", exact: true }).click();
    await expect(page).toHaveURL(/\/docs\/concepts$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Concepts");
  });

  test("the sidebar and the Reference page show the same groups, with Refusal codes among the contracts", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/docs/reference");
    const sidebar = page.locator("#nd-sidebar");
    for (const group of ["Contracts", "Agent", "Data"]) await expect(sidebar.getByText(group, { exact: true })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Reference", exact: true })).toHaveAttribute("href", "/docs/reference");
    const index = page.locator('#nd-page [data-section-index="reference"]');
    await expect(index.getByRole("heading", { level: 2 })).toHaveText(["Contracts", "Agent", "Data"]);
    await expect(index.getByRole("link", { name: "Refusal codes", exact: true })).toHaveAttribute("href", "/docs/concepts/refusal-codes");
  });

  test("the docs home's Markdown copy lists the sections", async ({ page }) => {
    const markdown = await (await page.request.get("/md/docs.md")).text();
    for (const [dir, title] of SECTIONS) expect(markdown).toMatch(new RegExp(`^- \\[${title}\\]\\(https?://[^)]+/docs/${dir}\\): .{50,}$`, "m"));
  });
});

test.describe("previous and next", () => {
  const iaPage = new Map(DOCS_IA.flatMap((s) => s.pages).map((p) => [p.slug, p]));

  // Reference lists Refusal codes as a link to its Concepts page. Paging on from Types must stay in Reference, and the
  // Concepts page must keep its own neighbours.
  for (const [slug, previous, next] of [
    ["reference/types", "reference/errors", "reference/market-calendar"],
    ["reference/market-calendar", "reference/types", "reference/adapters"],
    ["concepts/refusal-codes", "concepts/nine-checks", "concepts/market-hours"],
  ] as const) {
    test(`${slug} pages back to ${previous} and on to ${next}, each card with its page's description`, async ({ page }) => {
      await page.goto(`/docs/${slug}`);
      for (const [side, target] of [
        ["left", previous],
        ["right", next],
      ] as const) {
        const card = page.locator(`#nd-page a:has(> div > svg.lucide-chevron-${side})`);
        const want = iaPage.get(target);
        await expect(card).toHaveAttribute("href", `/docs/${target}`);
        await expect(card.locator("p")).toHaveText([want?.title ?? target, want?.description ?? target]);
      }
    });
  }
});

test.describe("page frame", () => {
  /** The URL of a page from its IA slug: a folder's index.mdx is served at the folder's URL. */
  const urlOf = (slug: string) => `/docs/${slug}`.replace(/\/index$/, "");

  test("the status label links to what the labels mean, and the status page's own table keeps plain labels", async ({ page }) => {
    await page.goto("/docs/concepts/nine-checks");
    const link = page.locator("#nd-page header").getByRole("link", { name: "Status: Fork-tested. What this label means", exact: true });
    await expect(link).toHaveAccessibleDescription(
      "Built and tested; the contracts and the send path have run on a Base mainnet fork; not deployed.",
    );
    // Hidden, not visually hidden: a screen reader reads the meaning once, as the link's description, not again as text.
    await expect(page.locator("#status-meaning")).toBeHidden();
    await link.click();
    await expect(page).toHaveURL(/\/docs\/get-started\/status#what-the-three-labels-mean$/);
    const table = page.locator("#nd-page .prose [data-status]");
    await expect(table).toHaveCount(3);
    expect(await table.evaluateAll((labels) => labels.filter((label) => label.closest("a")).length)).toBe(0);
  });

  test("the status label shows it is a link: an info mark at rest, and the hover highlight on keyboard focus", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/docs/concepts/nine-checks");
    const header = page.locator("#nd-page header");
    const link = header.getByRole("link", { name: "Status: Fork-tested. What this label means", exact: true });
    const label = link.locator("[data-status]");
    await expect(link.locator('svg[aria-hidden="true"]')).toBeVisible();
    const style = () => label.evaluate((el) => ({ background: getComputedStyle(el).backgroundColor, line: getComputedStyle(el).textDecorationLine }));
    const rest = await style();
    await link.hover();
    const hovered = await style();
    expect(hovered).not.toEqual(rest);
    await page.mouse.move(0, 0);
    expect(await style()).toEqual(rest);
    // Tab to it from the breadcrumb, the link before it.
    await header.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link").last().focus();
    await page.keyboard.press("Tab");
    await expect(link).toBeFocused();
    expect(await style()).toEqual(hovered);
  });

  test("only the docs home and the Help pages go without a status label, and only the home without a review date", async ({ page }) => {
    // What get-started/status says under "What the three labels mean" and "How this page stays honest".
    for (const { slug } of DOCS_IA.flatMap((s) => s.pages)) {
      await page.goto(urlOf(slug), { waitUntil: "domcontentloaded" });
      const header = page.locator("#nd-page header").first();
      const labelled = slug !== "index" && !slug.startsWith("help/");
      await expect(header.locator("[data-status]"), slug).toHaveCount(labelled ? 1 : 0);
      await expect(header.getByText(/^Last reviewed/), slug).toHaveCount(slug === "index" ? 0 : 1);
    }
  });

  test("the Help pages carry no status label", async ({ page }) => {
    const help = DOCS_IA.find((s) => s.dir === "help")?.pages ?? [];
    expect(help.length).toBeGreaterThan(0);
    for (const { slug } of help) {
      await page.goto(urlOf(slug));
      const header = page.locator("#nd-page header");
      await expect(header.getByRole("list", { name: "Written for" }), slug).toBeVisible();
      await expect(header.locator("[data-status]"), slug).toHaveCount(0);
    }
  });

  test("the docs home is its H1 and lede, without breadcrumb, labels, reading time, Read next or previous and next", async ({ page }) => {
    await page.goto("/docs");
    await expect(page).toHaveTitle(`${SITE.name} Docs`);
    const article = page.locator("#nd-page");
    await expect(article.getByRole("heading", { level: 1 })).toHaveText("Maat docs");
    for (const absent of [
      article.getByRole("navigation", { name: "Breadcrumb" }),
      article.locator("[data-status]"),
      article.getByRole("list", { name: "Written for" }),
      article.getByText(/min read|Last reviewed/),
      article.locator('nav[aria-labelledby="read-next"]'),
      article.locator("a:has(> div > svg.lucide-chevron-left), a:has(> div > svg.lucide-chevron-right)"),
    ]) {
      await expect(absent).toHaveCount(0);
    }
    // It keeps its sources and the feedback, edit and copy row.
    await expect(article.getByRole("complementary", { name: "Source of truth" })).toBeVisible();
    await expect(article.getByRole("button", { name: "Copy page as Markdown" })).toBeVisible();
  });

  /** The ids of the article's headings that are not part of the page's body: the blocks the page frame adds. */
  const frameHeadings = (article: Locator) => article.locator("h2").evaluateAll((hs) => hs.filter((h) => !h.closest(".prose")).map((h) => h.id));

  test("a guide with its own Next steps goes on from its body to Source of truth, then the previous and next cards", async ({ page }) => {
    await page.goto("/docs/guides/deploy-your-own-vault");
    const article = page.locator("#nd-page");
    await expect(article.locator(".prose h2#next-steps")).toHaveCount(1);
    // Next steps is the body's last section (docs spec §4.2), so nothing comes between it and Source of truth.
    await expect(article.locator(".prose h2").last()).toHaveId("next-steps");
    expect(await frameHeadings(article)).toEqual(["source-of-truth"]);
    await expect(article.locator('nav[aria-labelledby="read-next"]')).toHaveCount(0);
    const cardsFollowSources = await page.evaluate(() => {
      const sources = document.querySelector("#nd-page #source-of-truth");
      const card = document.querySelector("#nd-page a:has(> div > svg.lucide-chevron-right)");
      return Boolean(sources && card && sources.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(cardsFollowSources).toBe(true);
  });

  for (const path of ["/docs/get-started/quickstart", "/docs/get-started/status"]) {
    test(`${path}, with no list of its own, shows Read next before Source of truth, and not in a printout`, async ({ page }) => {
      await page.goto(path);
      const article = page.locator("#nd-page");
      const readNext = article.getByRole("navigation", { name: "Read next" });
      await expect(readNext.getByRole("link").first()).toBeVisible();
      expect(await frameHeadings(article)).toEqual(["read-next", "source-of-truth"]);
      await page.emulateMedia({ media: "print" });
      await expect(readNext).toBeHidden();
    });
  }

  test("the glossary's contents list the terms, not the letters that group them", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/docs/help/glossary");
    const terms = await page.locator("#nd-page .prose h3").count();
    expect(terms).toBeGreaterThan(0);
    // The letters stay on the page as headings.
    await expect(page.locator("#nd-page .prose h2#a")).toHaveCount(1);
    const entries = page.locator('#nd-toc a[href^="#"]');
    await expect(entries).toHaveCount(terms);
    await expect(entries.first()).toHaveText("Aave V4");
  });

  test("every docs page's head links its Markdown copy", async ({ request }) => {
    for (const { slug } of DOCS_IA.flatMap((s) => s.pages)) {
      const html = await (await request.get(urlOf(slug))).text();
      const links = [...html.matchAll(/<link [^>]*>/g)].map(([tag]) => tag).filter((tag) => tag.includes('type="text/markdown"'));
      expect(links, slug).toHaveLength(1);
      expect(links[0], slug).toContain('rel="alternate"');
      const href = /href="([^"]+)"/.exec(links[0] ?? "")?.[1] ?? "";
      expect(new URL(href).pathname, slug).toBe(`/md${urlOf(slug)}.md`);
      expect((await request.get(new URL(href).pathname)).status(), slug).toBe(200);
    }
  });

  test("the image a shared link shows is named", async ({ page }) => {
    await page.goto("/docs/concepts/nine-checks");
    await expect(page.locator('head meta[property="og:image:alt"]')).toHaveAttribute("content", SITE.name);
    await expect(page.locator('head meta[name="twitter:image:alt"]')).toHaveAttribute("content", SITE.name);
  });

  test("every docs page ends with the MIT License and the site's disclaimer, once, on a phone and in a printout too", async ({ page }) => {
    for (const path of ["/docs", "/docs/guides/deploy-your-own-vault"]) {
      for (const width of [1440, 360]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(path);
        // Below the feedback, edit and copy row, as the landing page's footer closes the landing page.
        const footer = page.locator("#nd-page > footer");
        await expect(footer.getByRole("link", { name: "MIT License", exact: true }), `${path} at ${width}`).toHaveAttribute("href", SITE.licenseUrl);
        await expect(footer.getByText(SITE.disclaimer, { exact: true }), `${path} at ${width}`).toBeVisible();
        await expect(page.getByText(SITE.disclaimer, { exact: true }), `${path} at ${width}`).toHaveCount(1);
        const afterRow = await page.evaluate(() => {
          const row = document.querySelector('#nd-page [aria-labelledby="page-helpful"]');
          const end = document.querySelector("#nd-page > footer");
          return Boolean(row && end && row.compareDocumentPosition(end) & Node.DOCUMENT_POSITION_FOLLOWING);
        });
        expect(afterRow, `${path} at ${width}`).toBe(true);
      }
      await page.emulateMedia({ media: "print" });
      await expect(page.locator("#nd-page > footer").getByText(SITE.disclaimer, { exact: true }), `${path} printed`).toBeVisible();
      await page.emulateMedia({ media: "screen" });
    }
  });
});

test.describe("build commit and line links", () => {
  const urlOf = (slug: string) => `/docs/${slug}`.replace(/\/index$/, "");
  const slugs = DOCS_IA.flatMap((s) => s.pages).map((p) => p.slug);
  const tests = JSON.parse(readFileSync("content/generated/tests.json", "utf8")) as Record<string, Record<string, number>>;

  test("every page names the commit it was built from in its Source of truth box and its footer, and llms-full.txt names it first", async ({
    page,
    request,
  }) => {
    // The stamp the build wrote, read back from out/ rather than worked out again now: HEAD may have moved since the
    // build. A local build's stamp has no link, since its commit may never have been pushed.
    const first = (await (await request.get("/llms-full.txt")).text()).split("\n")[0] ?? "";
    const [, sha = "", changes = ""] = /^Built from commit `([0-9a-f]{7,40})`(, with uncommitted changes)?\.$/.exec(first) ?? [];
    expect(sha, `llms-full.txt opens with the stamp, not "${first}"`).not.toBe("");
    expect(() => execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { stdio: "ignore" }), `${sha} is a commit`).not.toThrow();
    const tail = `${changes}.`;
    for (const slug of slugs) {
      // React separates the text from the sha with an empty comment; the sha is in its own <code>.
      const html = await (await request.get(urlOf(slug))).text();
      const stamps = [...html.matchAll(/Built from commit(?:<!-- -->)? (?:<a [^>]*>)?<code[^>]*>([^<]*)<\/code>(?:<\/a>)?([^<]*)<\/p>/g)];
      expect(
        stamps.map((m) => `${m[1]}${m[2]}`),
        slug,
      ).toEqual([`${sha}${tail}`, `${sha}${tail}`]);
    }
    const stamp = `Built from commit ${sha}${tail}`;
    await page.goto("/docs/guides/run-the-agent");
    const article = page.locator("#nd-page");
    await expect(article.getByRole("complementary", { name: "Source of truth" }).getByText(stamp, { exact: true })).toBeVisible();
    await expect(article.locator('div:has(> [aria-labelledby="page-helpful"])').getByText(stamp, { exact: true })).toBeVisible();
    await expect(article.getByRole("link", { name: sha })).toHaveCount(0);
  });

  test("a long Source of truth list opens from a summary that counts its files, and a printout lists them", async ({ page }) => {
    await page.goto("/docs/guides/run-the-agent");
    const box = page.locator("#nd-page").getByRole("complementary", { name: "Source of truth" });
    const summary = box.locator("details > summary");
    await expect(summary).toHaveText(/^Source of truth \(\d+ files\)$/);
    const files = Number(/\((\d+) files\)/.exec((await summary.textContent()) ?? "")?.[1]);
    expect(files).toBeGreaterThan(5);
    await expect(box.locator("details li a").first()).toBeHidden();
    await page.emulateMedia({ media: "print" });
    await expect(box.locator("details li a").last()).toBeVisible();
    await page.emulateMedia({ media: "screen" });
    await expect(box.locator("details li a").first()).toBeHidden();
    await summary.click();
    await expect(box.locator("details li a")).toHaveCount(files);
    await expect(box.locator("details li a").first()).toBeVisible();
  });

  test("every excerpt title links its lines on main", async ({ request }) => {
    let excerpts = 0;
    for (const slug of slugs) {
      const html = await (await request.get(urlOf(slug))).text();
      for (const [, inner = ""] of html.matchAll(/<figcaption class="flex-1 truncate">([\s\S]*?)<\/figcaption>/g)) {
        const title = inner.replace(/<[^>]+>/g, "");
        if (!/#L\d+-L\d+$/.test(title)) continue;
        excerpts++;
        expect(/^<a [^>]*href="([^"]+)"/.exec(inner)?.[1], `${slug}: ${title}`).toBe(`${SITE.repoUrl}/blob/main/${title}`);
      }
    }
    expect(excerpts).toBeGreaterThan(0);
  });

  test("on a phone an excerpt title's link is a 44 px tap target", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/docs/security/testing");
    const links = page.locator("#nd-page figcaption > a");
    expect(await links.count()).toBeGreaterThan(0);
    for (const link of await links.all()) {
      const title = (await link.textContent()) ?? "";
      const box = await link.boundingBox();
      expect(box?.height, title).toBeGreaterThanOrEqual(44);
      // The title bar grows with it, so the link does not spill over the code.
      const bar = await link.locator("xpath=../..").boundingBox();
      expect(bar?.height, `${title}: title bar`).toBeGreaterThanOrEqual(box?.height ?? Infinity);
    }
  });

  test("a test name links the line its test starts on, on the page and in the Markdown copy", async ({ page, request }) => {
    const line = tests["contracts/test/MandateVault.t.sol"]?.test_replayReverts;
    const href = `${SITE.repoUrl}/blob/main/contracts/test/MandateVault.t.sol#L${line}`;
    await page.goto("/docs/security/model");
    await expect(page.locator("#nd-page .prose").getByRole("link", { name: "test_replayReverts", exact: true }).first()).toHaveAttribute("href", href);
    expect(await (await request.get("/md/docs/security/model.md")).text()).toContain(`[\`test_replayReverts\`](${href})`);
    // No test-name link on any page still opens the top of its file.
    const unanchored: string[] = [];
    for (const slug of slugs) {
      const html = await (await request.get(urlOf(slug))).text();
      for (const [, url = "", name] of html.matchAll(/<a [^>]*href="([^"]+)"[^>]*><code>(test_\w+)<\/code><\/a>/g)) {
        if (!/#L\d+$/.test(url)) unanchored.push(`${slug}: ${name} -> ${url}`);
      }
    }
    expect(unanchored).toEqual([]);
  });

  test("View as Markdown opens the page's Markdown copy", async ({ page }) => {
    await page.goto("/docs/concepts/nine-checks");
    await page.getByRole("link", { name: "View as Markdown" }).click();
    await expect(page).toHaveURL(/\/md\/docs\/concepts\/nine-checks\.md$/);
    await expect(page.locator("body")).toContainText("# The nine checks");
  });
});

test.describe("files for tools", () => {
  test("llms.txt gives the status and links every page's Markdown copy, which opens with the index and keeps its page's status and sources", async ({
    request,
  }) => {
    const llms = await (await request.get("/llms.txt")).text();
    expect(llms).toMatch(/^> .+\n\nStatus: built and fork-tested\. Nothing is deployed to Base mainnet, the contracts are unaudited, /m);
    const copies = [...llms.matchAll(/^- \[[^\]]+\]\((https?:\/\/[^)]+\/md\/docs[^)]*\.md)\): .*Web page: (\S+)$/gm)];
    expect(copies).toHaveLength(DOCS_IA.flatMap((s) => s.pages).length);
    for (const [, md = "", web] of copies) {
      const response = await request.get(new URL(md).pathname);
      expect(response.status(), md).toBe(200);
      const text = await response.text();
      expect(text, md).toMatch(/^> Index of every page: \[llms\.txt\]/);
      expect(text, md).toContain(`\nURL: ${web}\n`);
    }
    const nine = await (await request.get("/md/docs/concepts/nine-checks.md")).text();
    expect(nine).toMatch(/\nURL: [^\n]+\n\nStatus: Fork-tested\. Built and tested; [^\n]+; not deployed\. Last reviewed: \d{4}-\d{2}-\d{2}\.\n/);
    expect(nine).toContain(`\n## Source of truth\n`);
    expect(nine).toContain(`(${SITE.repoUrl}/blob/main/contracts/src/GuardLib.sol)`);
    // llms-full.txt is every page already, so no page in it repeats the note.
    expect(await (await request.get("/llms-full.txt")).text()).not.toContain("> Index of every page:");
  });

  test("the MandateVault page links its ABI as JSON: the agent's own mandateVaultAbi, with where it comes from", async ({ page, request }) => {
    await page.goto("/docs/reference/mandate-vault");
    const link = page.locator("#nd-page .prose").getByRole("link", { name: "ABI (JSON)", exact: true });
    await expect(link).toHaveAttribute("href", "/data/abi/MandateVault.json");
    const response = await request.get("/data/abi/MandateVault.json");
    expect(response.headers()["content-type"]).toContain("application/json");
    const file = (await response.json()) as { source: string; note: string; abi: { type: string; name?: string }[] };
    expect(Object.keys(file)).toEqual(["source", "note", "abi"]);
    expect(file.source).toContain("agent/src/abi/generated.ts");
    expect(file.note).toContain("not deployed");
    expect(file.abi.some((e) => e.type === "function" && e.name === "execute")).toBe(true);
  });
});

test.describe("glossary previews", () => {
  const WHAT_IS_MAAT = "/docs/get-started/what-is-maat";
  /** The first link in the page's body to a glossary entry. */
  const termOf = (page: Page, id: string) => page.locator(`#nd-page .prose a[href="/docs/help/glossary#${id}"]`).first();
  /** The preview a term opens: the element its aria-describedby names. */
  async function previewOf(term: Locator): Promise<Locator> {
    const id = await term.getAttribute("aria-describedby");
    expect(id, "the term names its preview").toBeTruthy();
    return term.page().locator(`[id="${id}"]`);
  }
  /** The CDP Server Wallet entry's last sentence, its status. */
  const CDP_STATUS = "has never run against the real CDP";
  /** Whether these words of a preview are inside the part of it the window shows. */
  const inView = (preview: Locator, words: string) =>
    preview.evaluate((el, w) => {
      const box = el.getBoundingClientRect();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.textContent?.indexOf(w) ?? -1;
        if (at === -1) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + w.length);
        const r = range.getBoundingClientRect();
        return r.top >= box.top && r.bottom <= box.bottom && r.bottom <= window.innerHeight;
      }
      return false;
    }, words);
  /** An entry as the glossary page shows it, without the trailing "See …" sentence that points to the page about it. */
  async function entryWithoutPointer(page: Page, id: string): Promise<string> {
    await page.goto("/docs/help/glossary");
    const text = (await page.locator(`#nd-page .prose h3[id="${id}"] + p`).innerText()).replace(/\s+/g, " ").trim();
    const at = text.lastIndexOf(". See ");
    return at === -1 ? text : text.slice(0, at + 1);
  }

  test("pointing at B20 on What is Maat shows its whole entry, Escape closes it, and a click opens the entry", async ({ page }) => {
    const b20 = await entryWithoutPointer(page, "b20");
    // Its second sentence, which a preview cut to the first would lose.
    expect(b20).toContain("and the vault reads all three before it trades.");
    await page.goto(WHAT_IS_MAAT, { waitUntil: "networkidle" });
    const term = termOf(page, "b20");
    const preview = await previewOf(term);
    await expect(preview).toBeHidden();
    await term.hover();
    await expect(preview).toBeVisible();
    await expect(preview).toHaveRole("tooltip");
    await expect(preview).toHaveText(b20);
    await expect(term).toHaveAccessibleDescription(b20);
    await page.keyboard.press("Escape");
    await expect(preview).toBeHidden();
    await term.click();
    await expect(page).toHaveURL(/\/docs\/help\/glossary#b20$/);
  });

  test("a term previews on keyboard focus, and Escape or moving focus on closes it", async ({ page }) => {
    const b20 = await entryWithoutPointer(page, "b20");
    const cdp = await entryWithoutPointer(page, "cdp-server-wallet");
    // The status of the term is in its last sentence.
    expect(cdp).toContain("has never run against the real CDP");
    await page.goto(WHAT_IS_MAAT, { waitUntil: "networkidle" });
    const first = termOf(page, "b20");
    await first.focus();
    await expect(await previewOf(first)).toBeVisible();
    await expect(await previewOf(first)).toHaveText(b20);
    // The pointer resting on another term shows that term's preview instead. Once it leaves, the focused term's comes back.
    const base = termOf(page, "base");
    await base.hover();
    await expect(await previewOf(base)).toBeVisible();
    await expect(await previewOf(first)).toBeHidden();
    await page.mouse.move(0, 0);
    await expect(await previewOf(base)).toBeHidden();
    await expect(await previewOf(first)).toBeVisible();
    await expect(first).toBeFocused();
    const term = termOf(page, "cdp-server-wallet");
    const preview = await previewOf(term);
    await term.focus();
    await expect(await previewOf(first)).toBeHidden();
    await expect(preview).toBeVisible();
    await expect(preview).toHaveText(cdp);
    await page.keyboard.press("Escape");
    await expect(preview).toBeHidden();
    await expect(term).toBeFocused();
    // Dismissed, it stays closed after the pointer passes over another term and leaves.
    const fork = termOf(page, "fork-test");
    await fork.hover();
    await expect(await previewOf(fork)).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(await previewOf(fork)).toBeHidden();
    await expect(preview).toBeHidden();
    await expect(term).toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(term).toBeFocused();
    await expect(preview).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(term).not.toBeFocused();
    await expect(preview).toBeHidden();
  });

  test("the pointer can move onto a preview without closing it, and leaving both closes it", async ({ page }) => {
    await page.goto(WHAT_IS_MAAT, { waitUntil: "networkidle" });
    const term = termOf(page, "b20");
    const preview = await previewOf(term);
    await term.hover();
    await expect(preview).toBeVisible();
    await preview.hover();
    // Longer than a preview stays open once the pointer has left it.
    await page.waitForTimeout(500);
    await expect(preview).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(preview).toBeHidden();
  });

  for (const width of [360, 1440] as const) {
    test(`at ${width}px a preview opens beside its term, inside the window`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(WHAT_IS_MAAT, { waitUntil: "networkidle" });
      const term = termOf(page, "b20");
      const preview = await previewOf(term);
      await term.hover();
      await expect(preview).toBeVisible();
      const t = (await term.boundingBox())!;
      const p = (await preview.boundingBox())!;
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x + p.width).toBeLessThanOrEqual(width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y + p.height).toBeLessThanOrEqual(800);
      // Below or above the term, never over it, and close to it.
      const gap = p.y >= t.y + t.height ? p.y - (t.y + t.height) : t.y - (p.y + p.height);
      expect(gap).toBeGreaterThanOrEqual(0);
      expect(gap).toBeLessThanOrEqual(16);
    });
  }

  test("every glossary link in a page's body names a preview with the entry's text, one preview per entry", async ({ page }) => {
    // Each entry as the glossary shows it, without the previews of the terms it links.
    await page.goto("/docs/help/glossary");
    const entries = new Map(
      await page.locator("#nd-page .prose h3[id] + p").evaluateAll((ps) =>
        ps.map((p) => {
          const copy = p.cloneNode(true) as HTMLElement;
          for (const tip of copy.querySelectorAll('[role="tooltip"]')) tip.remove();
          return [p.previousElementSibling?.id ?? "", (copy.textContent ?? "").replace(/\s+/g, " ").trim()] as const;
        }),
      ),
    );
    expect(entries.size).toBeGreaterThan(0);
    for (const path of [WHAT_IS_MAAT, "/docs/security/model", "/docs/help/glossary"]) {
      await page.goto(path);
      const links = await page.locator('#nd-page .prose a[href^="/docs/help/glossary#"]').evaluateAll((as) =>
        as.map((a) => {
          const id = a.getAttribute("aria-describedby") ?? "";
          const tip = document.getElementById(id);
          return {
            href: a.getAttribute("href") ?? "",
            id,
            count: document.querySelectorAll(`[id="${CSS.escape(id)}"]`).length,
            role: tip?.getAttribute("role"),
            popover: tip?.getAttribute("popover"),
            text: (tip?.textContent ?? "").replace(/\s+/g, " ").trim(),
          };
        }),
      );
      expect(links.length, path).toBeGreaterThan(0);
      expect(links.filter((l) => l.count !== 1 || l.role !== "tooltip" || l.popover !== "manual" || !l.text), path).toEqual([]);
      // Every link to one entry names the same preview, and that preview is the entry less its closing See pointer.
      const byHref = new Map<string, typeof links>();
      for (const l of links) byHref.set(l.href, [...(byHref.get(l.href) ?? []), l]);
      for (const [href, group] of byHref) {
        expect(new Set(group.map((l) => l.id)).size, `${path}: ${href}`).toBe(1);
        const entry = entries.get(href.slice(href.indexOf("#") + 1)) ?? "";
        const { text } = group[0]!;
        const rest = entry.slice(text.length).trim();
        expect(entry.startsWith(text) && (rest === "" || rest.startsWith("See ")), `${path}: ${href} shows "${text}"`).toBe(true);
      }
      // The page draws each entry's preview once.
      expect(await page.locator('#nd-page [role="tooltip"][popover]').count(), path).toBe(byHref.size);
    }
  });

  test("a later link to an entry opens the page's one preview of it, beside that link", async ({ page }) => {
    await page.goto("/docs/security/model", { waitUntil: "networkidle" });
    const links = page.locator('#nd-page .prose a[href="/docs/help/glossary#timelock"]');
    expect(await links.count()).toBeGreaterThan(1);
    const later = links.last();
    expect(await later.getAttribute("aria-describedby")).toBe(await links.first().getAttribute("aria-describedby"));
    const preview = await previewOf(later);
    await later.scrollIntoViewIfNeeded();
    await later.hover();
    await expect(preview).toBeVisible();
    const t = (await later.boundingBox())!;
    const p = (await preview.boundingBox())!;
    const gap = p.y >= t.y + t.height ? p.y - (t.y + t.height) : t.y - (p.y + p.height);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThanOrEqual(16);
    // The pointer can move onto it, as onto the preview of a first link.
    await preview.hover();
    await page.waitForTimeout(500);
    await expect(preview).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(preview).toBeHidden();
  });

  /** Entries too tall to show beside a term in the middle of a short window: the page that links one, and the entry. */
  const LONG_ENTRIES = [
    { path: WHAT_IS_MAAT, id: "cdp-server-wallet" },
    { path: "/docs/concepts/mandate", id: "revert" },
    { path: "/docs/guides/watch-decisions-onchain", id: "change-hash" },
    { path: "/docs/help/glossary", id: "runway" },
    { path: "/docs/help/glossary", id: "uimultiplier" },
  ] as const;
  /**
   * Whether a term's preview shows. One that shows is whole: inside the window, beside its term, and never cut to a box
   * that only a wheel could scroll. One that does not show is not open either.
   */
  async function shownWhole(term: Locator, preview: Locator): Promise<boolean> {
    if (!(await preview.isVisible())) {
      expect(await preview.evaluate((el) => el.matches(":popover-open")), "a preview that does not show is closed").toBe(false);
      return false;
    }
    const { width, height } = term.page().viewportSize()!;
    const t = (await term.boundingBox())!;
    const p = (await preview.boundingBox())!;
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x + p.width).toBeLessThanOrEqual(width);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.y + p.height).toBeLessThanOrEqual(height);
    const gap = p.y >= t.y + t.height ? p.y - (t.y + t.height) : t.y - (p.y + p.height);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThanOrEqual(16);
    expect(await preview.evaluate((el) => el.scrollHeight <= el.clientHeight), "the preview is not cut").toBe(true);
    return true;
  }

  for (const { width, height } of [
    { width: 320, height: 256 },
    { width: 640, height: 360 },
  ] as const) {
    test(`in a ${width}x${height} window a preview shows only whole, by keyboard or pointer, and the link keeps the whole entry`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const entries = new Map<string, string>();
      for (const { id } of LONG_ENTRIES) entries.set(id, await entryWithoutPointer(page, id));
      for (const { path, id } of LONG_ENTRIES) {
        await page.goto(path, { waitUntil: "networkidle" });
        const term = termOf(page, id);
        const preview = await previewOf(term);
        await term.evaluate((a) => a.scrollIntoView({ block: "center" }));
        // Keyboard focus: no wheel reaches a preview it opens.
        await term.focus();
        await expect(term).toBeFocused();
        const byKey = await shownWhole(term, preview);
        // The CDP Server Wallet entry, its status last, is taller than any room a 320x256 window has beside a term.
        if (width === 320 && id === "cdp-server-wallet") expect(byKey, id).toBe(false);
        await expect(term, `${path}: ${id}`).toHaveAccessibleDescription(entries.get(id)!);
        await expect(term).toHaveAttribute("href", `/docs/help/glossary#${id}`);
        await term.evaluate((a) => a.blur());
        await expect(preview).toBeHidden();
        // The pointer, resting well past the delay.
        await term.hover();
        await page.waitForTimeout(700);
        await shownWhole(term, preview);
        await page.mouse.move(0, 0);
        await expect(preview).toBeHidden();
      }
    });
  }

  test("a preview with no room beside its term opens whole once the page scrolls its term up, and closes when the room goes", async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 360 });
    await page.goto(WHAT_IS_MAAT, { waitUntil: "networkidle" });
    const term = termOf(page, "cdp-server-wallet");
    const preview = await previewOf(term);
    await term.evaluate((a) => a.scrollIntoView({ block: "center" }));
    await term.focus();
    await expect(term).toBeFocused();
    expect(await shownWhole(term, preview)).toBe(false);
    // The reader scrolls the page, with the keys or the wheel: the preview follows its term, and opens once it has room.
    const y = (await term.boundingBox())!.y;
    await page.evaluate((by) => window.scrollBy(0, by), y - 80);
    await expect(preview).toBeVisible();
    expect(await shownWhole(term, preview)).toBe(true);
    expect(await inView(preview, CDP_STATUS)).toBe(true);
    await term.evaluate((a) => a.scrollIntoView({ block: "center" }));
    await expect(preview).toBeHidden();
    expect(await shownWhole(term, preview)).toBe(false);
    await expect(term).toBeFocused();
  });

  test("in a 320x256 window, with keyboard focus on a term whose entry has no room, Mandate has no serious or critical axe violations", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 256 });
    await page.goto("/docs/concepts/mandate", { waitUntil: "networkidle" });
    await expect(page.locator('[data-overflow="unmeasured"]')).toHaveCount(0);
    const term = termOf(page, "revert");
    await term.evaluate((a) => a.scrollIntoView({ block: "center" }));
    await term.focus();
    await expect(term).toBeFocused();
    const { violations } = await new AxeBuilder({ page }).analyze();
    const blocking = violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 5) }));
    expect(blocking).toEqual([]);
    // The scan ran with focus on the term.
    await expect(term).toBeFocused();
  });

  test("a preview still waiting to open when a link is followed opens nothing and logs no error", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(WHAT_IS_MAAT, { waitUntil: "networkidle" });
    await termOf(page, "b20").hover();
    // Followed from a script, before the preview's delay is up, so the pointer stays on the term that has left the page.
    await page.evaluate(() => document.querySelector<HTMLAnchorElement>('#nd-page .prose a[href="/docs/concepts/treasury-loop"]')!.click());
    await expect(page).toHaveURL(/\/docs\/concepts\/treasury-loop$/);
    await page.waitForTimeout(1200);
    expect(errors).toEqual([]);
  });

  test("with a scrollbar that takes room, a preview in a narrow window stays clear of it", async ({ playwright, baseURL }) => {
    // Headless Chromium hides scrollbars unless told not to.
    const browser = await playwright.chromium.launch({ ignoreDefaultArgs: ["--hide-scrollbars"] });
    try {
      const page = await browser.newPage({ baseURL, viewport: { width: 400, height: 800 } });
      await page.goto(WHAT_IS_MAAT, { waitUntil: "networkidle" });
      const { inner, client } = await page.evaluate(() => ({ inner: innerWidth, client: document.documentElement.clientWidth }));
      expect(client, "the page has a scrollbar that takes room").toBeLessThan(inner);
      const term = termOf(page, "b20");
      const preview = await previewOf(term);
      await term.hover();
      await expect(preview).toBeVisible();
      const p = (await preview.boundingBox())!;
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x + p.width).toBeLessThanOrEqual(client);
    } finally {
      await browser.close();
    }
  });

  test("the Markdown copies keep plain glossary links, with no definition inlined", async ({ request }) => {
    const md = await (await request.get("/md/docs/get-started/what-is-maat.md")).text();
    expect(md).toMatch(/\[B20\]\(https?:\/\/[^)\s]+\/docs\/help\/glossary#b20\)/);
    const definition = "The token type behind the tokenized stocks";
    expect(md).not.toContain(definition);
    // llms-full.txt holds the entry once: in the glossary.
    const full = await (await request.get("/llms-full.txt")).text();
    expect(full.split(definition)).toHaveLength(2);
  });

  for (const theme of ["light", "dark"] as const) {
    test(`What is Maat with a preview open in ${theme} has no serious or critical axe violations`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
      await page.goto(WHAT_IS_MAAT, { waitUntil: "networkidle" });
      await expect(page.locator("html")).toHaveClass(theme === "dark" ? /\bdark\b/ : /^(?!.*\bdark\b)/);
      await expect(page.locator('[data-overflow="unmeasured"]')).toHaveCount(0);
      const term = termOf(page, "b20");
      const preview = await previewOf(term);
      await term.hover();
      await expect(preview).toBeVisible();
      const { violations } = await new AxeBuilder({ page }).analyze();
      const blocking = violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 5) }));
      expect(blocking).toEqual([]);
      // The scan ran on the open preview.
      await expect(preview).toBeVisible();
    });
  }

  test.describe("on a touch screen", () => {
    test.use({ hasTouch: true });

    test("a tap on a term opens no preview and follows the link", async ({ page }) => {
      await page.goto(WHAT_IS_MAAT, { waitUntil: "networkidle" });
      // Kept in sessionStorage, so a preview the tap opened is still known after the page changes.
      await page.evaluate(() =>
        document.addEventListener(
          "toggle",
          (e) => {
            if ((e as ToggleEvent).newState === "open") sessionStorage.setItem("previewOpened", "yes");
          },
          true,
        ),
      );
      // The recorder sees a preview the mouse opens.
      const vault = termOf(page, "vault");
      await vault.hover();
      await expect(await previewOf(vault)).toBeVisible();
      await expect.poll(() => page.evaluate(() => sessionStorage.getItem("previewOpened"))).toBe("yes");
      await page.mouse.move(0, 0);
      await expect(await previewOf(vault)).toBeHidden();
      await page.evaluate(() => sessionStorage.removeItem("previewOpened"));
      // A finger held on a term, well past the time a resting mouse pointer takes to open its preview, opens none.
      const b20 = (await termOf(page, "b20").boundingBox())!;
      const touch = await page.context().newCDPSession(page);
      const point = { x: b20.x + b20.width / 2, y: b20.y + b20.height / 2 };
      await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
      await page.waitForTimeout(700);
      expect(await page.evaluate(() => sessionStorage.getItem("previewOpened"))).toBeNull();
      await touch.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
      await termOf(page, "b20").tap();
      await expect(page).toHaveURL(/\/docs\/help\/glossary#b20$/);
      expect(await page.evaluate(() => sessionStorage.getItem("previewOpened"))).toBeNull();
    });
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("a term is a plain link to its entry, with a dotted underline and no preview showing", async ({ page }) => {
      await page.goto(WHAT_IS_MAAT);
      const term = termOf(page, "b20");
      await expect(term).toHaveAttribute("href", "/docs/help/glossary#b20");
      await expect(await previewOf(term)).toBeHidden();
      expect(await term.evaluate((a) => getComputedStyle(a).textDecorationStyle)).toBe("dotted");
      // A link to any other page keeps the solid underline.
      const other = page.locator('#nd-page .prose a[href="/docs/concepts/treasury-loop"]').first();
      expect(await other.evaluate((a) => getComputedStyle(a).textDecorationStyle)).toBe("solid");
      await term.click();
      await expect(page).toHaveURL(/\/docs\/help\/glossary#b20$/);
    });
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
    // The page's own file opens with where the other pages are, then the page.
    expect(text).toMatch(
      /^> Index of every page: \[llms\.txt\]\(https?:\/\/[^)]+\/llms\.txt\)\. All pages in one file: \[llms-full\.txt\]\(https?:\/\/[^)]+\/llms-full\.txt\)\.\n\n# Maat docs\n\nURL: https?:\/\/[^\n]+\/docs\n/,
    );
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

  // A signature, a declaration or a table is a tab stop only while it is wider than its box (components/docs/ScrollRegion.tsx).
  for (const width of [360, 1440] as const) {
    for (const path of ["/docs/reference/mandate-vault", "/docs/reference/events", "/docs/concepts/refusal-codes"]) {
      test(`${path} at ${width}px: after hydration, exactly the blocks that scroll sideways are tab stops`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(path, { waitUntil: "networkidle" });
        await page.evaluate(() => document.fonts.ready);
        await expect(page.locator('[data-overflow="unmeasured"]')).toHaveCount(0);
        await expect(async () => {
          const blocks = await page.evaluate(() =>
            [...document.querySelectorAll("#nd-page [data-overflow]")].map((el) => ({
              label: el.getAttribute("aria-label"),
              state: el.getAttribute("data-overflow"),
              scrolls: el.scrollWidth > el.clientWidth,
              stop: el.getAttribute("tabindex") === "0" && el.getAttribute("role") === "region",
            })),
          );
          expect(blocks.length).toBeGreaterThan(0);
          expect(blocks.filter((b) => b.stop !== b.scrolls || b.state !== (b.scrolls ? "scrolls" : "fits"))).toEqual([]);
          expect(blocks.filter((b) => b.stop && !b.label)).toEqual([]);
          if (width === 1440) expect(blocks.filter((b) => b.stop).length).toBeLessThan(blocks.length);
        }).toPass();
      });
    }
  }

  test("a block that grows wider than its box becomes a tab stop again", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/docs/reference/mandate-vault", { waitUntil: "networkidle" });
    const pre = page.locator("#nd-page pre[data-overflow]").first();
    await expect(pre).toHaveAttribute("data-overflow", "fits");
    await page.setViewportSize({ width: 360, height: 900 });
    await expect(pre).toHaveAttribute("data-overflow", "scrolls");
    await expect(pre).toHaveAttribute("tabindex", "0");
    await expect(pre).toHaveAttribute("role", "region");
  });

  test("on the contract reference pages, every name in code that links goes to a heading its target page has", async ({ page, request }) => {
    const ids = new Map<string, Set<string>>();
    const idsOf = async (path: string) => {
      if (!ids.has(path)) {
        const html = await (await request.get(path)).text();
        ids.set(path, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!)));
      }
      return ids.get(path)!;
    };
    // Names with more than one entry. The page may link one itself, to the entry it means; the build never guesses one.
    const ambiguous = ["LengthMismatch", "ZeroAddress", "NotVault", "HealthFactorTooLow", "UnsupportedToken", "TransferFailed", "NotOwner", "withdraw", "usdc", "owner"];
    const linked: Record<string, string[]> = {};
    for (const slug of ["mandate-vault", "events", "errors", "types", "market-calendar", "adapters"]) {
      const path = `/docs/reference/${slug}`;
      const source = readFileSync(`content/docs/reference/${slug}.mdx`, "utf8");
      await page.goto(path);
      // Names in code that link, and the types that link inside a signature. `entry`: drawn by a reference entry or an
      // index from the contract's own data, such as the index's row for its own `withdraw`, not linked in the prose.
      const links = await page
        .locator("#nd-page .prose a:has(> code), #nd-page .prose pre a")
        .evaluateAll((as) =>
          as.map((a) => ({ code: a.textContent ?? "", href: a.getAttribute("href") ?? "", entry: a.closest("[data-overflow]") !== null })),
        );
      linked[slug] = links.map((l) => l.href);
      const broken: string[] = [];
      for (const { code, href } of links) {
        if (!href.startsWith("#") && !href.startsWith("/docs/")) continue;
        const [target = "", id = ""] = href.startsWith("#") ? [path, href.slice(1)] : href.split("#");
        if (id && !(await idsOf(target)).has(id)) broken.push(`${code} -> ${href}`);
      }
      expect(broken, path).toEqual([]);
      const guessed = links.filter(
        (l) => !l.entry && ambiguous.includes(l.code.replace(/\(\)$/, "")) && !source.includes(`[\`${l.code}\`](${l.href})`),
      );
      expect(guessed, path).toEqual([]);
    }
    expect(linked["mandate-vault"]!.some((h) => h.startsWith("/docs/reference/events#"))).toBe(true);
    expect(linked["mandate-vault"]!.some((h) => h.startsWith("/docs/reference/errors#"))).toBe(true);
    expect(linked.events!.filter((h) => h === "/docs/reference/mandate-vault#execute").length).toBeGreaterThan(0);
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
