import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, type Route, test } from "@playwright/test";
import { getAddress, keccak256, toBytes, type Address, type Hash } from "viem";
import { regularSession } from "../content/calendar";
import { FACTS } from "../content/facts";
import addresses from "../content/generated/base-addresses.json" with { type: "json" };
import deployments from "../content/generated/deployments.json" with { type: "json" };
import { deploymentConfig } from "../lib/chain/config";
import { canon } from "../lib/chain/rationale";
import { decisionLog, hash32 } from "../test/helpers/fake-ledger";
import { executeCalldata, JOURNAL_HASHES, JOURNAL_LINES } from "../test/helpers/maat-v1";
import { fixtureResults, routeLiveRpc } from "./fake-live-rpc";
import { installFakeChain, RPC_HOSTS, type FakeScenario } from "./fake-rpc";
import { collectErrors, JOURNAL_RAW_URL as JOURNAL, measureFit } from "./helpers";

// /now's market week and the agent's latest note (culture plan 2026-11-26, Move 8), end to end on the built site. The
// visitor's clock is frozen (page.clock.setFixedTime) in a closed window and in an open one; the live board reads the
// recorded multicall of e2e/fake-live-rpc.ts at a block 5 s before that clock; the vault's Decisions come from the fake
// chain of e2e/fake-rpc.ts through /ledger's loader; and the agent-journal branch is served here. No test touches the
// network.

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

const utc = (y: number, mo: number, d: number, h: number, mi: number) => Date.UTC(y, mo - 1, d, h, mi) / 1000;
/** Sat 28 Nov 2026 10:00 ET: closed, in the week of Thanksgiving and the Friday 13:00 ET early close. */
const CLOSED_AT = utc(2026, 11, 28, 15, 0);
/** Mon 30 Nov 2026 11:00 ET: in session. */
const OPEN_AT = utc(2026, 11, 30, 16, 0);

const RECORDED = deploymentConfig(deployments)!;
const VAULT = RECORDED.vault;
const DEPLOY = 61_698_517n;
const OWNER: Address = getAddress("0x00000000000000000000000000000000000000a1");
const USDC = getAddress(addresses.find((a) => a.name === "USDC")!.value);
const NVDAC = getAddress(addresses.find((a) => a.name === "NVDAC")!.value);
const [FIRST, SECOND] = [...FACTS.mainnetDecisions.value].sort((a, b) => a.blockTime - b.blockTime);
/** A Decision of the open week: Mon 30 Nov 10:15 ET, allowed, about three blocks a second after the recorded ones. */
const MONDAY_BLOCK = BigInt(SECOND!.blockNumber) + BigInt(Math.floor((utc(2026, 11, 30, 15, 15) - SECOND!.blockTime) / 2));
const MONDAY_TIME = utc(2026, 11, 30, 15, 15);
const HEAD = MONDAY_BLOCK + 2_000n;

/**
 * The vault on a fake Base: the two Decisions recorded in this build (Tue 24 Nov 09:28 ET refused, 11:59 ET allowed),
 * and an allowed one on Mon 30 Nov 10:15 ET, each sent by the vault's owner, as every mainnet Decision so far was.
 */
const scenario: FakeScenario = {
  head: HEAD,
  headTime: MONDAY_TIME + 4_000,
  vault: VAULT,
  logs: [
    ...FACTS.mainnetDecisions.value.map(({ blockNumber, logIndex, transactionHash, topics, data }) => ({ blockNumber, logIndex, transactionHash, topics: [...topics], data })),
    decisionLog(9, MONDAY_BLOCK, { token: NVDAC, amount: 5_000_000n }),
  ],
  times: { ...Object.fromEntries(FACTS.mainnetDecisions.value.map((l) => [l.blockNumber, l.blockTime])), [String(MONDAY_BLOCK)]: MONDAY_TIME },
  receipts: {
    [RECORDED.deployTx!.toLowerCase()]: { block: DEPLOY, gasUsed: 4_000_000n },
    ...Object.fromEntries(FACTS.mainnetDecisions.value.map((l) => [l.transactionHash.toLowerCase(), { block: BigInt(l.blockNumber), gasUsed: BigInt(l.gasUsed) }])),
    [hash32(9)]: { block: MONDAY_BLOCK, gasUsed: 110_000n },
  },
  txs: Object.fromEntries(
    [...FACTS.mainnetDecisions.value.map((l) => l.transactionHash.toLowerCase()), hash32(9)].map((h) => [
      h,
      { from: OWNER, to: VAULT, input: executeCalldata({ rationaleHash: keccak256(toBytes(h)) }) },
    ]),
  ),
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
 * Sends the vault reader's requests to the fake chain: its batched calls (viem's http batch posts an array) and its
 * eth_getLogs, which lib/chain/rpc.ts sends on its own. Every other request, the board's multicall, goes on to the live
 * fake. Routed after that fake, so this handler runs first.
 */
async function routeVault(page: Page) {
  let answer: ((route: Route) => Promise<void>) | undefined;
  const capture = { route: async (_match: unknown, handler: (route: Route) => Promise<void>) => void (answer = handler) };
  await installFakeChain(capture as unknown as Page, scenario);
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

/** A later round of the agent, chained after the spec's two lines: the note the closed-window test expects. */
const NOTE = "NYSE is closed until Monday 09:30 ET, so I proposed nothing.";
function noteLine(): string {
  const fields = {
    kind: "run",
    ts: "2026-11-28T14:45:00.000Z",
    runId: "1795877100000-0a0b0c0d",
    commit: "0123456789abcdef0123456789abcdef01234567",
    block: "62000000",
    day: "20785",
    mode: "live",
    ok: true,
    costUsd6: "2900",
    suggestions: 0,
    proposals: 0,
    summary: NOTE,
    prev: JOURNAL_HASHES[1]!,
  };
  return canon({ ...fields, hash: keccak256(toBytes(canon(fields))) as Hash });
}

/** Serves the agent-journal branch: `files` (day file → text), or 404 for everything when it is null (the branch today). */
async function serveJournal(page: Page, files: Record<string, string> | null) {
  await page.route(`${JOURNAL}**`, (route) => {
    const name = route.request().url().slice(JOURNAL.length);
    const cors = { "access-control-allow-origin": "*" };
    if (files === null || !(name === "index.json" || name in files)) return route.fulfill({ status: 404, headers: cors, body: "404: Not Found" });
    if (name === "index.json") return route.fulfill({ status: 200, headers: cors, body: canon({ days: Object.keys(files), v: 1 }) });
    return route.fulfill({ status: 200, headers: cors, body: files[name]! });
  });
}

const PUBLISHED = { "2026-11-24.jsonl": [...JOURNAL_LINES].map((l) => `${l}\n`).join(""), "2026-11-28.jsonl": `${noteLine()}\n` };

/** Freezes the visitor's clock at `at` and serves the board's reading at a block 5 s earlier. */
async function setUp(page: Page, at: number, journal: Record<string, string> | null, opts: { hold?: boolean } = {}) {
  await page.clock.setFixedTime(at * 1000);
  const block = at - 5;
  const rpc = await routeLiveRpc(page, { results: fixtureResults(block), open: regularSession(block).open }, opts);
  await routeVault(page);
  await serveJournal(page, journal);
  return rpc;
}

const week = (page: Page) => page.locator("[data-market-week]");
const day = (page: Page, iso: string) => page.locator(`[data-week-days] > li[data-day="${iso}"]`);

/** Where an element's center sits along a bar, as a share of the bar's width. */
async function along(el: Locator, bar: Locator): Promise<number> {
  const [e, b] = [(await el.boundingBox())!, (await bar.boundingBox())!];
  return (e.x + e.width / 2 - b.x) / b.width;
}

const bar = (row: Locator) => row.locator("[data-span]").first().locator("xpath=..");

for (const vp of VIEWPORTS) {
  test(`at ${vp.width}x${vp.height}, a closed window: the large line, Thanksgiving week from the calendar, the ticks and the note`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize(vp);
    await setUp(page, CLOSED_AT, PUBLISHED);
    await page.goto("/now");
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("[data-now-board]")).toHaveAttribute("data-now-board", "live");

    // The line from the live read, set large, with the hatch of the closed windows beside it.
    const line = page.locator("[data-session-line]");
    await expect(line).toHaveText("NYSE closed · the vault refuses trades until Mon 09:30 ET");
    await expect(line).toHaveAttribute("data-session-line", "closed");
    expect(await line.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(24);

    // The week of the clock, Monday to Sunday, from the calendar: Thanksgiving closed, Friday's early close, the weekend.
    await expect(week(page)).toHaveAttribute("data-market-week", "drawn");
    const rows = page.locator("[data-week-days] > li");
    await expect(rows).toHaveCount(7);
    await expect(rows.first()).toContainText("Mon 23 Nov");
    await expect(day(page, "2026-11-26")).toContainText("Closed: Thanksgiving");
    await expect(day(page, "2026-11-27")).toContainText("Open 09:30–13:00 ET, early close");
    await expect(day(page, "2026-11-28")).toContainText("Closed: weekend");
    await expect(day(page, "2026-11-28")).toHaveAttribute("aria-current", "date");

    // Every closed window wears the refuse hatch, and an open session none.
    const hatched = await page.locator("[data-span]").evaluateAll((spans) =>
      spans.map((s) => [s.getAttribute("data-span"), getComputedStyle(s).backgroundImage.includes("repeating-linear-gradient")]),
    );
    expect(hatched.length).toBe(3 * 3 + 1 + 4 + 1 + 1);
    for (const [kind, hatch] of hatched) expect(hatch, String(kind)).toBe(kind !== "open");

    // Friday's session ends at 13:00 ET: the hatch starts at 780 of the 1440 minutes.
    const friday = day(page, "2026-11-27");
    const early = friday.locator('[data-span="early-close"]');
    const [e, fb] = [(await early.boundingBox())!, (await bar(friday).boundingBox())!];
    expect((e.x - fb.x) / fb.width).toBeCloseTo(780 / 1440, 2);

    // The now line sits on Saturday at 10:00 ET.
    const saturday = day(page, "2026-11-28");
    await expect(saturday.locator("[data-now-marker]")).toHaveCount(1);
    expect(await along(saturday.locator("[data-now-marker]"), bar(saturday))).toBeCloseTo(600 / 1440, 2);
    await expect(saturday).toContainText("now 10:00 ET");

    // The two recorded Decisions are ticks on Tuesday: the refusal two minutes before the open, the allowed one at 11:59.
    const tuesday = day(page, "2026-11-24");
    const ticks = tuesday.locator("[data-tick]");
    await expect(ticks).toHaveCount(2);
    await expect(page.locator("[data-tick]")).toHaveCount(2);
    expect(await along(ticks.nth(0), bar(tuesday))).toBeCloseTo((9 * 60 + 28) / 1440, 2);
    expect(await along(ticks.nth(1), bar(tuesday))).toBeCloseTo((11 * 60 + 59) / 1440, 2);
    await expect(ticks.nth(0)).toHaveAttribute("data-verdict", "refused");
    await expect(ticks.nth(1)).toHaveAttribute("data-verdict", "allowed");
    await expect(page.locator("[data-week-count]")).toHaveText("2 Decisions this week");
    const items = page.locator("[data-week-decisions] > li");
    await expect(items).toHaveText([
      "Weighing № 1 · Tue 24 Nov 09:28 ET · Refused · Market closed (MARKET_CLOSED) · BUY NVDAc · $5.00 · owner, by hand · Basescan ↗",
      "Weighing № 2 · Tue 24 Nov 11:59 ET · Allowed · All checks passed (OK) · BUY NVDAc · $5.00 · owner, by hand · Basescan ↗",
    ]);
    expect(FIRST!.transactionHash).not.toBe(SECOND!.transactionHash);

    // The agent's latest note, verbatim, with its ET time and its commit.
    const note = page.locator("[data-agent-note]");
    await expect(note.locator("[data-agent-note-head]")).toHaveText("Latest note from Maat's agent · Sat 28 Nov 09:45 ET · journal 0123456 ↗");
    await expect(note.locator("blockquote")).toHaveText(NOTE);

    const fit = await measureFit(page);
    expect(fit.overflow).toBeLessThanOrEqual(0);
    expect(fit.clipped).toEqual([]);
    await page.screenshot({ path: `test-results/screens/now-week-closed-${vp.width}.png`, fullPage: true });
    await page.screenshot({ path: `test-results/screens/now-week-closed-top-${vp.width}.png` });
    await week(page).screenshot({ path: `test-results/screens/now-week-closed-section-${vp.width}.png` });
    await note.screenshot({ path: `test-results/screens/now-week-note-${vp.width}.png` });
    expect(errors).toEqual([]);
  });

  test(`at ${vp.width}x${vp.height}, an open window: the plain line, Monday's tick, and no note while the journal has none`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize(vp);
    await setUp(page, OPEN_AT, { "2026-11-30.jsonl": "" });
    await page.goto("/now");
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("[data-now-board]")).toHaveAttribute("data-now-board", "live");

    const line = page.locator("[data-session-line]");
    await expect(line).toHaveText("NYSE open until 16:00 ET");
    await expect(line).toHaveAttribute("data-session-line", "open");
    await expect(page.locator("[data-hatch-swatch]")).toHaveCount(0);
    await expect(page.getByText("NYSE closed", { exact: false })).toHaveCount(0);

    const monday = day(page, "2026-11-30");
    await expect(page.locator("[data-week-days] > li").first()).toHaveAttribute("data-day", "2026-11-30");
    await expect(monday).toHaveAttribute("aria-current", "date");
    expect(await along(monday.locator("[data-now-marker]"), bar(monday))).toBeCloseTo(660 / 1440, 2);
    await expect(page.locator("[data-week-count]")).toHaveText("1 Decision this week");
    const tick = monday.locator("[data-tick]");
    await expect(tick).toHaveAttribute("data-verdict", "allowed");
    expect(await along(tick, bar(monday))).toBeCloseTo((10 * 60 + 15) / 1440, 2);
    await expect(page.locator("[data-week-decisions] > li")).toHaveText([
      "Weighing № 3 · Mon 30 Nov 10:15 ET · Allowed · All checks passed (OK) · BUY NVDAc · $5.00 · owner, by hand · Basescan ↗",
    ]);

    // An empty journal holds no note, so there is no tile at all.
    await expect(page.locator("[data-agent-note]")).toHaveCount(0);
    await expect(page.getByText("Latest note from Maat's agent")).toHaveCount(0);

    const fit = await measureFit(page);
    expect(fit.overflow).toBeLessThanOrEqual(0);
    expect(fit.clipped).toEqual([]);
    await page.screenshot({ path: `test-results/screens/now-week-open-${vp.width}.png`, fullPage: true });
    await week(page).screenshot({ path: `test-results/screens/now-week-open-section-${vp.width}.png` });
    expect(errors).toEqual([]);
  });

  test(`at ${vp.width}x${vp.height}, the week does not move when the reading lands`, async ({ page }) => {
    await page.setViewportSize(vp);
    const rpc = await setUp(page, CLOSED_AT, PUBLISHED, { hold: true });
    await page.goto("/now");
    await page.evaluate(() => document.fonts.ready);
    await expect(week(page)).toHaveAttribute("data-market-week", "drawn");
    await expect(page.locator("[data-now-board]")).toHaveAttribute("data-now-board", "reading");
    const before = (await page.locator("[data-week-days]").boundingBox())!.y;
    rpc.release();
    await expect(page.locator("[data-session-line]")).toHaveAttribute("data-session-line", "closed");
    expect((await page.locator("[data-week-days]").boundingBox())!.y).toBe(before);
  });
}

test("the week is reached by keyboard: Tab lands on each Decision's Basescan link, which names its Weighing", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setUp(page, CLOSED_AT, PUBLISHED);
  await page.goto("/now");
  await expect(page.locator("[data-week-decisions] > li")).toHaveCount(2);
  const names: string[] = [];
  for (let i = 0; i < 30 && names.length < 2; i++) {
    await page.keyboard.press("Tab");
    const name = await page.evaluate(() => (document.activeElement?.closest("[data-week-decisions]") ? document.activeElement.getAttribute("aria-label") : null));
    if (name !== null) names.push(name);
  }
  expect(names).toEqual([
    `Weighing № 1, transaction ${FIRST!.transactionHash.slice(0, 10)}… on Basescan`,
    `Weighing № 2, transaction ${SECOND!.transactionHash.slice(0, 10)}… on Basescan`,
  ]);
});

for (const vp of VIEWPORTS) {
  test(`at ${vp.width}px, /now with the week and the note has no axe violations, and nothing moves under reduced motion`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setUp(page, CLOSED_AT, PUBLISHED);
    await page.goto("/now");
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("[data-agent-note]")).toBeVisible();
    await expect(page.locator("[data-week-decisions] > li")).toHaveCount(2);
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 5) }))).toEqual([]);
  });
}

test("while the agent-journal branch does not exist, /now shows no note and no placeholder", async ({ page }) => {
  const errors = collectErrors(page);
  await setUp(page, CLOSED_AT, null);
  const asked = page.waitForRequest(`${JOURNAL}index.json`);
  await page.goto("/now");
  await asked;
  await expect(page.locator("[data-week-decisions] > li")).toHaveCount(2);
  await expect(page.locator("[data-agent-note]")).toHaveCount(0);
  await expect(page.getByText(/note from Maat's agent/)).toHaveCount(0);
  // The only error is the browser's line for GitHub's 404, as for the branch today.
  expect(errors.filter((e) => !/status of 404/.test(e))).toEqual([]);
});
