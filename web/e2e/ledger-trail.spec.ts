import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { getAddress, keccak256, toBytes, type Address, type Hash, type Hex } from "viem";
import addresses from "../content/generated/base-addresses.json" with { type: "json" };
import deployments from "../content/generated/deployments.json" with { type: "json" };
import { deploymentConfig } from "../lib/chain/config";
import { canon } from "../lib/chain/rationale";
import { decisionLog, hash32 } from "../test/helpers/fake-ledger";
import { erc8021Suffix, executeCalldata, JOURNAL_HASHES, JOURNAL_LINES, SPEC_CODE, txInput, VECTORS } from "../test/helpers/maat-v1";
import { installFakeChain, RPC_HOSTS, type FakeScenario } from "./fake-rpc";
import { collectErrors, measureFit } from "./helpers";

// The agent trail of /ledger on fixture transactions built from the maat:v1 spec's vectors: an owner-sent Decision
// with no blob, an agent Decision carrying V1, and a probe carrying V4. The RPC and the agent-journal branch are mocked.

const USDC = getAddress(addresses.find((a) => a.name === "USDC")!.value);
const RECORDED = deploymentConfig(deployments)!;
const VAULT = RECORDED.vault;
const DEPLOY_TX = RECORDED.deployTx!;
const DEPLOY = 61_698_517n;
const HEAD = DEPLOY + 120_000n;
const T0 = 1_795_707_000; // Thu 26 Nov 2026 15:30 UTC
const OWNER: Address = getAddress("0x00000000000000000000000000000000000000a1");
const AGENT: Address = getAddress("0x00000000000000000000000000000000000000b2");
const OWNER_TEXT = "Owner-sent first decision: BUY 5 USD of NVDAc";
const JOURNAL = "https://raw.githubusercontent.com/duongnq2798/maat/agent-journal/journal/";

const ownerInput = `${executeCalldata({ rationaleHash: keccak256(toBytes(OWNER_TEXT)) })}${erc8021Suffix([SPEC_CODE]).slice(2)}` as Hex;
const DECISIONS = [
  { n: 1, block: DEPLOY + 5n, from: OWNER, input: ownerInput, rationaleHash: keccak256(toBytes(OWNER_TEXT)) },
  { n: 2, block: DEPLOY + 60_000n, from: AGENT, input: txInput(VECTORS.V1.blob), rationaleHash: VECTORS.V1.hash },
  { n: 3, block: HEAD - 10n, from: AGENT, input: txInput(VECTORS.V4.blob), rationaleHash: VECTORS.V4.hash },
] as const;

const scenario: FakeScenario = {
  head: HEAD,
  headTime: T0 + 3 * 86_400,
  vault: VAULT,
  logs: DECISIONS.map((d) => decisionLog(d.n, d.block, { rationaleHash: d.rationaleHash })),
  times: Object.fromEntries(DECISIONS.map((d, i) => [String(d.block), T0 + i * 86_400])),
  receipts: {
    [DEPLOY_TX.toLowerCase()]: { block: DEPLOY, gasUsed: 4_000_000n },
    ...Object.fromEntries(DECISIONS.map((d) => [hash32(d.n), { block: d.block, gasUsed: 120_000n }])),
  },
  txs: Object.fromEntries(DECISIONS.map((d) => [hash32(d.n), { from: d.from, to: VAULT, input: d.input }])),
  calls: {
    [VAULT.toLowerCase()]: {
      TIMELOCK: 86_400n,
      owner: OWNER,
      executor: AGENT,
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

/** A published `sent` row for Decision 2 carrying V1, chained after the spec's two journal lines (spec §3.1). */
function sentLine(): string {
  const fields = {
    kind: "sent",
    ts: "2026-11-27T15:30:05.000Z",
    runId: "1795539542000-a1b2c3d4",
    commit: "0123456789abcdef0123456789abcdef01234567",
    index: 0,
    action: "BUY",
    symbol: "NVDAc",
    amountUsd6: "5000000",
    rationaleHash: VECTORS.V1.hash,
    blob: VECTORS.V1.blob,
    preview: "OK",
    gate: "live: execute",
    txHash: hash32(2),
    gas: "300000",
    prev: JOURNAL_HASHES[1]!,
  };
  return canon({ ...fields, hash: keccak256(toBytes(canon(fields))) as Hash });
}

/** index.json is for discovery only (spec §3.4), so the fake one gives a wrong head and row count the page must ignore. */
const WRONG_HEAD = `0x${"0".repeat(64)}`;

/** Serves the agent-journal branch from `files` (day file → text), or answers 404 for everything when it is null. */
async function serveJournal(page: Page, files: Record<string, string> | null) {
  await page.route(`${JOURNAL}**`, (route) => {
    const name = route.request().url().slice(JOURNAL.length);
    const cors = { "access-control-allow-origin": "*" };
    if (files === null || !(name === "index.json" || name in files)) return route.fulfill({ status: 404, headers: cors, body: "404: Not Found" });
    if (name === "index.json") return route.fulfill({ status: 200, headers: cors, body: canon({ days: Object.keys(files), head: WRONG_HEAD, rows: 0, v: 1 }) });
    return route.fulfill({ status: 200, headers: cors, body: files[name]! });
  });
}

async function routeRationales(page: Page) {
  await page.route("**/data/rationales.json", (route) =>
    route.fulfill({ json: [{ intentId: hash32(1001), rationaleHash: keccak256(toBytes(OWNER_TEXT)), text: OWNER_TEXT, txHash: hash32(1), ts: "2026-11-26T15:30:00Z" }] }),
  );
}

const rows = (page: Page) => page.getByRole("list", { name: "Mainnet decisions" }).getByRole("listitem");
/** Decisions are listed newest first: Decision n is row 3 - n. */
const row = (page: Page, n: number) => rows(page).nth(DECISIONS.length - n);

test.describe("/ledger agent trail with a published journal", () => {
  test.beforeEach(async ({ page }) => {
    await routeRationales(page);
    await serveJournal(page, { "2026-11-24.jsonl": [...JOURNAL_LINES, sentLine()].map((l) => `${l}\n`).join("") });
    await installFakeChain(page, scenario);
  });

  test("labels each sender, decodes each blob with a tick and checks the Builder Code", async ({ page }) => {
    const errors = collectErrors(page);
    const hosts = new Set<string>();
    page.on("request", (r) => {
      const host = new URL(r.url()).host;
      if (host !== "localhost:4173") hosts.add(host);
    });
    await page.goto("/ledger");
    await expect(rows(page)).toHaveCount(3);

    const owner = row(page, 1);
    await expect(owner.getByText("owner, by hand", { exact: true })).toBeVisible();
    await expect(owner.getByText("no blob", { exact: true })).toBeVisible();
    await expect(owner.getByText("Hash verified", { exact: true })).toBeVisible();
    await expect(owner.locator("blockquote")).toHaveText(OWNER_TEXT);
    await expect(owner).toContainText(`Builder Code ${SPEC_CODE}: the vault's first Decision`);

    const agent = row(page, 2);
    await expect(agent.getByText("agent", { exact: true })).toBeVisible();
    await expect(agent.getByText("maat:v1 blob", { exact: true })).toBeVisible();
    await expect(agent.getByText("Hash verified", { exact: true })).toBeVisible();
    await expect(agent.locator("blockquote")).toHaveText("Fixture rationale: NVDAc is under its target weight and the feed is fresh, so buy 5 USD.");
    await expect(agent).toContainText("claude-sonnet-5-5");
    await expect(agent).toContainText("round 36893488147419105055");
    await expect(agent).toContainText("premium +19 bps");
    await expect(agent.getByRole("link", { name: "Agent commit 0123456 on GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/duongnq2798/maat/commit/0123456789abcdef0123456789abcdef01234567",
    );
    await expect(agent).toContainText("found in the published journal");
    await expect(agent).toContainText(`✓ Builder Code ${SPEC_CODE}, the code on the vault's first Decision`);

    const probe = row(page, 3);
    await expect(probe.getByText("probe", { exact: true })).toBeVisible();
    await expect(probe.locator("blockquote")).toHaveText("PROBE v1, not a Claude proposal. Expected OK before the 13:00 ET early close.");
    await expect(probe).toContainText("not in the published journal yet");

    expect([...hosts].every((h) => RPC_HOSTS.includes(h) || h === "raw.githubusercontent.com")).toBe(true);
    expect(errors).toEqual([]);
  });

  test("verifies the journal's hash chain in the browser on the Rounds tab", async ({ page }) => {
    await page.goto("/ledger");
    await expect(rows(page)).toHaveCount(3);
    await page.getByRole("tab", { name: "Rounds" }).click();
    // The head the page reports is the hash of the last line, recomputed in the browser, not the one index.json gives.
    const head = (JSON.parse(sentLine()) as { hash: string }).hash;
    await expect(page.getByText(/Chain verified in your browser: 3 rows in 1 day file/)).toContainText(head);
    const journalRows = page.getByRole("list", { name: "Journal rows, newest first" }).getByRole("listitem");
    await expect(journalRows).toHaveCount(3);
    await expect(journalRows.first()).toContainText("sent BUY NVDAc $5.00");
    await expect(page.getByRole("list", { name: "Mainnet decisions" })).toBeHidden();
  });

  for (const width of [360, 1440] as const) {
    test(`fits ${width}px with blobs, and on the Rounds tab`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/ledger");
      await expect(rows(page)).toHaveCount(3);
      await expect(row(page, 2)).toContainText("found in the published journal");
      await page.evaluate(() => document.fonts.ready);
      let fit = await measureFit(page);
      expect(fit.overflow).toBeLessThanOrEqual(0);
      expect(fit.clipped).toEqual([]);
      await page.screenshot({ path: `test-results/screens/ledger-trail-${width}.png`, fullPage: true });
      await page.getByRole("tab", { name: "Rounds" }).click();
      await expect(page.getByRole("list", { name: "Journal rows, newest first" })).toBeVisible();
      fit = await measureFit(page);
      expect(fit.overflow).toBeLessThanOrEqual(0);
      expect(fit.clipped).toEqual([]);
    });
  }

  test("has no serious or critical axe violations, on either tab", async ({ page }) => {
    await page.goto("/ledger");
    await expect(row(page, 2)).toContainText("found in the published journal");
    const blocking = async () =>
      (await new AxeBuilder({ page }).analyze()).violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`);
    expect(await blocking()).toEqual([]);
    await page.getByRole("tab", { name: "Rounds" }).click();
    await expect(page.getByText(/Chain verified in your browser/)).toBeVisible();
    expect(await blocking()).toEqual([]);
  });
});

test.describe("/ledger agent trail before the journal branch exists", () => {
  test.beforeEach(async ({ page }) => {
    await routeRationales(page);
    await serveJournal(page, null);
    await installFakeChain(page, scenario);
  });

  test("says plainly on the Rounds tab that the agent-journal branch does not exist yet", async ({ page }) => {
    await page.goto("/ledger");
    await expect(rows(page)).toHaveCount(3);
    await expect(row(page, 2)).toContainText("no journal published yet");
    await page.getByRole("tab", { name: "Rounds" }).click();
    await expect(page.getByText("No journal has been published yet.")).toBeVisible();
    await expect(page.getByText(/The agent-journal branch does not exist yet, or holds no journal\/index.json: GitHub answered 404/)).toBeVisible();
    // The ticks do not depend on the journal: they come from the transactions.
    await page.getByRole("tab", { name: "Decisions" }).click();
    await expect(row(page, 2).getByText("Hash verified", { exact: true })).toBeVisible();
  });
});

test.describe("/ledger Verify it by hand", () => {
  test("shows the five read-only cast commands against the recorded vault", async ({ page }) => {
    await page.route((url) => RPC_HOSTS.includes(url.host), (route) => route.abort());
    await page.goto("/ledger");
    const panel = page.getByRole("region", { name: "Verify it by hand" });
    await expect(panel.getByRole("list", { name: "Five read-only commands" }).getByRole("listitem")).toHaveCount(5);
    await expect(panel.getByRole("region", { name: "Set the RPC and the addresses" })).toContainText(`export VAULT=${VAULT}`);
    await expect(panel.getByRole("region", { name: "Command 1", exact: true })).toContainText(`cast receipt ${DEPLOY_TX} contractAddress`);
    await expect(panel.getByRole("region", { name: "Output of command 5" })).toHaveText("0x0baa4c52…57f6");
  });
});
