import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { collectErrors, measureFit } from "./helpers";

// Two complete windows are published, each with its own tablist: every locator is scoped to one window's section.
const firstWindow = (page: Page) => page.locator('[data-window][data-status="complete"]').first();
const tablist = (page: Page) => firstWindow(page).getByRole("tablist");
const tabs = (page: Page) => tablist(page).getByRole("tab");

async function open(page: Page) {
  await page.goto("/gap-index", { waitUntil: "networkidle" });
  await expect(firstWindow(page).locator('[data-token-tabs="tabs"]')).toHaveCount(1);
}

test("the tabs of a window switch with the mouse", async ({ page }) => {
  const errors = collectErrors(page);
  await open(page);
  const all = tabs(page);
  await expect(all.first()).toHaveText("NVDAc");
  await expect(all.first()).toHaveAttribute("aria-selected", "true");

  const googl = tablist(page).getByRole("tab", { name: "GOOGLc" });
  await googl.click();
  await expect(googl).toHaveAttribute("aria-selected", "true");
  await expect(all.first()).toHaveAttribute("aria-selected", "false");
  const panel = firstWindow(page).getByRole("tabpanel");
  await expect(panel).toHaveCount(1);
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("aria-labelledby", (await googl.getAttribute("id"))!);
  expect(errors).toEqual([]);
});

test("the tabs of a window move with ArrowRight, End and Home", async ({ page }) => {
  await open(page);
  const all = tabs(page);
  const n = await all.count();
  expect(n).toBeGreaterThan(3);

  await all.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(all.nth(1)).toBeFocused();
  await expect(all.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(all.nth(1)).toHaveAttribute("tabindex", "0");
  await expect(all.first()).toHaveAttribute("tabindex", "-1");

  await page.keyboard.press("End");
  await expect(all.last()).toBeFocused();
  await expect(all.last()).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("Home");
  await expect(all.first()).toBeFocused();
  await expect(all.first()).toHaveAttribute("aria-selected", "true");
  await expect(firstWindow(page).getByRole("tabpanel")).toBeVisible();
});

test("the table view opens", async ({ page }) => {
  await open(page);
  const details = firstWindow(page).getByRole("tabpanel").locator("details").first();
  await expect(details).not.toHaveAttribute("open", "");
  await details.getByText("Table view").click();
  await expect(details).toHaveAttribute("open", "");
  await expect(details.getByRole("table")).toBeVisible();
  await expect(details.getByRole("columnheader").first()).toBeVisible();
});

// The site pages have no dark theme (only /docs does), so the page is checked in light.
test("/gap-index has no serious or critical axe violations", async ({ page }) => {
  await page.goto("/gap-index", { waitUntil: "networkidle" });
  await expect(page.locator('[data-overflow="unmeasured"]')).toHaveCount(0);
  await firstWindow(page).getByRole("tabpanel").locator("details").first().getByText("Table view").click();
  const { violations } = await new AxeBuilder({ page }).analyze();
  const blocking = violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 5) }));
  expect(blocking).toEqual([]);
});

test("at 375 x 812 the page does not overflow sideways", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page);
  const fit = await measureFit(page);
  expect(fit.overflow).toBeLessThanOrEqual(0);
  expect(fit.clipped).toEqual([]);
});

test("the page raises no console error and makes no request outside its own origin", async ({ page }) => {
  const errors = collectErrors(page);
  const foreign: string[] = [];
  await page.route("**/*", (route) => {
    const { hostname, protocol } = new URL(route.request().url());
    if (protocol === "data:" || protocol === "blob:" || hostname === "localhost" || hostname === "127.0.0.1") return route.continue();
    foreign.push(route.request().url());
    return route.abort();
  });
  await open(page);
  expect(foreign).toEqual([]);
  expect(errors).toEqual([]);
});

test("/now links the Weekend Gap Index from its method section", async ({ page }) => {
  await page.goto("/now");
  const link = page.locator("#method").getByRole("link", { name: "Weekend Gap Index" });
  await expect(link).toHaveAttribute("href", "/gap-index");
});
