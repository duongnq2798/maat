import { expect, test, type Page } from "@playwright/test";
import { getAddress, zeroAddress, type Hash } from "viem";
import addresses from "../content/generated/base-addresses.json" with { type: "json" };
import deployments from "../content/generated/deployments.json" with { type: "json" };
import { deploymentConfig } from "../lib/chain/config";
import { parseSnapshot, SNAPSHOT_REORG_WINDOW, SNAPSHOT_URL } from "../lib/chain/snapshot";
import fixture from "../test/fixtures/decisions-snapshot.json" with { type: "json" };
import { FAKE_VAULT, hash32 } from "../test/helpers/fake-ledger";
import { SNAP_BLOCK, SNAP_DEPLOY, SNAP_DEPLOY_TX, SNAP_HEAD, SNAP_OWNER, SNAP_ROWS, snapshotChain } from "../test/helpers/snapshot-chain";
import { installFakeChain, type FakeScenario } from "./fake-rpc";
import { collectErrors } from "./helpers";

// A first read of /ledger that starts from the decisions snapshot (lib/chain/snapshot.ts), against the fake Base RPC of
// e2e/fake-rpc.ts serving the chain of test/helpers/snapshot-chain.ts, whose snapshot is test/fixtures/decisions-snapshot.json.
// The page is served a deployments file that names that chain's vault. The last test reads the real Base mainnet and
// runs only with MAAT_E2E_LIVE=1, so CI never depends on a public RPC.

const USDC = getAddress(addresses.find((a) => a.name === "USDC")!.value);
/** The fixture vault, checksummed: viem refuses the mixed-case FAKE_VAULT literal. */
const VAULT = getAddress(FAKE_VAULT);
const chain = snapshotChain();

const scenario: FakeScenario = {
  head: SNAP_HEAD,
  headTime: chain.times![String(SNAP_HEAD)]!,
  vault: VAULT,
  logs: chain.logs,
  times: chain.times!,
  receipts: {
    [SNAP_DEPLOY_TX.toLowerCase()]: { block: SNAP_DEPLOY, gasUsed: 4_000_000n },
    ...Object.fromEntries(SNAP_ROWS.map((r) => [hash32(r.n), { block: r.block, gasUsed: chain.gas![hash32(r.n)]! }])),
  },
  txs: chain.txs,
  calls: {
    [FAKE_VAULT.toLowerCase()]: {
      TIMELOCK: 86_400n,
      owner: SNAP_OWNER,
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
        creditAdapter: zeroAddress,
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

const decisions = (page: Page) => page.getByRole("list", { name: "Mainnet decisions" }).getByRole("listitem");

/** Serves the fake chain, a deployments file naming its vault, and `snapshot` as the build's snapshot file. */
async function setUp(page: Page, snapshot: string) {
  const logRequests: { from: bigint; to: bigint }[] = [];
  await installFakeChain(page, { ...scenario, onLogs: (r) => logRequests.push(r) });
  await page.route("**/data/deployments.json", (route) =>
    route.fulfill({ json: { network: "Base mainnet", chainId: 8453, vault: VAULT, deployTx: SNAP_DEPLOY_TX, contracts: [] } }),
  );
  await page.route(`**${SNAPSHOT_URL}`, (route) => route.fulfill({ body: snapshot, contentType: "application/json; charset=utf-8" }));
  return logRequests;
}

const lowest = (rs: readonly { from: bigint }[]) => rs.reduce((m, r) => (r.from < m ? r.from : m), SNAP_HEAD);
const highest = (rs: readonly { to: bigint }[]) => rs.reduce((m, r) => (r.to > m ? r.to : m), 0n);

test.describe("/ledger's first read with a decisions snapshot", () => {
  test("takes the old Decisions from the snapshot and asks Base only for the blocks from N minus the window", async ({ page }) => {
    const errors = collectErrors(page);
    const logRequests = await setUp(page, JSON.stringify(fixture));
    await page.goto("/ledger");
    await expect(decisions(page)).toHaveCount(SNAP_ROWS.length);
    await expect(page.getByText(/Reading the vault's history/)).toHaveCount(0);
    await expect(page.getByText(/^Logs up to block/)).toHaveText(
      `Logs up to block ${(SNAP_BLOCK - SNAPSHOT_REORG_WINDOW - 1n).toLocaleString("en-US")} are from the committed snapshot of block ${SNAP_BLOCK.toLocaleString("en-US")}, whose hash Base confirmed.`,
    );
    await expect(page.getByRole("link", { name: "committed snapshot" })).toHaveAttribute("href", SNAPSHOT_URL);
    expect(logRequests.length).toBeGreaterThan(0);
    expect(lowest(logRequests)).toBe(SNAP_BLOCK - SNAPSHOT_REORG_WINDOW);
    expect(highest(logRequests)).toBe(SNAP_HEAD);
    expect(errors).toEqual([]);
  });

  for (const [name, body] of [
    ["a file that is not JSON", "{"],
    ["no snapshot (null)", "null\n"],
    ["a snapshot whose block hash Base does not give", JSON.stringify({ ...fixture, blockHash: hash32(777) as Hash })],
  ] as const) {
    test(`reads every block from the deploy with ${name}`, async ({ page }) => {
      const errors = collectErrors(page);
      const logRequests = await setUp(page, body);
      await page.goto("/ledger");
      await expect(decisions(page)).toHaveCount(SNAP_ROWS.length);
      await expect(page.getByText(/Reading the vault's history/)).toHaveCount(0);
      await expect(page.getByText(/^Logs up to block/)).toHaveCount(0);
      expect(lowest(logRequests)).toBe(SNAP_DEPLOY);
      expect(errors).toEqual([]);
    });
  }
});

test("the build serves the committed snapshot of the recorded vault, or null", async ({ page }) => {
  const res = await page.request.get(SNAPSHOT_URL);
  expect(res.ok()).toBe(true);
  const body: unknown = await res.json();
  const recorded = deploymentConfig(deployments)!;
  expect(body === null || parseSnapshot(body, recorded.vault) !== null).toBe(true);
});

// The plan's target for a first read: /ledger shows every Decision in under 5 s with the snapshot, read from the real
// public RPCs. It measures from the navigation to the moment the Decisions are listed, the scan is done and each
// rationale is checked.
test("a cold /ledger on the public RPCs lists the Decisions in under 5 s with the committed snapshot", async ({ page }) => {
  test.skip(process.env.MAAT_E2E_LIVE !== "1", "reads the real Base mainnet; set MAAT_E2E_LIVE=1 to run it");
  const res = await page.request.get(SNAPSHOT_URL);
  const committed = parseSnapshot(await res.json(), deploymentConfig(deployments)!.vault);
  expect(committed, "the build has no snapshot of the recorded vault").not.toBeNull();
  const froms: bigint[] = [];
  page.on("request", (r) => {
    if (r.method() !== "POST" || !/publicnode|base\.org/.test(new URL(r.url()).host)) return;
    const body = JSON.parse(r.postData() ?? "null") as unknown;
    for (const call of Array.isArray(body) ? body : [body]) {
      const c = call as { method?: string; params?: { fromBlock?: string }[] };
      if (c.method === "eth_getLogs" && c.params?.[0]?.fromBlock) froms.push(BigInt(c.params[0].fromBlock));
    }
  });
  const started = Date.now();
  await page.goto("/ledger");
  await expect(decisions(page).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Reading the vault's history/)).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText("Checking rationale…")).toHaveCount(0, { timeout: 30_000 });
  const ms = Date.now() - started;
  test.info().annotations.push({ type: "cold load", description: `${ms} ms; eth_getLogs from block ${froms.reduce((m, f) => (f < m ? f : m), froms[0] ?? 0n)}` });
  console.log(`cold /ledger load with the snapshot of block ${committed!.block}: ${ms} ms, ${await decisions(page).count()} Decisions`);
  await expect(page.getByText(/^Logs up to block/)).toBeVisible();
  expect(froms.length).toBeGreaterThan(0);
  expect(froms.every((f) => f >= BigInt(committed!.block) - SNAPSHOT_REORG_WINDOW)).toBe(true);
  expect(ms).toBeLessThan(5_000);
});
