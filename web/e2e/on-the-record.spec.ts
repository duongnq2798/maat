import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { RECORD_MOMENTS } from "../content/record";
import { routeLiveRpc } from "./fake-live-rpc";
import { collectErrors, contentRight, expectTapTargets, measureFit } from "./helpers";

// "On the record" (spec 2026-11-28, landing "a calmer first screen", section 2): right under the hero, three real
// Decisions of the mainnet vault as tabs. Nothing here reads Base; e2e/fake-live-rpc.ts answers the hero's live line.

async function axe(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).include("#record").analyze();
  expect(
    violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(" ")) })),
    label,
  ).toEqual([]);
}

for (const vp of [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  // The widest phone: here the simulator link fits on one line, so the two links sit closest.
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]) {
  test(`at ${vp.width}x${vp.height} the vault's real answers follow the hero, switch by tap and by key, fit and pass axe`, async ({ page }) => {
    // Three moments, each measured, tapped and checked with axe: more than the default 30 s on a loaded machine.
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await page.setViewportSize(vp);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await routeLiveRpc(page, "weekend");
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);

    await expect(page.locator("#top + #record")).toHaveCount(1);
    const record = page.locator("#record");
    await record.scrollIntoViewIfNeeded();
    const tabs = record.getByRole("tab");
    await expect(tabs).toHaveText(["Thu 21:14 Thanksgiving", "Fri 12:58 Before close", "Fri 13:01 After close"]);
    await expectTapTargets(await tabs.all());
    // The three tabs sit in one row at every width, each label inside its tab.
    const tops = await Promise.all((await tabs.all()).map(async (t) => (await t.boundingBox())!.y));
    expect(new Set(tops).size).toBe(1);
    for (const t of await tabs.all()) {
      const label = (await t.locator("[data-record-tab-label]").boundingBox())!;
      expect(label.x + label.width, (await t.textContent()) ?? "").toBeLessThanOrEqual((await contentRight(t)) + 1);
    }

    // The first moment is open; the panel shows its verdict, the day's bar and the way to its transaction.
    const panel = (id: string) => page.locator(`#record-panel-${id}`);
    await expect(panel("holiday")).toBeVisible();
    await expect(panel("holiday").locator("[data-record-verdict]")).toHaveText("VAULT DECISION Refused · Market closed (MARKET_CLOSED)");
    await expect(panel("before-close")).toBeHidden();

    // A tap opens a moment, and the arrow keys move between them, as on the engine card.
    await tabs.nth(1).evaluate((el) => el.scrollIntoView({ block: "center" }));
    await tabs.nth(1).click();
    await expect(panel("before-close")).toBeVisible();
    await expect(panel("before-close").locator("[data-record-verdict]")).toHaveText("VAULT DECISION Allowed · All checks passed (OK)");
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(2)).toBeFocused();
    await expect(panel("after-close")).toBeVisible();
    await expect(panel("before-close")).toBeHidden();

    for (const id of ["after-close", "before-close", "holiday"] as const) {
      const m = RECORD_MOMENTS.find((x) => x.id === id)!;
      const t = tabs.nth(RECORD_MOMENTS.indexOf(m));
      await t.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await t.click();
      await expect(panel(id)).toBeVisible();
      // The source plate stays on one line.
      const plate = panel(id).locator("[data-record-source]");
      expect((await plate.boundingBox())!.height, id).toBeLessThanOrEqual(24);
      // The needle's label and the axis stay inside the bar's row, and the bar inside the card, at every width.
      const day = panel(id).locator("[data-record-day]");
      const box = (await day.boundingBox())!;
      for (const el of await day.locator("[aria-hidden] span").all()) {
        const b = (await el.boundingBox())!;
        expect(b.x, id).toBeGreaterThanOrEqual(box.x - 2);
        expect(b.x + b.width, id).toBeLessThanOrEqual(box.x + box.width + 2);
      }
      // A refusal says why Basescan reads "Success", on a phone too; an allowed trade has nothing to explain.
      const note = panel(id).locator("[data-record-basescan-note]");
      if (m.allowed) await expect(note).toHaveCount(0);
      else await expect(note).toBeVisible();
      const links = [panel(id).getByRole("link", { name: /Open it on Basescan/ }), ...(await record.getByRole("listitem").getByRole("link").all())];
      await expectTapTargets(links);
      const fit = await measureFit(page);
      expect(fit.overflow, id).toBeLessThanOrEqual(0);
      expect(fit.clipped, id).toEqual([]);
      await axe(page, id);
    }
    expect(errors).toEqual([]);
  });
}

// Below 360 the long first label gets a little more of the row (max-[379px]), and every label still fits its tab.
test("at 320 px each tab's label stays inside its tab", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await routeLiveRpc(page, "weekend");
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  const tabs = page.locator("#record").getByRole("tab");
  await expect(tabs).toHaveCount(3);
  for (const t of await tabs.all()) {
    const label = (await t.locator("[data-record-tab-label]").boundingBox())!;
    expect(label.x + label.width, (await t.textContent()) ?? "").toBeLessThanOrEqual((await contentRight(t)) + 1);
  }
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });

  test("the first moment is there, in the HTML, and the others are hidden", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#record-panel-holiday")).toBeVisible();
    await expect(page.locator("#record-panel-holiday")).toContainText("Refused · Market closed (MARKET_CLOSED)");
    await expect(page.locator("#record-panel-before-close")).toBeHidden();
  });
});
