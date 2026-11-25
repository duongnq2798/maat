import { expect, test } from "@playwright/test";
import { GUARD_CHECKLIST, REASON_RAISED_AT, REASONS } from "../content/reasons";
import { SITE } from "../lib/site";
import { collectErrors } from "./helpers";

// /reasons.json and the checklist page that links it, as the static export serves them.

test("/reasons.json serves every refusal reason as JSON, each with the lines that return it", async ({ request }) => {
  const res = await request.get("/reasons.json");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(/^application\/json/);
  const json = (await res.json()) as { ok: { id: number }; reasons: { id: number; name: string; raisedAt: { url: string }[] }[] };
  expect(json.ok.id).toBe(0);
  expect(json.reasons.map((r) => [r.id, r.name])).toEqual(REASONS.map((c, i) => [i + 1, c]));
  for (const r of json.reasons) {
    expect(r.raisedAt.map((s) => s.url), r.name).toEqual(
      REASON_RAISED_AT[r.name as (typeof REASONS)[number]].map((s) => `${SITE.repoUrl}/blob/main/${s.file}#L${s.line}`),
    );
  }
});

test("the checklist page tables one row per reason, each linked to its line, and links /reasons.json", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/docs/concepts/agent-checklist");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("What an agent must check before trading a tokenized stock");

  const rows = page.locator("xpath=//h2[@id='the-checklist']/following::table[1]/tbody/tr");
  await expect(rows).toHaveCount(GUARD_CHECKLIST.length);
  for (const [i, g] of GUARD_CHECKLIST.entries()) {
    const row = rows.nth(i);
    await expect(row.locator("td").nth(2)).toHaveText(g.code);
    const [first] = REASON_RAISED_AT[g.code];
    await expect(row.locator("td").nth(3).locator("a")).toHaveAttribute("href", `${SITE.repoUrl}/blob/main/${first?.file}#L${first?.line}`);
  }

  const href = await page.locator("article").getByRole("link", { name: "/reasons.json" }).first().getAttribute("href");
  expect(href).toBe("/reasons.json");
  expect((await page.request.get(href!)).ok()).toBe(true);
  expect(errors).toEqual([]);
});
