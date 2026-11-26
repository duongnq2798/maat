import { expect, test, type Page } from "@playwright/test";
import { getAddress, keccak256, toBytes, type Address, type Hash, type Hex } from "viem";
import deployments from "../content/generated/deployments.json" with { type: "json" };
import { PROOF_SENDS } from "../content/proof-sends";
import { REASONS } from "../content/reasons";
import { canon, GENESIS } from "../lib/chain/rationale";
import { answerBody, decisionLog, newRpcLog, plainSends, type FakeBrief, type ProofChain } from "../test/helpers/fake-proof-chain";
import { AGENT_TEST_CODE, txInput, VECTORS } from "../test/helpers/maat-v1";
import { RPC_HOSTS } from "./fake-rpc";
import { collectErrors, measureFit } from "./helpers";

// /ask's feed as weighings (culture plan, Move 1), on the real build: each brief, what Maat's agent replied from its
// published journal, whether Claude was persuaded, and the vault's verdict from the brief-keyed Decision logs; and the
// counters, outside and team apart, with 0 shown as 0. The chain is test/helpers/fake-proof-chain.ts, the one /proof's
// e2e reads, so the team set /ask marks is /proof's own trace of it. The inbox and the switch are served only here.

const VAULT = getAddress(deployments.find((r) => r.network === "Base mainnet" && r.contract === "MandateVault")!.address);
const DEPLOY = 62_000_000n;
const HEAD = DEPLOY + 120_000n;
const OWNER = getAddress("0x3c3a66f713DAE7e4A03Bbd81dB79FF65F42C1D6a");
const EXECUTOR = getAddress("0x9bC6E49d42e0659f3ef667B09B67506B348e115A");
const ALICE = getAddress("0x00000000000000000000000000000000000a11ce");
const BOB = getAddress("0x0000000000000000000000000000000000000b0b");
const INBOX = getAddress("0x00000000000000000000000000000000000b0001");
const INBOX_TX: Hash = `0x${"d1".repeat(32)}`;
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const MARKET_CLOSED = REASONS.indexOf("MARKET_CLOSED") + 1;

const briefTx = (id: number): Hash => `0x${(9000 + id).toString(16).padStart(64, "0")}`;
const decisionTx = (n: number): Hash => `0x${n.toString(16).repeat(64).slice(0, 64)}`;

// #1 Alice: persuaded, then refused. #2 Bob: replied, not persuaded, not weighed. #3 the owner (team): persuaded, then
// allowed. #4 Alice: no reply and no verdict yet.
const BRIEFS: FakeBrief[] = [
  { id: 1, from: ALICE, text: "Buy 40 USD of NVDAc now.", block: DEPLOY + 10n, txHash: briefTx(1) },
  { id: 2, from: BOB, text: "Hold more cash.", block: DEPLOY + 20n, txHash: briefTx(2) },
  { id: 3, from: OWNER, text: "test from the team", block: DEPLOY + 30n, txHash: briefTx(3) },
  { id: 4, from: ALICE, text: "Sell everything on Saturday.", block: DEPLOY + 40n, txHash: briefTx(4) },
];
const REPLIES: Record<number, { reply: string; adopted: boolean }> = {
  1: { reply: "Adopted: a 40 USD NVDAc buy fits the policy.", adopted: true },
  2: { reply: "Not adopted: the cash target already holds.", adopted: false },
  3: { reply: "Adopted: a 5 USD buy.", adopted: true },
};

/** A maat:v1 blob (the spec's V5 vector) that adopts the briefs `q`. */
const blob = (q: number[]) => VECTORS.V5.blob.replace('"q":[7]', `"q":[${q.join(",")}]`);

/**
 * The chain: the committed team lists as their own record, then the agent executor's two brief-driven Decisions, each
 * carrying its blob and the test Builder Code: one refused (MARKET_CLOSED) citing #1, one allowed citing #3.
 */
function chain(): ProofChain {
  const decision = (n: number, nonce: number, block: bigint, q: number[], reason: number) => ({
    hash: decisionTx(n),
    from: EXECUTOR,
    nonce,
    to: VAULT,
    block,
    logs: [decisionLog(VAULT, n, undefined, { allowed: reason === 0, reason, rationaleHash: keccak256(toBytes(blob(q))) })],
    input: txInput(blob(q), { code: AGENT_TEST_CODE }),
  });
  return {
    vault: { address: VAULT, owner: OWNER, executor: EXECUTOR, payees: [OWNER] },
    txs: [...plainSends(PROOF_SENDS, DEPLOY), decision(0xe1, 0, DEPLOY + 15n, [1], MARKET_CLOSED), decision(0xe2, 1, DEPLOY + 35n, [3], 0)],
    chainId: 8453,
    head: HEAD,
    headTime: 1_795_619_778n,
    inbox: INBOX,
    deployTx: INBOX_TX,
    deployBlock: DEPLOY,
    briefs: BRIEFS,
    uids: {},
    attestations: {},
  };
}

async function installChain(page: Page, c: ProofChain) {
  const seen = newRpcLog();
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
  await page.route(
    (url) => RPC_HOSTS.includes(url.host),
    async (route) => {
      const req = route.request();
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      const out = answerBody(c, seen, JSON.parse(req.postData() ?? "null"));
      await route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(out) });
    },
  );
  return seen;
}

const JOURNAL = "https://raw.githubusercontent.com/duongnq2798/maat/agent-journal/journal/";

/** A published journal with a brief row for #1, #2 and #3, chained from GENESIS as the agent writes it. */
async function serveJournal(page: Page) {
  let prev: Hash = GENESIS;
  const lines: string[] = [];
  for (const b of BRIEFS.filter((x) => REPLIES[x.id])) {
    const { reply, adopted } = REPLIES[b.id]!;
    const row = {
      ts: "2026-11-30T03:00:00.000Z",
      kind: "brief",
      runId: "run-1",
      commit: COMMIT,
      briefId: b.id,
      from: b.from,
      txHash: b.txHash,
      logIndex: 0,
      block: b.block.toString(),
      outcome: "replied",
      reply,
      adopted,
      prev,
    };
    const hash = keccak256(toBytes(canon(row)));
    lines.push(canon({ ...row, hash }));
    prev = hash;
  }
  const files: Record<string, string> = {
    "index.json": canon({ days: ["2026-11-30"], head: prev, rows: lines.length, v: 1 }),
    "2026-11-30.jsonl": `${lines.join("\n")}\n`,
  };
  await page.route(`${JOURNAL}**`, (route) => {
    const name = route.request().url().slice(JOURNAL.length);
    const cors = { "access-control-allow-origin": "*" };
    return name in files ? route.fulfill({ status: 200, headers: cors, body: files[name]! }) : route.fulfill({ status: 404, headers: cors, body: "404: Not Found" });
  });
}

/** The test inbox in /data/deployments.json, and the owner's switch on in /data/ask.json. */
async function serveInbox(page: Page) {
  await page.route("**/data/deployments.json", async (route) => {
    const res = await route.fetch();
    const file = (await res.json()) as { contracts: { contract: string }[] };
    file.contracts = [
      ...file.contracts.filter((r) => r.contract !== "MaatInbox"),
      { network: "Base mainnet", contract: "MaatInbox", address: INBOX, tx: INBOX_TX, date: "2026-11-30" } as never,
    ];
    await route.fulfill({ response: res, json: file });
  });
  await page.route("**/data/ask.json", async (route) => route.fulfill({ response: await route.fetch(), json: { open: true } }));
}

/** Width and height from a PNG's IHDR chunk. */
const pngSize = (b: Buffer) => ({ png: b.subarray(1, 4).toString("latin1"), width: b.readUInt32BE(16), height: b.readUInt32BE(20) });

test.describe("/ask's feed as weighings, with a test MaatInbox, a published journal and brief-driven Decisions", () => {
  test.beforeEach(async ({ page }) => {
    await serveInbox(page);
    await serveJournal(page);
  });

  for (const width of [1440, 390]) {
    test(`shows each brief as brief, reply, persuaded, verdict, and counts with 0 as 0, at ${width} px`, async ({ page }) => {
      const errors = collectErrors(page);
      await page.setViewportSize({ width, height: 900 });
      await installChain(page, chain());
      await page.goto("/ask");

      const feed = page.getByRole("list", { name: "Briefs" });
      await expect(feed.locator("[data-brief-id]")).toHaveCount(4, { timeout: 15_000 });
      await expect(feed.locator('[data-verdict="refused"]')).toHaveCount(1, { timeout: 15_000 });
      // Newest first.
      expect(await feed.locator("[data-brief-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-brief-id")))).toEqual(["4", "3", "2", "1"]);

      // The weighing order, slot by slot.
      const first = feed.locator('[data-brief-id="1"]');
      await expect(first.locator("[data-weighing]")).toHaveCount(5);
      expect(await first.locator("[data-weighing]").evaluateAll((els) => els.map((e) => e.getAttribute("data-weighing")))).toEqual([
        "head",
        "brief",
        "reply",
        "persuaded",
        "verdict",
      ]);
      await expect(first.locator('[data-weighing="head"]')).toHaveText("#1 · 0x0000…11cE");
      await expect(first.locator('[data-weighing="brief"]')).toHaveText("Buy 40 USD of NVDAc now.");
      await expect(first.locator('[data-weighing="reply"]')).toHaveText(
        `Maat's agent replied: ${REPLIES[1]!.reply}journal 2026-11-30.jsonl line 1 · agent commit 0123456`,
      );
      await expect(first.locator('[data-weighing="persuaded"]')).toHaveText("Claude persuaded: yes, adopted into an intent");
      await expect(first.locator('[data-weighing="verdict"]')).toHaveText(
        `Vault's verdict: Refused · Market closed (MARKET_CLOSED) · Decision ${decisionTx(0xe1).slice(0, 6)}…${decisionTx(0xe1).slice(-4)} · block 62,000,015`,
      );
      await expect(first.locator('[data-weighing="verdict"]')).toHaveAttribute("data-verdict", "refused");

      const second = feed.locator('[data-brief-id="2"]');
      await expect(second.locator('[data-weighing="persuaded"]')).toHaveText("Claude persuaded: no");
      await expect(second.locator('[data-weighing="verdict"]')).toHaveText("Vault's verdict: not weighed yet");

      const team = feed.locator('[data-brief-id="3"]');
      await expect(team.locator('[data-weighing="head"]')).toHaveText("#3 · 0x3c3a…1D6a · team");
      await expect(team.locator("[data-team]")).toHaveText("team");
      await expect(team.locator('[data-weighing="verdict"]')).toHaveAttribute("data-verdict", "allowed");
      await expect(team.locator('[data-weighing="verdict"]')).toContainText("Allowed · All checks passed (OK)");
      await expect(feed.locator("[data-team]")).toHaveCount(1);

      const last = feed.locator('[data-brief-id="4"]');
      await expect(last.locator('[data-weighing="reply"]')).toHaveText("Maat's agent: no reply yet.");
      await expect(last.locator('[data-weighing="persuaded"]')).toHaveText("Claude persuaded: not known yet");
      await expect(last.locator('[data-weighing="verdict"]')).toHaveText("Vault's verdict: not weighed yet");
      await expect(feed.locator("a, img")).toHaveCount(0);
      await expect(page.getByText(/Maat replied/)).toHaveCount(0);

      // Outside: #1, #2 and #4 from two wallets; #1 persuaded; none allowed; #1 refused. Team: #3, persuaded, allowed.
      const expected: Record<string, string> = {
        "count-briefs": "3",
        "count-wallets": "2",
        "count-persuaded": "1",
        "count-allowed": "0",
        "count-refused": "1",
        "count-team-briefs": "1",
        "count-team-wallets": "1",
        "count-team-persuaded": "1",
        "count-team-allowed": "1",
        "count-team-refused": "0",
      };
      for (const [id, value] of Object.entries(expected)) await expect(page.getByTestId(id)).toHaveText(value);
      await expect(page.getByText("4 briefs from 3 wallets read from the inbox's logs, team included.")).toBeVisible();

      expect((await measureFit(page)).overflow).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `test-results/screens/ask-weighing-${width}.png`, fullPage: true });
      expect(errors).toEqual([]);
    });
  }

  test("names its own link preview, a 1200x630 PNG drawn at build time, and leaves the landing's image as it is", async ({ page }) => {
    await page.goto("/ask");
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/og\/ask\.png$/);
    await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute("content", /\/og\/ask\.png$/);
    await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute("content", "1200");
    await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute("content", "630");
    const card = await page.request.get("/og/ask.png");
    expect(card.status()).toBe(200);
    expect(card.headers()["content-type"]).toBe("image/png");
    expect(pngSize(await card.body())).toEqual({ png: "PNG", width: 1200, height: 630 });

    await page.goto("/");
    await expect(page.locator('meta[property="og:image"]')).not.toHaveAttribute("content", /\/og\/ask\.png$/);
  });
});
