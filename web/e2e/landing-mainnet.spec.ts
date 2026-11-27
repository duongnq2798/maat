import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, type Route, test } from "@playwright/test";
import { encodeFunctionData, getAddress, keccak256, toBytes, toHex, type Address, type Hex } from "viem";
import { ASK_OPEN } from "../content/ask-open";
import { NAV_TOKENS } from "../content/b20-nav";
import { FACTS } from "../content/facts";
import { HERO_CTAS, HERO_DEFINITION } from "../content/hero";
import agentNote from "../content/generated/agent-note.json" with { type: "json" };
import addresses from "../content/generated/base-addresses.json" with { type: "json" };
import deployments from "../content/generated/deployments.json" with { type: "json" };
import { REASON_LABEL, REASONS } from "../content/reasons";
import { vaultAbi } from "../lib/chain/abi";
import { word } from "../lib/live/abi";
import { deploymentConfig } from "../lib/chain/config";
import { basescanDecision } from "../lib/live/basescan";
import { LIVE_RPCS } from "../lib/live/rpc";
import { SITE } from "../lib/site";
import { decisionLog, hash32 } from "../test/helpers/fake-ledger";
import { fixtureResults, routeLiveRpc, type Scenario, SESSION_TS, twapOf, WEEKEND_TS, withFeed } from "./fake-live-rpc";
import { installFakeChain, RPC_HOSTS, type FakeScenario } from "./fake-rpc";
import { collectErrors, expectTapTargets } from "./helpers";

// The landing's first screen leads with the mainnet vault (plan 2026-11-25 Move 4). The live strip reads the recorded
// weekend of e2e/fake-live-rpc.ts. The vault's read is /ledger's loader, whose batched calls go to the fake chain of
// e2e/fake-rpc.ts where a test routes them; elsewhere the strip's fake answers them with an error, and the landing keeps
// the Decisions recorded in this build. No test here touches the network.

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

/** The vault on a fake Base: the recorded Decisions, then a newer refusal of $50 of NVDAc, the per-trade cap. */
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

const USDC = getAddress(addresses.find((a) => a.name === "USDC")!.value);
const OWNER: Address = getAddress("0x3c3a66f713DAE7e4A03Bbd81dB79FF65F42C1D6a");
/** A compute bill's maat:v1 blob, as the agent's code writes it (kind "bill"). */
const BILL_BLOB = `maat:v1:{"b":62500000,"c":"0123456789abcdef0123456789abcdef01234567","j":"0x${"0".repeat(64)}","k":"bill","r":"run-landing-e2e","s":[],"t":"Compute bill: $1.000000 of Claude API usage unpaid as of UTC day 20784"}`;
const BILL_HASH = keccak256(toBytes(BILL_BLOB));
const BILL_LINE = "Compute bill paid · $1.00 · to the owner's allowlisted address";
/** `execute(intent)` of that bill, paying the owner, then its blob. */
const BILL_INPUT = `${encodeFunctionData({
  abi: vaultAbi,
  functionName: "execute",
  args: [{ id: hash32(1009), action: 6, token: USDC, amount: 1_000_000n, minOut: 0n, payee: OWNER, rationaleHash: BILL_HASH }],
})}${toHex(BILL_BLOB).slice(2)}` as Hex;

/**
 * The same vault whose newest Decision is the owner's $1.00 compute bill: a PAY_EXPENSE whose calldata carries the bill
 * blob and names the owner as payee. The treasury read answers, so the landing knows the owner.
 */
const billScenario: FakeScenario = {
  ...scenario,
  logs: [...scenario.logs.slice(0, -1), decisionLog(9, NEW_BLOCK, { action: "PAY_EXPENSE", token: USDC, amount: 1_000_000n, rationaleHash: BILL_HASH })],
  txs: {
    [hash32(9)]: { from: OWNER, to: VAULT, input: BILL_INPUT },
  },
  calls: {
    [VAULT.toLowerCase()]: {
      TIMELOCK: 86_400n,
      owner: OWNER,
      executor: OWNER,
      paused: false,
      mandate: {
        sessionMode: 0,
        maxPremiumBps: 100,
        maxSlippageBps: 150,
        maxStaleness: 90_000,
        multiplierCooldown: 86_400,
        twapWindow: 1800,
        perTradeCapUsd: 50_000_000n,
        dailyCapUsd: 100_000_000n,
        calendar: getAddress("0x0000000000000000000000000000000000000c01"),
        swapAdapter: getAddress("0x0000000000000000000000000000000000000c02"),
        creditAdapter: getAddress("0x0000000000000000000000000000000000000000"),
        minHealthFactor: 1_500_000_000_000_000_000n,
        targetHealthFactor: 2_000_000_000_000_000_000n,
        deriskWindow: 28_800,
      },
      mandateHash: hash32(77),
      tokens: [],
      usdc: USDC,
    },
    [USDC.toLowerCase()]: { balanceOf: 30_000_000n },
  },
};

/**
 * Sends the vault reader's calls to the fake chain: its batched calls (viem's http batch posts an array) and its
 * eth_getLogs, which lib/chain/rpc.ts sends in a request of its own. Every other request goes on to the strip's fake,
 * which reads no logs. Routed after that fake, so this handler runs first.
 */
async function routeVault(page: Page, chain: FakeScenario = scenario) {
  let answer: ((route: Route) => Promise<void>) | undefined;
  const capture = { route: async (_match: unknown, handler: (route: Route) => Promise<void>) => void (answer = handler) };
  await installFakeChain(capture as unknown as Page, chain);
  await page.route(
    (url) => RPC_HOSTS.includes(url.host),
    async (route) => {
      const request = route.request();
      if (request.method() !== "POST") return route.fallback();
      const body = request.postDataJSON() as { method?: string } | unknown[] | null;
      if (Array.isArray(body) || (body as { method?: string } | null)?.method === "eth_getLogs") return answer!(route);
      return route.fallback();
    },
  );
}

const vaultCard = (page: Page) => page.locator("#top [data-vault-card]");
/** The link of the card's newest row: its transaction on Basescan's Logs tab. */
const firstRowLink = (page: Page) => vaultCard(page).getByRole("list", { name: "Recent decisions" }).getByRole("listitem").first().getByRole("link");
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
  test(`at ${vp.width}x${vp.height} the first screen says what Maat is and names the fork only on the replay tab`, async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.setViewportSize(vp);
    await routeLiveRpc(page, "weekend");
    await page.goto("/");
    await expect(vaultCard(page)).toHaveAttribute("data-vault-card", "recorded");

    // Spec 2026-11-27 section 1: no plate above the H1 any more; the definition is the first line under it, and the
    // card keeps the latest mainnet Decision, linked to its transaction on Basescan's Logs tab.
    await expect(page.locator("#top [data-vault-plate]")).toHaveCount(0);
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(page.locator("#top [data-hero-definition]")).toHaveText(HERO_DEFINITION);
    expect(await bottom(page.locator("#top [data-hero-definition]"))).toBeLessThanOrEqual(vp.height);
    expect(await bottom(h1)).toBeLessThanOrEqual((await page.locator("#top [data-hero-definition]").boundingBox())!.y);
    expect(NEWEST.sender).toBe("agent");
    await expect(firstRowLink(page)).toHaveAttribute("href", basescanDecision(NEWEST.transactionHash));

    // The primary CTA opens the film band directly under the hero (spec 2026-11-27 section 2); never a dead link.
    const primary = page.locator("[data-hero-cta]").first();
    await expect(primary).toHaveText(HERO_CTAS[0].label);
    await expect(primary).toHaveAttribute("href", "#film");
    await expect(page.locator("#top + #film")).toHaveCount(1);

    const words = await forkWordsInFirstScreen(page);
    expect(words.filter((w) => !w.tab)).toEqual([]);
    if (vp.width === 1440) {
      // The engine card shares the hero's row: its mainnet face is on, the replay one tab away.
      // Spec 2026-11-27 section 3: the tab says when the replay ran and what it was.
      expect(words).toEqual([{ text: "Before mainnet (fork test)", tab: true }]);
      await expect(page.locator("#top").getByRole("tab", { name: "Base mainnet" })).toHaveAttribute("aria-selected", "true");
      await expect(vaultCard(page)).toBeVisible();
      for (const cta of await page.locator("[data-hero-cta]").all()) expect(await bottom(cta)).toBeLessThanOrEqual(vp.height);
      // The one live proof: the card's latest mainnet Decision and its verdict, whole, in the first screen.
      expect(await bottom(vaultCard(page).locator("[data-latest-line]"))).toBeLessThanOrEqual(vp.height);
      expect(await bottom(vaultCard(page).locator("[data-verdict]"))).toBeLessThanOrEqual(vp.height);
    }
    // Both tabs of the engine card are 44 px targets (spec 2026-11-27, constraints), the fork one under its new name.
    // The check scrolls each to the middle of the screen, so it runs last, without smooth scrolling.
    const tabs = page.locator("#top").getByRole("tab");
    await expect(tabs).toHaveText(["Base mainnet", "Before mainnet (fork test)"]);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expectTapTargets(await tabs.all());
    expect(errors).toEqual([]);
  });
}

for (const vp of VIEWPORTS) {
  test(`at ${vp.width}x${vp.height} the card shows the vault's latest Decision read from Base, with its own time`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize(vp);
    await page.clock.setFixedTime(NOW_MS);
    await routeLiveRpc(page, "weekend");
    await routeVault(page);
    await page.goto("/");

    await expect(vaultCard(page)).toHaveAttribute("data-vault-card", "live");
    const card = vaultCard(page);
    // The card's newest Decision says its own time, so it never reads as the live line's "Right now" (spec 2026-11-27
    // section 1), and names its ticker the first time it appears (section 4).
    await expect(firstRowLink(page)).toHaveAttribute("href", basescanDecision(hash32(9)));
    await expect(card.locator("[data-latest-line]")).toHaveText("BUY NVDAc · $50.00");
    await expect(card.locator("[data-latest-when]")).toContainText(`· ${AGE} ago`);
    // Its own date first, "Thu 26 Nov 22:07 ET", never only an age.
    await expect(card.locator("[data-latest-when]")).toHaveText(/^\w{3} \d{1,2} \w{3} \d{2}:\d{2} ET · block /);
    await expect(card.locator("[data-ticker-gloss]")).toHaveText("NVDAc (NVIDIA, a B20 token on Base)");
    // The note under the card is newer than this Decision, so its quote stays.
    await expect(page.locator("#top [data-hero-note]")).toHaveAttribute("data-hero-note", "recorded");
    await expect(card.locator("[data-verdict]")).toContainText(REASON_LABEL[LONGEST]);

    await expect(card).toContainText(`${RECORDED.length + 1} Decisions on Base mainnet, read from Base by your browser.`);
    const rows = card.getByRole("list", { name: "Recent decisions" }).getByRole("listitem");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(1).getByRole("link")).toHaveAttribute("href", basescanDecision(NEWEST.transactionHash));
    await expect(card.locator("[data-verdict]")).toHaveAttribute("data-reason", LONGEST);
    await page.screenshot({ path: `test-results/screens/landing-mainnet-live-${vp.width}.png` });

    if (vp.width === 1440) {
      await expect(page.locator("[data-vault-bar]")).toHaveText(`Last Decision ${AGE} ago.`);
      // With the longest refusal on the card, both CTAs stay in the first screen, and so do the card's latest Decision
      // and its verdict.
      for (const cta of await page.locator("[data-hero-cta]").all()) expect(await bottom(cta)).toBeLessThanOrEqual(vp.height);
      expect(await bottom(card.locator("[data-latest-line]"))).toBeLessThanOrEqual(vp.height);
      expect(await bottom(card.locator("[data-verdict]"))).toBeLessThanOrEqual(vp.height);
    } else {
      await expect(page.locator("[data-vault-bar]")).toBeHidden();
    }
    expect(errors).toEqual([]);
  });
}

for (const vp of VIEWPORTS) {
  test(`at ${vp.width}x${vp.height} a compute bill reads as a bill on a neutral verdict plate, never as a trade or as Allowed`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize(vp);
    await page.clock.setFixedTime(NOW_MS);
    await routeLiveRpc(page, "weekend");
    await routeVault(page, billScenario);
    await page.goto("/");

    const card = vaultCard(page);
    await expect(card).toHaveAttribute("data-vault-card", "live");
    await expect(firstRowLink(page)).toHaveAttribute("href", basescanDecision(hash32(9)));
    await expect(card.locator("[data-latest-when]")).toContainText(`· ${AGE} ago`);
    // A bill names no ticker to explain.
    await expect(card.locator("[data-ticker-gloss]")).toHaveCount(0);
    await expect(card.locator("[data-latest-line]")).toHaveText(BILL_LINE);
    const verdict = card.locator("[data-verdict]");
    await expect(verdict).toHaveAttribute("data-verdict", "bill");
    await expect(verdict).toContainText("Paid");
    // A neutral plate: white or near-white behind ink, never the accent or the ink of a verdict.
    const { bg, color } = await verdict.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }));
    expect(bg).toBe("rgb(246, 247, 249)");
    expect(color).toBe("rgb(11, 13, 18)");
    const rows = card.getByRole("list", { name: "Recent decisions" }).getByRole("listitem");
    await expect(rows.first()).toHaveAttribute("data-decision", "bill");
    await expect(rows.first()).toContainText(BILL_LINE);
    await expect(page.locator("#top")).not.toContainText("PAY_EXPENSE");
    await page.screenshot({ path: `test-results/screens/landing-bill-${vp.width}.png` });

    if (vp.width === 1440) {
      for (const cta of await page.locator("[data-hero-cta]").all()) expect(await bottom(cta)).toBeLessThanOrEqual(vp.height);
    }
    expect(errors).toEqual([]);
  });
}

/** The time of the Decision read after the note recorded in this build: an hour after the note's round. */
const AFTER_NOTE = Math.ceil(agentNote.note.ts) + 3600;
/** The same vault, its newest Decision an hour after the agent's recorded note: the agent acted since it. */
const afterNoteScenario: FakeScenario = {
  ...scenario,
  headTime: AFTER_NOTE + 20,
  times: { ...scenario.times, [String(NEW_BLOCK)]: AFTER_NOTE },
};

for (const vp of VIEWPORTS) {
  test(`at ${vp.width}x${vp.height} the note under the card gives way to one dated line once the card's Decision is newer`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize(vp);
    await page.clock.setFixedTime((AFTER_NOTE + 3 * 3600 + 5 * 60) * 1000);
    await routeLiveRpc(page, "weekend");
    await routeVault(page, afterNoteScenario);
    await page.goto("/");

    const card = vaultCard(page);
    const note = page.locator("#top [data-hero-note]");
    // The static page quotes the note (every Decision recorded in this build is older); the read brings a newer one.
    await expect(card).toHaveAttribute("data-vault-card", "live");
    await expect(card.locator("[data-latest-when]")).toContainText(`· ${AGE} ago`);
    await expect(note).toHaveAttribute("data-hero-note", "superseded");
    await expect(note).toHaveText(
      `The vault's latest Decision is newer than the last note from Maat's agent in this build (${agentNote.note.when}). Newer rounds on /now →`,
    );
    await expect(note.locator("blockquote")).toHaveCount(0);
    await expect(note.getByRole("link", { name: "Newer rounds on /now" })).toHaveAttribute("href", "/now");
    await page.screenshot({ path: `test-results/screens/landing-note-superseded-${vp.width}.png` });
    const { violations } = await new AxeBuilder({ page }).include("#top [data-hero-note]").analyze();
    expect(violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(" ")) }))).toEqual([]);
    expect(errors).toEqual([]);
  });
}

/** The gap between the last line of the last section and the footer's heading, "Watch it say no.", in px. */
function gapAboveFooter(page: Page) {
  return page.evaluate(() => {
    const sections = document.querySelectorAll("#main > section");
    const last = sections[sections.length - 1]!.firstElementChild!.lastElementChild!;
    const heading = document.querySelector("footer h2")!;
    return heading.getBoundingClientRect().top - last.getBoundingClientRect().bottom;
  });
}

for (const vp of VIEWPORTS) {
  test(`at ${vp.width}x${vp.height} no empty band opens above "Watch it say no."`, async ({ page }) => {
    await page.setViewportSize(vp);
    await routeLiveRpc(page, "weekend");
    await page.goto("/");
    await page.locator("footer h2").scrollIntoViewIfNeeded();
    // Spec 2026-11-27 section 4: the last section ends on the footer's own padding, not on a section's full one too.
    const gap = await gapAboveFooter(page);
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(140);
  });
}

/**
 * Every visible run of text in the first screen with its computed font size, and where it sits: the H1, the live
 * strip's verdict line, a verdict plate of the vault card, or the strip's block number.
 */
function firstScreenSizes(page: Page) {
  return page.evaluate(() => {
    const runs: { px: number; text: string; in: "h1" | "verdict" | "block" | "other" }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? "").trim();
      const el = n.parentElement;
      if (text === "" || !el || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.bottom <= 0 || r.top >= window.innerHeight || r.right <= 0 || r.left >= window.innerWidth) continue;
      const where = el.closest("h1")
        ? "h1"
        : el.closest("[data-verdict-line], [data-verdict]")
          ? "verdict"
          : el.closest(".readout-figure")
            ? "block"
            : "other";
      runs.push({ px: Number.parseFloat(getComputedStyle(el).fontSize), text, in: where });
    }
    return runs;
  });
}

/**
 * In-session readings whose headline names a reason for each refused token (kind "mixed"), the strip's longest: the
 * first basket token's feed older than maxStalenessSec; and, as in e2e/instrument-states.spec.ts, each token refused
 * for its own reason (FEED_STALE, MULTIPLIER_COOLDOWN, PREMIUM_TOO_HIGH).
 */
function sessionReading(refuse: "one" | "three"): Scenario {
  const [stale, cooling, premium] = FACTS.basket.value;
  const { maxPremiumBps, maxStalenessSec, twapWindowSec } = FACTS.mandate.value;
  let r = fixtureResults(SESSION_TS);
  for (const symbol of FACTS.basket.value) {
    const twap = twapOf(r, symbol, twapWindowSec);
    const answer = refuse === "three" && symbol === premium ? (twap * 10_000n) / BigInt(10_000 + 2 * maxPremiumBps + 100) : twap;
    r = withFeed(r, symbol, answer, symbol === stale ? SESSION_TS - maxStalenessSec - 600 : SESSION_TS - 10);
  }
  if (refuse === "three") {
    // effectiveAt: the third of each token's five calls, after the block number and the timestamp.
    const i = NAV_TOKENS.findIndex((t) => t.symbol === cooling);
    r[2 + i * 5 + 2] = { success: true, returnData: `0x${word(BigInt(SESSION_TS + 3600))}` };
  }
  return { results: r, open: true };
}

const READINGS = [
  { name: "the weekend's refusal", clock: WEEKEND_TS + 5, scenario: (): Scenario => "weekend", kind: "refuse-all" },
  { name: "one stale feed", clock: SESSION_TS + 5, scenario: () => sessionReading("one"), kind: "mixed" },
  { name: "three refusals", clock: SESSION_TS + 5, scenario: () => sessionReading("three"), kind: "mixed" },
] as const;

for (const vp of VIEWPORTS) for (const reading of READINGS) {
  test(`at ${vp.width}x${vp.height} with ${reading.name}, the largest text in the first screen after the H1 is a verdict, and the strip sets its verdict above and larger than the block number`, async ({
    page,
  }) => {
    await page.setViewportSize(vp);
    await page.clock.install({ time: reading.clock * 1000 });
    await routeLiveRpc(page, reading.scenario());
    await page.goto("/");
    const strip = page.locator("#top [data-live-strip]");
    await expect(strip).toHaveAttribute("data-live-strip", "live");
    await expect(strip.locator("[data-verdict-line]")).toHaveAttribute("data-verdict-line", reading.kind);
    await page.evaluate(() => document.fonts.ready);

    const runs = (await firstScreenSizes(page)).filter((r) => r.in !== "h1");
    const largest = Math.max(...runs.map((r) => r.px));
    const top = runs.filter((r) => r.px === largest);
    expect(top.length).toBeGreaterThan(0);
    expect(top.filter((r) => r.in !== "verdict"), `the ${largest} px text`).toEqual([]);
    // The block number is no longer the largest numeral on the screen.
    expect(runs.filter((r) => r.in === "block").every((r) => r.px < largest)).toBe(true);

    const line = strip.locator("[data-verdict-line]");
    // A mixed line keeps its reasons at the strip's 13 px; its verb, Refused, is set at the verdict size.
    const verdict = reading.kind === "mixed" ? line.locator("[data-verdict-word]") : line;
    const block = strip.locator(".readout-figure");
    const size = (l: Locator) => l.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
    // At 390 px the vault card is below the first screen, so the strip's verdict is the largest text after the H1; at
    // 1440 px the card's verdict plate, beside it, is.
    if (vp.width === 390) expect(await size(verdict)).toBe(largest);
    expect(await size(verdict)).toBeGreaterThan(await size(block));
    expect((await line.boundingBox())!.y).toBeLessThan((await block.boundingBox())!.y);
    const shot = reading.kind === "refuse-all" ? "" : `-${reading.name.replaceAll(" ", "-")}`;
    await page.screenshot({ path: `test-results/screens/landing-verdict-first${shot}-${vp.width}.png` });
  });
}

test("when Base does not answer, the landing shows the recorded Decisions and reads again on Read again", async ({ page }) => {
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
  await expect(firstRowLink(page)).toHaveAttribute("href", basescanDecision(NEWEST.transactionHash));
  await expect(card).toContainText("recorded · could not read Base");
  await expect(card).toContainText(`Could not read the vault on Base, so this shows the ${RECORDED.length} Decisions recorded in this build.`);
  const rows = card.getByRole("list", { name: "Recent decisions" }).getByRole("listitem");
  await expect(rows).toHaveCount(RECORDED.length);
  for (const [i, r] of RECORDED.entries()) await expect(rows.nth(i).getByRole("link")).toHaveAttribute("href", basescanDecision(r.transactionHash));
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

// The pages, as the bar lists them too; the owner's switch, content/ask-open.ts, adds Ask and Proof after Ledger
// (e2e/nav.spec.ts checks the nav at each width).
const MENU = [
  ["Now", "/now"],
  ["Gap Index", "/gap-index"],
  ["Ledger", "/ledger"],
  ...(ASK_OPEN ? [["Ask", "/ask"], ["Proof", "/proof"]] : []),
  ["Docs", SITE.docsUrl],
] as const;
const MENU_NAMES = MENU.map(([name]) => name);

test(`at 390 px the Menu lists ${MENU_NAMES.slice(0, -1).join(", ")} and Docs, and opens the Gap Index`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await routeLiveRpc(page, "weekend");
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" });
  // The bar's links are display: none up to 720 px, and the menu's while it is closed.
  await expect(nav.getByRole("link", { name: "Gap Index" })).toBeHidden();
  const pages = nav.getByRole("list", { name: "Pages" });
  await expect(pages).toBeHidden();
  await nav.locator("[data-phone-menu] > summary").click();
  await expect(pages).toBeVisible();
  const links = pages.getByRole("link");
  await expect(links).toHaveText(MENU_NAMES);
  expect(await links.evaluateAll((els) => els.map((el) => el.getAttribute("href")))).toEqual(MENU.map(([, href]) => href));
  await pages.getByRole("link", { name: "Gap Index" }).click();
  await expect(page).toHaveURL(/\/gap-index$/);
});

test("at 1440 px the Menu gives way to the pages, and the problem section links the Gap Index", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await routeLiveRpc(page, "weekend");
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.locator("[data-phone-menu] > summary")).toBeHidden();
  const bar = nav.getByRole("link");
  await expect(bar).toHaveText(["maat", ...MENU_NAMES, "View on GitHub ↗"]);
  expect(await bar.evaluateAll((els) => els.slice(1, -1).map((el) => el.getAttribute("href")))).toEqual(MENU.map(([, href]) => href));
  const gap = page.locator('section[aria-labelledby="problem-title"]').getByRole("link", { name: /^Weekend Gap Index · / });
  await expect(gap).toBeVisible();
  await expect(gap).toHaveAttribute("href", "/gap-index");
});
