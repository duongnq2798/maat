import { expect, type Locator, type Page, type Route, test } from "@playwright/test";
import { getAddress } from "viem";
import { FACTS } from "../content/facts";
import addresses from "../content/generated/base-addresses.json" with { type: "json" };
import deployments from "../content/generated/deployments.json" with { type: "json" };
import { REASON_LABEL, REASONS } from "../content/reasons";
import { deploymentConfig } from "../lib/chain/config";
import { basescanTx } from "../lib/live/basescan";
import { LIVE_RPCS } from "../lib/live/rpc";
import { SITE } from "../lib/site";
import { decisionLog, hash32 } from "../test/helpers/fake-ledger";
import { routeLiveRpc } from "./fake-live-rpc";
import { installFakeChain, RPC_HOSTS, type FakeScenario } from "./fake-rpc";
import { collectErrors, lineCount } from "./helpers";

// The landing's first screen leads with the mainnet vault (plan 2026-11-25 Move 4). The live strip reads the recorded
// weekend of e2e/fake-live-rpc.ts. The vault's read is /ledger's loader, whose batched calls go to the fake chain of
// e2e/fake-rpc.ts where a test routes them; elsewhere the strip's fake answers them with an error, and the landing keeps
// the two Decisions recorded in this build. No test here touches the network.

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
] as const;

// The Decisions recorded in this build, newest first (test/vault-decisions.test.tsx holds the landing's rows to them).
const RECORDED = [...FACTS.mainnetDecisions.value].sort((a, b) => Number(BigInt(b.blockNumber) - BigInt(a.blockNumber)));
const NEWEST = RECORDED[0]!;
const VAULT = deploymentConfig(deployments)!.vault;
const DEPLOY_TX = deploymentConfig(deployments)!.deployTx!;
const DEPLOY = 61_698_517n;
const HEAD = BigInt(NEWEST.blockNumber) + 1_000n;
const NEW_BLOCK = HEAD - 10n;
const NEW_TIME = NEWEST.blockTime + Number(NEW_BLOCK - BigInt(NEWEST.blockNumber)) * 2;
const AGE = "3 h 5 min";
const NOW_MS = (NEW_TIME + 3 * 3600 + 5 * 60) * 1000;
const NVDAC = getAddress(addresses.find((a) => a.name === "NVDAC")!.value);
// The refusal with the longest label, so the plate is at its longest.
const LONGEST = [...REASONS].sort((a, b) => REASON_LABEL[b].length - REASON_LABEL[a].length)[0]!;

/** The vault on a fake Base: the two recorded Decisions, then a newer refusal of $50 of NVDAc, the per-trade cap. */
const scenario: FakeScenario = {
  head: HEAD,
  headTime: NEW_TIME + 20,
  vault: VAULT,
  logs: [
    ...FACTS.mainnetDecisions.value.map(({ blockNumber, logIndex, transactionHash, topics, data }) => ({
      blockNumber,
      logIndex,
      transactionHash,
      topics: [...topics],
      data,
    })),
    decisionLog(9, NEW_BLOCK, { token: NVDAC, reason: LONGEST, amount: 50_000_000n }),
  ],
  times: { ...Object.fromEntries(FACTS.mainnetDecisions.value.map((l) => [l.blockNumber, l.blockTime])), [String(NEW_BLOCK)]: NEW_TIME },
  receipts: {
    [DEPLOY_TX.toLowerCase()]: { block: DEPLOY, gasUsed: 4_000_000n },
    ...Object.fromEntries(FACTS.mainnetDecisions.value.map((l) => [l.transactionHash.toLowerCase(), { block: BigInt(l.blockNumber), gasUsed: BigInt(l.gasUsed) }])),
    [hash32(9)]: { block: NEW_BLOCK, gasUsed: 111_116n },
  },
  // The loader needs only the timelock to accept the vault; the treasury read fails, which the ledger tolerates.
  calls: { [VAULT.toLowerCase()]: { TIMELOCK: 86_400n } },
};

/**
 * Sends the vault reader's batched calls (viem's http batch posts an array) to the fake chain; every other request goes
 * on to the strip's fake. Routed after that fake, so this handler runs first.
 */
async function routeVault(page: Page) {
  let answer: ((route: Route) => Promise<void>) | undefined;
  const capture = { route: async (_match: unknown, handler: (route: Route) => Promise<void>) => void (answer = handler) };
  await installFakeChain(capture as unknown as Page, scenario);
  await page.route(
    (url) => RPC_HOSTS.includes(url.host),
    async (route) => {
      const request = route.request();
      if (request.method() === "POST" && Array.isArray(request.postDataJSON())) return answer!(route);
      return route.fallback();
    },
  );
}

const plate = (page: Page) => page.locator("#top [data-vault-plate]");
const vaultCard = (page: Page) => page.locator("#top [data-vault-card]");
const bottom = async (l: Locator) => {
  const box = await l.boundingBox();
  return box!.y + box!.height;
};

/** Every visible run of text in the first screen that says "fork", and whether it sits on a tab. */
function forkWordsInFirstScreen(page: Page) {
  return page.evaluate(() => {
    const found: { text: string; tab: boolean }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent ?? "";
      const el = n.parentElement;
      if (!/fork/i.test(text) || !el || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (r.width === 0 || r.bottom <= 0 || r.top >= window.innerHeight) continue;
      found.push({ text: text.trim(), tab: el.closest('[role="tab"]') !== null });
    }
    return found;
  });
}

for (const vp of VIEWPORTS) {
  test(`at ${vp.width}x${vp.height} the first screen leads with the mainnet vault and names the fork only on the replay tab`, async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.setViewportSize(vp);
    await routeLiveRpc(page, "weekend");
    await page.goto("/");
    await expect(plate(page)).toHaveAttribute("data-vault-plate", "recorded");

    // The plate is the hero's first line, above the H1, and links the latest recorded Decision's transaction.
    const p = plate(page);
    await expect(p).toBeVisible();
    await expect(p).toHaveAttribute("href", basescanTx(NEWEST.transactionHash));
    await expect(p).toContainText("BASE MAINNET");
    await expect(p).toContainText(/Recorded Decision: Allowed · BUY NVDAc · \$5\.00 · \w{3} \d{1,2} \w{3} \d{2}:\d{2} ET/);
    expect(await bottom(p)).toBeLessThanOrEqual(vp.height);
    const h1 = await page.getByRole("heading", { level: 1 }).boundingBox();
    expect(await bottom(p)).toBeLessThanOrEqual(h1!.y);

    // The primary CTA opens the ledger.
    const primary = page.locator("[data-hero-cta]").first();
    await expect(primary).toHaveText("See the vault's last decision");
    await expect(primary).toHaveAttribute("href", "/ledger");

    const words = await forkWordsInFirstScreen(page);
    expect(words.filter((w) => !w.tab)).toEqual([]);
    if (vp.width === 1440) {
      // The engine card shares the hero's row: its mainnet face is on, the replay one tab away.
      expect(words).toEqual([{ text: "Fork replay", tab: true }]);
      await expect(page.locator("#top").getByRole("tab", { name: "Base mainnet" })).toHaveAttribute("aria-selected", "true");
      await expect(vaultCard(page)).toBeVisible();
      for (const cta of await page.locator("[data-hero-cta]").all()) expect(await bottom(cta)).toBeLessThanOrEqual(vp.height);
    }
    expect(errors).toEqual([]);
  });
}

for (const vp of VIEWPORTS) {
  test(`at ${vp.width}x${vp.height} the plate and the card show the vault's latest Decision read from Base`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize(vp);
    await page.clock.setFixedTime(NOW_MS);
    await routeLiveRpc(page, "weekend");
    await routeVault(page);
    await page.goto("/");

    await expect(vaultCard(page)).toHaveAttribute("data-vault-card", "live");
    const p = plate(page);
    await expect(p).toHaveAttribute("data-vault-plate", "live");
    await expect(p).toHaveAttribute("href", basescanTx(hash32(9)));
    await expect(p).toContainText(`Last Decision: Refused · ${REASON_LABEL[LONGEST]} · BUY NVDAc · $50.00 · ${AGE} ago`);
    expect(await bottom(p)).toBeLessThanOrEqual(vp.height);

    const card = vaultCard(page);
    await expect(card).toContainText(`3 Decisions on Base mainnet, read from Base by your browser.`);
    const rows = card.getByRole("list", { name: "Recent decisions" }).getByRole("listitem");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(1).getByRole("link")).toHaveAttribute("href", basescanTx(NEWEST.transactionHash));
    await expect(card.locator("[data-verdict]")).toHaveAttribute("data-reason", LONGEST);
    await page.screenshot({ path: `test-results/screens/landing-mainnet-live-${vp.width}.png` });

    if (vp.width === 1440) {
      await expect(page.locator("[data-vault-bar]")).toHaveText(`Last Decision ${AGE} ago.`);
      // The longest plate keeps to one line, its whole text in its title, and both CTAs stay in the first screen.
      expect(await lineCount(p.locator(":scope > span").last())).toBe(1);
      await expect(p).toHaveAttribute("title", `Last Decision: Refused · ${REASON_LABEL[LONGEST]} · BUY NVDAc · $50.00 · ${AGE} ago`);
      for (const cta of await page.locator("[data-hero-cta]").all()) expect(await bottom(cta)).toBeLessThanOrEqual(vp.height);
    } else {
      await expect(page.locator("[data-vault-bar]")).toBeHidden();
    }
    expect(errors).toEqual([]);
  });
}

test("when Base does not answer, the landing shows the two recorded Decisions and reads again on Read again", async ({ page }) => {
  const errors: { text: string; url: string }[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push({ text: m.text(), url: m.location().url });
  });
  page.on("pageerror", (e) => errors.push({ text: e.message, url: "" }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.setFixedTime(NOW_MS);
  const rpc = await routeLiveRpc(page, "down");
  await page.goto("/");

  const card = vaultCard(page);
  await expect(card).toHaveAttribute("data-vault-card", "recorded", { timeout: 20_000 });
  await expect(plate(page)).toHaveAttribute("data-vault-plate", "recorded");
  await expect(plate(page)).toHaveAttribute("href", basescanTx(NEWEST.transactionHash));
  await expect(card).toContainText("recorded · could not read Base");
  await expect(card).toContainText(`Could not read the vault on Base, so this shows the ${RECORDED.length} Decisions recorded in this build.`);
  const rows = card.getByRole("list", { name: "Recent decisions" }).getByRole("listitem");
  await expect(rows).toHaveCount(RECORDED.length);
  for (const [i, r] of RECORDED.entries()) await expect(rows.nth(i).getByRole("link")).toHaveAttribute("href", basescanTx(r.transactionHash));
  await expect(page.locator("[data-vault-bar]")).toHaveCount(0);

  rpc.set("weekend");
  await routeVault(page);
  await card.getByRole("button", { name: "Read again" }).click();
  await expect(card).toHaveAttribute("data-vault-card", "live");
  await expect(rows).toHaveCount(3);
  await expect(card.getByRole("button", { name: "Read again" })).toHaveCount(0);

  // The only errors are the 503s of the hosts that did not answer.
  const originOf = (url: string) => (URL.canParse(url) ? new URL(url).origin : "");
  expect(errors.filter((e) => !(LIVE_RPCS.includes(originOf(e.url)) && /status of 503\b/.test(e.text)))).toEqual([]);
});

test("at 390 px the Menu lists Ledger, Now, Gap Index and Docs, and opens the Gap Index", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await routeLiveRpc(page, "weekend");
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "How it works" })).toBeHidden();
  const pages = nav.getByRole("list", { name: "Pages" });
  await expect(pages).toBeHidden();
  await nav.locator("[data-phone-menu] > summary").click();
  await expect(pages).toBeVisible();
  const links = pages.getByRole("link");
  await expect(links).toHaveText(["Ledger", "Now", "Gap Index", "Docs"]);
  expect(await links.evaluateAll((els) => els.map((el) => el.getAttribute("href")))).toEqual(["/ledger", "/now", "/gap-index", SITE.docsUrl]);
  await pages.getByRole("link", { name: "Gap Index" }).click();
  await expect(page).toHaveURL(/\/gap-index$/);
});

test("at 1440 px the Menu gives way to the links, and the problem section links the Gap Index", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await routeLiveRpc(page, "weekend");
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.locator("[data-phone-menu] > summary")).toBeHidden();
  await expect(nav.getByRole("link", { name: "Ledger" })).toBeVisible();
  const gap = page.locator('section[aria-labelledby="problem-title"]').getByRole("link", { name: /^Weekend Gap Index · / });
  await expect(gap).toBeVisible();
  await expect(gap).toHaveAttribute("href", "/gap-index");
});
