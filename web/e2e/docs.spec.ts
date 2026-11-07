import { expect, type Page, test } from "@playwright/test";

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
    await dialog.getByRole("option", { name: /Maat docs/ }).first().click();
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
