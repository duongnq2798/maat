import { expect, test } from "@playwright/test";
import skill from "../content/generated/skill.json" with { type: "json" };
import { routeLiveRpc } from "./fake-live-rpc";
import { collectErrors, measureFit } from "./helpers";

// The landing's "For agent builders" section and the /skill.md file it links. The live strip reads the recorded weekend
// of e2e/fake-live-rpc.ts, so no test here touches the network.
test.beforeEach(async ({ page }) => {
  await routeLiveRpc(page, "weekend");
});

for (const { width, height } of [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
]) {
  test(`at ${width}x${height} the For agent builders section fits, its cards whole, and links /skill.md`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);

    const section = page.locator("#agents");
    await section.scrollIntoViewIfNeeded();
    await expect(section.getByRole("heading", { level: 2, name: "Ask the vault before you trade." })).toBeVisible();
    for (const command of ["node scripts/check.mjs market", "node scripts/check.mjs preview --action BUY --token NVDAc --amount 5"]) {
      await expect(section.locator("code", { hasText: command })).toBeVisible();
    }

    // Nothing in the section is wider than the screen, and no card clips its command.
    const fit = await measureFit(page);
    expect(fit.overflow).toBeLessThanOrEqual(0);
    expect(fit.clipped).toEqual([]);
    const right = await section.evaluate((el) => Math.max(...[...el.querySelectorAll("*")].map((n) => n.getBoundingClientRect().right)));
    expect(right).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/screens/agent-builders-${width}.png`, clip: (await section.boundingBox())!, animations: "disabled" });

    // The link leads to a file the export serves (a browser may show a .md file or save it, so the test fetches it).
    const href = await section.getByRole("link", { name: /Read \/skill\.md/ }).getAttribute("href");
    expect(href).toBe("/skill.md");
    expect((await page.request.get(href!)).ok()).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("/skill.md serves the skill's SKILL.md as Markdown", async ({ request }) => {
  const res = await request.get("/skill.md");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(/^text\/markdown/);
  expect(await res.text()).toBe(skill.text);
});
