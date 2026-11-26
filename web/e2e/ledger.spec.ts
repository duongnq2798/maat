import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { getAddress, keccak256, toBytes, toHex, type Hash, type Hex } from "viem";
import addresses from "../content/generated/base-addresses.json" with { type: "json" };
import deployments from "../content/generated/deployments.json" with { type: "json" };
import { deploymentConfig } from "../lib/chain/config";
import { decisionLog, hash32 } from "../test/helpers/fake-ledger";
import { blockBase, installFakeChain, RPC_HOSTS, type FakeScenario } from "./fake-rpc";
import { collectErrors, measureFit } from "./helpers";

const addr = (name: string) => getAddress(addresses.find((a) => a.name === name)!.value);
const USDC = addr("USDC");
const NVDAC = addr("NVDAC");
const GOOGLC = addr("GOOGLC");
const NVDA_FEED = addr("NVDA_FEED");
const GOOGL_FEED = addr("GOOGL_FEED");
const CREDIT = getAddress("0x0000000000000000000000000000000000000c03");

// The build serves the committed deployments table at /data/deployments.json, so the page reads the real vault. The
// fake chain answers for that address, and for its deploy tx with the block it was mined in on Base (61,698,517).
const RECORDED = deploymentConfig(deployments)!;
const VAULT = RECORDED.vault;
const DEPLOY_TX = RECORDED.deployTx!;
const DEPLOY = 61_698_517n;
const HEAD = DEPLOY + 120_000n;
const T0 = 1_795_707_000; // Thu 26 Nov 2026 15:30 UTC
const HEAD_TIME = T0 + 7300;
const VERIFIED = "NVDAc is 12 points under target; buying $20 in session.";

const scenario: FakeScenario = {
  head: HEAD,
  headTime: HEAD_TIME,
  vault: VAULT,
  logs: [
    decisionLog(1, DEPLOY + 5n, { rationaleHash: keccak256(toBytes(VERIFIED)) }),
    decisionLog(2, DEPLOY + 60_000n, { token: GOOGLC, reason: "MARKET_CLOSED", amount: 10_000_000n }),
    decisionLog(3, HEAD - 10n, { reason: "SIZE_LIMIT", amount: 90_000_000n }),
  ],
  times: { [String(DEPLOY + 5n)]: T0, [String(DEPLOY + 60_000n)]: T0 + 86_400, [String(HEAD - 10n)]: T0 + 2 * 86_400 },
  receipts: {
    [DEPLOY_TX.toLowerCase()]: { block: DEPLOY, gasUsed: 4_000_000n },
    [hash32(1)]: { block: DEPLOY + 5n, gasUsed: 758_192n },
    [hash32(2)]: { block: DEPLOY + 60_000n, gasUsed: 111_116n },
    [hash32(3)]: { block: HEAD - 10n, gasUsed: 111_116n },
  },
  calls: {
    [VAULT.toLowerCase()]: {
      TIMELOCK: 86_400n,
      owner: getAddress("0x0000000000000000000000000000000000000001"),
      executor: getAddress("0x0000000000000000000000000000000000000002"),
      paused: false,
      mandate: {
        sessionMode: 0,
        maxPremiumBps: 100,
        maxSlippageBps: 100,
        maxStaleness: 3600,
        multiplierCooldown: 86_400,
        twapWindow: 1800,
        perTradeCapUsd: 50_000_000n,
        dailyCapUsd: 100_000_000n,
        calendar: getAddress("0x0000000000000000000000000000000000000c01"),
        swapAdapter: getAddress("0x0000000000000000000000000000000000000c02"),
        creditAdapter: CREDIT,
        minHealthFactor: 1_500_000_000_000_000_000n,
        targetHealthFactor: 2_000_000_000_000_000_000n,
        deriskWindow: 28_800,
      },
      mandateHash: hash32(77),
      tokens: [NVDAC, GOOGLC],
      usdc: USDC,
      tokenConfig: ([token]: readonly unknown[]) => [true, token === NVDAC ? NVDA_FEED : GOOGL_FEED, getAddress("0x0000000000000000000000000000000000000d01"), 4000],
    },
    [NVDAC.toLowerCase()]: { balanceOf: 81_000_000_000_000_000n, balanceOfUI: 81_043_570_000_000_000n, decimals: 18 },
    [GOOGLC.toLowerCase()]: { balanceOf: 100_000_000_000_000_000n, balanceOfUI: 100_000_000_000_000_000n, decimals: 18 },
    [USDC.toLowerCase()]: { balanceOf: 30_000_000n },
    [NVDA_FEED.toLowerCase()]: { latestRoundData: [1n, 18_512_000_000n, BigInt(HEAD_TIME - 14), BigInt(HEAD_TIME - 14), 1n] },
    [GOOGL_FEED.toLowerCase()]: { latestRoundData: [1n, 17_000_000_000n, BigInt(HEAD_TIME - 30), BigInt(HEAD_TIME - 30), 1n] },
    [CREDIT.toLowerCase()]: { debt: 5_000_000n, healthFactor: 2_400_000_000_000_000_000n, suppliedOf: 0n },
  },
};

/** Hosts the page asked for, other than the test server. */
function externalHosts(page: Page): Set<string> {
  const hosts = new Set<string>();
  page.on("request", (r) => {
    const host = new URL(r.url()).host;
    if (host !== "localhost:4173") hosts.add(host);
  });
  return hosts;
}

async function blockingViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`);
}

// The waiting view, for a build whose deployments table has no vault (a fork of the repository before its own deploy).
// The committed table records one, so the test serves the page a deployments file without it.
test.describe("/ledger with a deployments file that has no vault", () => {
  let stopped: string[];
  test.beforeEach(async ({ page }) => {
    stopped = await blockBase(page);
    await page.route("**/data/deployments.json", (route) =>
      route.fulfill({ json: { network: "Base mainnet", chainId: 8453, vault: null, deployTx: null, contracts: [] } }),
    );
  });

  for (const width of [360, 768, 1440, 1920] as const) {
    test(`fits ${width}px, waits without calling Base, and logs no errors`, async ({ page }) => {
      const errors = collectErrors(page);
      const hosts = externalHosts(page);
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/ledger", { waitUntil: "networkidle" });
      await expect(page.getByText("Waiting for the mainnet deploy")).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const fit = await measureFit(page);
      expect(fit.overflow).toBeLessThanOrEqual(0);
      expect(fit.clipped).toEqual([]);
      await page.screenshot({ path: `test-results/screens/ledger-waiting-${width}.png`, fullPage: true });
      expect(stopped).toEqual([]);
      expect([...hosts]).toEqual([]);
      expect(errors).toEqual([]);
    });
  }

  test("has no serious or critical axe violations", async ({ page }) => {
    await page.goto("/ledger", { waitUntil: "networkidle" });
    await expect(page.getByText("Waiting for the mainnet deploy")).toBeVisible();
    expect(await blockingViolations(page)).toEqual([]);
    expect(stopped).toEqual([]);
  });
});

test.describe("/ledger as built, before Base answers", () => {
  test("starts by connecting to the vault the deployments table records, never waiting", async ({ page }) => {
    const stopped = await blockBase(page);
    const res = await page.request.get("/data/deployments.json");
    expect(await res.json()).toMatchObject({ vault: VAULT, deployTx: DEPLOY_TX });
    await page.goto("/ledger");
    await expect(page.getByText(/Connecting to Base|Base could not be read/)).toBeVisible();
    await expect(page.getByText("Waiting for the mainnet deploy")).toHaveCount(0);
    // Every request it tried went to a Base RPC, and none left the browser.
    await expect.poll(() => stopped.length).toBeGreaterThan(0);
    expect(stopped.every((u) => RPC_HOSTS.includes(new URL(u).host))).toBe(true);
  });
});

test.describe("/ledger reading a fake Base mainnet", () => {
  let logRequests: { address: string; from: bigint; to: bigint }[] = [];
  test.beforeEach(async ({ page }) => {
    await page.route("**/data/rationales.json", (route) =>
      route.fulfill({
        json: [
          { intentId: hash32(1001), rationaleHash: keccak256(toBytes(VERIFIED)), text: VERIFIED, txHash: hash32(1), ts: "2026-11-26T15:30:00Z" },
          { intentId: hash32(1002), rationaleHash: hash32(5002), text: "This text was edited after the fact.", txHash: hash32(2), ts: "2026-11-27T15:30:00Z" },
        ],
      }),
    );
    logRequests = [];
    await installFakeChain(page, { ...scenario, onLogs: (r) => logRequests.push(r) });
  });

  test("reads the recorded vault from its deploy block", async ({ page }) => {
    await page.goto("/ledger");
    await expect(page.getByRole("list", { name: "Mainnet decisions" }).getByRole("listitem")).toHaveCount(3);
    await expect(page.getByText(/Reading the vault's history/)).toHaveCount(0);
    await expect(page.getByRole("link", { name: /vault on Basescan/ })).toHaveAttribute("href", `https://basescan.org/address/${VAULT}`);
    expect(logRequests.length).toBeGreaterThan(0);
    expect(logRequests.every((r) => r.address.toLowerCase() === VAULT.toLowerCase())).toBe(true);
    expect(logRequests.reduce((min, r) => (r.from < min ? r.from : min), HEAD)).toBe(DEPLOY);
    expect(logRequests.reduce((max, r) => (r.to > max ? r.to : max), 0n)).toBe(HEAD);
  });

  test("lists the vault's decisions, verifies rationales and reads the treasury", async ({ page }) => {
    const errors = collectErrors(page);
    const hosts = externalHosts(page);
    await page.goto("/ledger");
    const decisions = page.getByRole("list", { name: "Mainnet decisions" }).getByRole("listitem");
    await expect(decisions).toHaveCount(3);
    await expect(page.getByText(/Reading Base mainnet/)).toContainText(`block ${Number(HEAD).toLocaleString("en-US")}`);
    await expect(decisions.first().getByRole("link", { name: /Basescan/ })).toHaveAttribute("href", `https://basescan.org/tx/${hash32(3)}`);
    await expect(page.getByText("Hash verified", { exact: true })).toBeVisible();
    await expect(page.getByText("Hash mismatch", { exact: true })).toBeVisible();
    await expect(page.getByText("Rationale not exported yet", { exact: true })).toBeVisible();
    await expect(page.getByRole("table", { name: "Treasury" }).getByRole("row", { name: /NVDAc/ })).toContainText("0.081");
    await expect(page.getByRole("img", { name: /Health factor 2.40/ })).toBeVisible();

    const bar = page.getByRole("group", { name: /Refusals by reason/ }).getByRole("button", { name: /MARKET_CLOSED/ });
    await bar.click();
    await expect(decisions).toHaveCount(1);
    await expect(decisions.first()).toContainText("MARKET_CLOSED");
    await bar.click();
    await expect(decisions).toHaveCount(3);

    expect([...hosts].every((h) => RPC_HOSTS.includes(h))).toBe(true);
    expect(errors).toEqual([]);
  });

  for (const width of [360, 1440] as const) {
    test(`fits ${width}px once the vault is read`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/ledger");
      await expect(page.getByRole("list", { name: "Mainnet decisions" }).getByRole("listitem")).toHaveCount(3);
      await expect(page.getByText(/Reading the vault's history/)).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready);
      const fit = await measureFit(page);
      expect(fit.overflow).toBeLessThanOrEqual(0);
      expect(fit.clipped).toEqual([]);
      await page.screenshot({ path: `test-results/screens/ledger-mainnet-${width}.png`, fullPage: true });
    });
  }

  test("has no serious or critical axe violations once read", async ({ page }) => {
    await page.goto("/ledger");
    await expect(page.getByRole("list", { name: "Mainnet decisions" }).getByRole("listitem")).toHaveCount(3);
    expect(await blockingViolations(page)).toEqual([]);
  });
});

// The vault's two Decision events on Base mainnet, with the topics, data, log index, block time and gas their receipts
// record: the owner-sent 5 USDC BUY of NVDAc the vault refused with reason 6 (MARKET_CLOSED), then the same BUY it
// allowed. The page reads the committed /data/rationales.json (no stub), so each row must show "Hash verified".
const DECISION_TOPIC = "0x31e6f801fe8c4e61fff662a75a05831c8f1341359c56a18463b2a33bfa2df322";
const NVDAC_TOPIC = "0x000000000000000000000000b20000000000000000000078ee7ce2fe4908108c";
const MAINNET_RATIONALE_HASH = "0x0baa4c52e17e7acc5c7cc851e57a9df523c70b5a1530d77055bb2401370f57f6";
const OWNER_TEXT = "Owner-sent first decision: BUY 5 USD of NVDAc";
const word = (n: bigint) => toHex(n, { size: 32 }).slice(2);
const MAINNET = [
  {
    tx: "0xdfdb6739912a73542d90129bd7269a939dc8b2d47a869f56d9ab5e3a02e86c3b",
    block: 61_700_601n,
    logIndex: 24,
    time: 1_795_530_495,
    gasUsed: 113_352n,
    intentId: "0xdc06ec8e29767044d325cc10445a942d26a463a4ed08487b013c5fed2a59243c",
    allowed: false,
    reason: 6n,
  },
  {
    tx: "0x61622340a151c73c3f2b3bc910292a3e3136bd4aa7ecd55a92f59914953a23c8",
    block: 61_745_836n,
    logIndex: 46,
    time: 1_795_539_542,
    gasUsed: 702_443n,
    intentId: "0x475efb77a4242345466f42fc844ac578b99716db50eca20d0ffe27549a68ee3d",
    allowed: true,
    reason: 0n,
  },
] as const;

test.describe("/ledger reading the vault's two mainnet Decisions with the committed rationales", () => {
  test.beforeEach(async ({ page }) => {
    await installFakeChain(page, {
      ...scenario,
      logs: MAINNET.map((m) => ({
        blockNumber: m.block.toString(),
        logIndex: m.logIndex,
        transactionHash: m.tx as Hash,
        topics: [DECISION_TOPIC, m.intentId, NVDAC_TOPIC] as Hex[],
        // action 0 (BUY), amount 5000000 (5 USDC), allowed, reason, rationaleHash
        data: `0x${word(0n)}${word(5_000_000n)}${word(m.allowed ? 1n : 0n)}${word(m.reason)}${MAINNET_RATIONALE_HASH.slice(2)}`,
      })),
      times: Object.fromEntries(MAINNET.map((m) => [m.block.toString(), m.time])),
      receipts: {
        [DEPLOY_TX.toLowerCase()]: { block: DEPLOY, gasUsed: 4_000_000n },
        ...Object.fromEntries(MAINNET.map((m) => [m.tx, { block: m.block, gasUsed: m.gasUsed }])),
      },
    });
  });

  test("shows Hash verified and the owner's text on both rows", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/ledger");
    const decisions = page.getByRole("list", { name: "Mainnet decisions" }).getByRole("listitem");
    await expect(decisions).toHaveCount(2);
    // Newest first: the allowed BUY, then the refusal.
    for (const [i, m] of [...MAINNET].reverse().entries()) {
      const row = decisions.nth(i);
      await expect(row.getByRole("link", { name: /Basescan/ })).toHaveAttribute("href", `https://basescan.org/tx/${m.tx}`);
      await expect(row).toContainText(m.allowed ? "Allowed" : "Refused");
      await expect(row.getByText("Hash verified", { exact: true })).toBeVisible();
      await expect(row.locator("blockquote")).toHaveText(OWNER_TEXT);
    }
    await expect(page.getByText("Hash mismatch", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Rationale not exported yet", { exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

// Two visits in one browser: the second marks the Decisions that came after the first, prints each in once and says how
// many, from what this browser alone remembers (lib/chain/since.ts).
test.describe("/ledger since your last look", () => {
  const LOOK_KEY = "maat:ledger:look:v1";
  const FIRST = Date.UTC(2026, 10, 28, 15, 0); // Sat 28 Nov 2026 10:00 ET
  const SECOND = Date.UTC(2026, 10, 30, 14, 45); // Mon 30 Nov 2026 09:45 ET
  const LATER = HEAD + 500n;
  const LATER_TX = `https://basescan.org/tx/${hash32(4)}`;
  let chain: FakeScenario;
  let sent: { url: string; body: string; cookie: string | undefined }[];

  const decisions = (page: Page) => page.getByRole("list", { name: "Mainnet decisions" }).getByRole("listitem");
  const sinceLine = (page: Page) => page.locator("[data-since-line]");
  const prints = (page: Page) => page.evaluate(() => (window as unknown as { prints: string[] }).prints);

  /** Opens /ledger at `at` and waits until the read is complete and remembered. */
  async function visit(page: Page, at: number, rows: number) {
    await page.clock.setFixedTime(at);
    await page.goto("/ledger");
    await expect(decisions(page)).toHaveCount(rows);
    await expect(page.getByText(/Reading the vault's history/)).toHaveCount(0);
    await expect.poll(() => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null")?.at ?? null, LOOK_KEY)).toBe(at);
  }

  /** The chain on a later visit: one more Decision, a refusal 500 blocks above the first visit's head. */
  function later() {
    chain.head = HEAD + 1_000n;
    chain.headTime = T0 + 3 * 86_400 + 1000;
    chain.logs = [...scenario.logs, decisionLog(4, LATER, { token: GOOGLC, reason: "MARKET_CLOSED", amount: 5_000_000n })];
    chain.times = { ...scenario.times, [String(LATER)]: T0 + 3 * 86_400 };
    chain.receipts = { ...scenario.receipts, [hash32(4)]: { block: LATER, gasUsed: 111_116n } };
  }

  async function showDecisions(page: Page, path: string) {
    await page.getByRole("heading", { name: "Decisions and rounds" }).evaluate((el) => el.scrollIntoView({ block: "start", behavior: "instant" }));
    await page.screenshot({ path });
  }

  test.beforeEach(async ({ page }) => {
    chain = { ...scenario };
    sent = [];
    page.on("request", (r) => sent.push({ url: r.url(), body: r.postData() ?? "", cookie: r.headers()["cookie"] }));
    // Every print-in the page plays, by the transaction its row links to.
    await page.addInitScript(() => {
      const w = window as unknown as { prints: string[] };
      w.prints = [];
      document.addEventListener("animationstart", (e) => {
        const row = e.target as HTMLElement;
        if (e.animationName === "print" && row.matches("[data-tape-row]")) w.prints.push(row.querySelector("a[href*='/tx/']")?.getAttribute("href") ?? "");
      });
    });
    await installFakeChain(page, chain);
  });

  for (const [width, height] of [
    [390, 844],
    [1440, 900],
  ] as const) {
    test(`at ${width}px marks what came after the last visit, prints it in once and says how many`, async ({ page }) => {
      const errors = collectErrors(page);
      await page.setViewportSize({ width, height });

      // A first visit has nothing to compare with: no line, no mark, no print.
      await visit(page, FIRST, 3);
      await expect(sinceLine(page)).toHaveText("");
      await expect(page.locator("[data-since-new]")).toHaveCount(0);
      expect(await prints(page)).toEqual([]);

      later();
      await visit(page, SECOND, 4);
      await expect(sinceLine(page)).toHaveText("1 new since your last look · Sat 28 Nov 10:00 ET");
      await expect(sinceLine(page)).toHaveAttribute("aria-live", "polite");
      // Polite text, never an alert (the only alert on the page is Next.js's route announcer, outside main).
      await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
      const fresh = decisions(page).first();
      await expect(fresh.getByRole("link", { name: /Basescan/ })).toHaveAttribute("href", LATER_TX);
      await expect(fresh.locator("[data-since-new]")).toHaveText("New since your last look");
      await expect(page.locator("[data-since-new]")).toHaveCount(1);
      await expect.poll(() => prints(page)).toEqual([LATER_TX]);
      await expect(page.locator("[data-fresh]")).toHaveCount(0);

      // A filter there and back shows the row again, still marked, and never prints it a second time.
      const filters = page.getByRole("group", { name: "Filter mainnet decisions" });
      await filters.getByRole("button", { name: "Allowed", exact: true }).click();
      await expect(decisions(page)).toHaveCount(1);
      await filters.getByRole("button", { name: "All", exact: true }).click();
      await expect(decisions(page)).toHaveCount(4);
      await expect(decisions(page).first().locator("[data-since-new]")).toHaveCount(1);
      expect(await prints(page)).toEqual([LATER_TX]);

      await page.evaluate(() => document.fonts.ready);
      const fit = await measureFit(page);
      expect(fit.overflow).toBeLessThanOrEqual(0);
      expect(fit.clipped).toEqual([]);
      // In the wide layout each row's time stays level with its action line, the mark under it, however tall the row.
      if (width >= 768) {
        const drift = await decisions(page).evaluateAll((rows) =>
          rows.map((r) => {
            const time = r.firstElementChild!.firstElementChild!.getBoundingClientRect().top;
            return Math.abs(time - r.children[1]!.querySelector("p > span")!.getBoundingClientRect().top);
          }),
        );
        expect(Math.max(...drift)).toBeLessThan(8);
      }
      expect(await blockingViolations(page)).toEqual([]);
      await showDecisions(page, `test-results/screens/ledger-since-${width}.png`);

      // A third visit with nothing new says so, with the time of the second.
      await visit(page, SECOND + 3_600_000, 4);
      await expect(sinceLine(page)).toHaveText("Nothing new since your last look · Mon 30 Nov 09:45 ET");
      await expect(page.locator("[data-since-new]")).toHaveCount(0);
      expect(await prints(page)).toEqual([]);

      // Nothing about the look left the browser: no cookie, and no request carried it.
      expect(await page.context().cookies()).toEqual([]);
      expect(sent.filter((r) => r.cookie !== undefined)).toEqual([]);
      expect(
        sent.filter((r) => r.url.includes(LOOK_KEY) || r.body.includes(LOOK_KEY) || r.body.includes(String(FIRST)) || r.body.includes(String(SECOND))),
      ).toEqual([]);
      const own = new URL(page.url()).host;
      expect(sent.map((r) => new URL(r.url).host).filter((h) => h !== own && !RPC_HOSTS.includes(h))).toEqual([]);
      expect(errors).toEqual([]);
    });

    test(`at ${width}px with reduced motion shows the same line and mark, with no print-in`, async ({ page }) => {
      const errors = collectErrors(page);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height });
      await visit(page, FIRST, 3);
      later();
      await visit(page, SECOND, 4);
      await expect(sinceLine(page)).toHaveText("1 new since your last look · Sat 28 Nov 10:00 ET");
      const fresh = decisions(page).first();
      await expect(fresh.locator("[data-since-new]")).toHaveText("New since your last look");
      // The row is at its final frame: no animation runs on it and nothing clips it.
      expect(await fresh.evaluate((el) => [getComputedStyle(el).animationName, getComputedStyle(el).clipPath, el.getAnimations().length])).toEqual([
        "none",
        "none",
        0,
      ]);
      expect(await prints(page)).toEqual([]);
      await showDecisions(page, `test-results/screens/ledger-since-reduced-${width}.png`);
      expect(errors).toEqual([]);
    });
  }

  test("shows the page as before when the browser blocks storage", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() {
          throw new DOMException("The operation is insecure.", "SecurityError");
        },
      });
    });
    await page.goto("/ledger");
    await expect(decisions(page)).toHaveCount(3);
    later();
    await page.goto("/ledger");
    await expect(decisions(page)).toHaveCount(4);
    await expect(page.getByText(/Reading the vault's history/)).toHaveCount(0);
    await expect(sinceLine(page)).toHaveText("");
    await expect(page.locator("[data-since-new]")).toHaveCount(0);
    expect(await prints(page)).toEqual([]);
  });
});
