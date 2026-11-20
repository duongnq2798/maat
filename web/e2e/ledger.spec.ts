import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { getAddress, keccak256, toBytes } from "viem";
import addresses from "../content/generated/base-addresses.json" with { type: "json" };
import { SCAN_FLOOR_BLOCK } from "../lib/chain/config";
import { decisionLog, hash32 } from "../test/helpers/fake-ledger";
import { installFakeChain, RPC_HOSTS, type FakeScenario } from "./fake-rpc";
import { collectErrors, measureFit } from "./helpers";

const addr = (name: string) => getAddress(addresses.find((a) => a.name === name)!.value);
const USDC = addr("USDC");
const NVDAC = addr("NVDAC");
const GOOGLC = addr("GOOGLC");
const NVDA_FEED = addr("NVDA_FEED");
const GOOGL_FEED = addr("GOOGL_FEED");
const VAULT = getAddress("0x00000000000000000000000000000000000aa001");
const CREDIT = getAddress("0x0000000000000000000000000000000000000c03");

const DEPLOY = SCAN_FLOOR_BLOCK + 10_000n;
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
    [hash32(42)]: { block: DEPLOY, gasUsed: 4_000_000n },
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

test.describe("/ledger before the mainnet deploy", () => {
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
      expect([...hosts]).toEqual([]);
      expect(errors).toEqual([]);
    });
  }

  test("has no serious or critical axe violations", async ({ page }) => {
    await page.goto("/ledger", { waitUntil: "networkidle" });
    expect(await blockingViolations(page)).toEqual([]);
  });
});

test.describe("/ledger reading a fake Base mainnet", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/data/deployments.json", (route) =>
      route.fulfill({ json: { network: "Base mainnet", chainId: 8453, vault: VAULT, deployTx: hash32(42), contracts: [] } }),
    );
    await page.route("**/data/rationales.json", (route) =>
      route.fulfill({
        json: [
          { intentId: hash32(1001), rationaleHash: keccak256(toBytes(VERIFIED)), text: VERIFIED, txHash: hash32(1), ts: "2026-11-26T15:30:00Z" },
          { intentId: hash32(1002), rationaleHash: hash32(5002), text: "This text was edited after the fact.", txHash: hash32(2), ts: "2026-11-27T15:30:00Z" },
        ],
      }),
    );
    await installFakeChain(page, scenario);
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
