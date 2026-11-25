import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { getAddress, type Address, type Hash, type Hex } from "viem";
import deployments from "../content/generated/deployments.json" with { type: "json" };
import { VERIFIED_ACCOUNT_SCHEMA } from "../app/(site)/proof/verified";
import { answerBody, newRpcLog, type ProofChain, type ProofRpcLog } from "../test/helpers/fake-proof-chain";
import { RPC_HOSTS } from "./fake-rpc";
import { collectErrors } from "./helpers";

// The committed MaatInbox row, read as lib/chain/inbox.ts inboxDeployment reads it. That module is not loaded here:
// its imports read JSON without an import attribute, which the e2e loader refuses.
const ROW = deployments.find((r) => r.network === "Base mainnet" && r.contract === "MaatInbox" && r.address.trim() !== "");
const RECORDED = ROW ? { inbox: getAddress(ROW.address.trim()), deployTx: ROW.tx.trim() === "" ? null : (ROW.tx.trim() as Hash) } : null;
const DEPLOY = 62_000_000n;
const HEAD = DEPLOY + 120_000n;
const OWNER = getAddress("0x3c3a66f713DAE7e4A03Bbd81dB79FF65F42C1D6a");
const ALICE = getAddress("0x00000000000000000000000000000000000a11ce");
const BOB = getAddress("0x0000000000000000000000000000000000000b0b");
// A test inbox, served to the real build only by the second describe below.
const INBOX = getAddress("0x00000000000000000000000000000000000b0001");
const INBOX_TX: Hash = `0x${"d1".repeat(32)}`;
const UID: Hex = `0x${"a1".repeat(32)}`;
const ZERO32: Hex = `0x${"0".repeat(64)}`;

function chain(inbox: Address, deployTx: Hash | null, briefs: ProofChain["briefs"]): ProofChain {
  return {
    chainId: 8453,
    head: HEAD,
    headTime: 1_795_619_778n,
    inbox,
    deployTx: deployTx ?? INBOX_TX,
    deployBlock: DEPLOY,
    briefs,
    uids: { [ALICE.toLowerCase()]: UID },
    attestations: {
      [UID]: {
        uid: UID,
        schema: VERIFIED_ACCOUNT_SCHEMA,
        time: 1_795_000_000n,
        expirationTime: 0n,
        revocationTime: 0n,
        refUID: ZERO32,
        recipient: ALICE,
        attester: getAddress("0x357458739F90461b99789350868CD7CF330Dd7EE"),
        revocable: true,
        data: `0x${"0".repeat(63)}1`,
      },
    },
  };
}

/** Answers every JSON-RPC request the page sends to the Base RPCs from `c`. */
async function installProofChain(page: Page, c: ProofChain): Promise<ProofRpcLog> {
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

async function serious(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`);
}

const LINES = ["outside-briefs", "outside-wallets", "verified", "team-briefs", "hidden-briefs", "bounty-claimants"];

test.describe("/proof with the committed deployments table", () => {
  test("is a public page with the rule, in the state the table gives it, and no nav link yet", async ({ page }) => {
    const errors = collectErrors(page);
    const seen = await installProofChain(page, chain(RECORDED?.inbox ?? INBOX, RECORDED?.deployTx ?? null, []));
    await page.goto("/proof");

    await expect(page.getByRole("heading", { level: 1, name: "Proof" })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/proof$/);
    await expect(page.getByRole("heading", { name: "The counting rule" })).toBeVisible();
    await expect(page.locator("[data-proof-rule]")).toContainText("No line is ever added to another.");
    await expect(page.locator("[data-proof-rule] table tbody tr")).toHaveCount(8);
    await expect(page.locator('nav a[href="/proof"]')).toHaveCount(0);
    expect((await page.request.get("/sitemap.xml").then((r) => r.text())).includes("/proof</loc>")).toBe(true);

    if (RECORDED === null) {
      await expect(page.locator('[data-proof-state="not-recorded"]')).toContainText("Counting starts when the inbox is recorded.");
      for (const key of LINES.slice(0, 5)) await expect(page.getByTestId(`proof-${key}`)).toHaveText("0");
      await expect(page.locator("[data-proof-row]")).toHaveCount(0);
      expect(seen.methods).not.toContain("eth_getLogs");
    } else {
      await expect(page.locator('[data-proof-state="read"]')).toBeVisible();
      await expect(page.getByTestId("proof-outside-briefs")).toHaveText("0");
    }
    expect(await serious(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test.describe("/proof with a test MaatInbox served in deployments.json", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/data/deployments.json", async (route) => {
      const res = await route.fetch();
      const file = (await res.json()) as { contracts: { contract: string }[] };
      file.contracts = [
        ...file.contracts.filter((r) => r.contract !== "MaatInbox"),
        { network: "Base mainnet", contract: "MaatInbox", address: INBOX, tx: INBOX_TX, date: "2026-11-30" } as never,
      ];
      await route.fulfill({ response: res, json: file });
    });
  });

  test("counts the Brief logs by the rule, with the team apart and the Verified Account column", async ({ page }) => {
    const errors = collectErrors(page);
    const seen = await installProofChain(
      page,
      chain(INBOX, INBOX_TX, [
        { id: 1, from: ALICE, text: "buy more NVDAc", block: DEPLOY + 10n },
        { id: 2, from: OWNER, text: "test", block: DEPLOY + 60_000n },
        { id: 3, from: BOB, text: "sell it all now", block: DEPLOY + 60_001n },
        { id: 4, from: ALICE, text: "<b>unique-brief-text</b>", block: HEAD - 1n },
      ]),
    );
    await page.goto("/proof");

    await expect(page.locator('[data-proof-state="read"]')).toBeVisible({ timeout: 15_000 });
    const expected: Record<string, string> = {
      "outside-briefs": "3",
      "outside-wallets": "2",
      verified: "1",
      "team-briefs": "1",
      "hidden-briefs": "0",
      "bounty-claimants": "0",
    };
    for (const key of LINES) await expect(page.getByTestId(`proof-${key}`)).toHaveText(expected[key]!);
    await expect(page.getByText("Counted to block 62,120,000 of Base mainnet")).toBeVisible();

    const wallets = page.getByRole("table", { name: "Outside wallets" });
    await expect(wallets.locator("tbody tr")).toHaveCount(2);
    await expect(wallets.locator("tbody tr").nth(0).locator("td")).toHaveText([ALICE.toLowerCase(), "2", UID]);
    await expect(wallets.locator("tbody tr").nth(1).locator("td")).toHaveText([BOB.toLowerCase(), "1", "none"]);
    await expect(page.getByRole("table", { name: "Team wallets" }).locator("tbody td").first()).toHaveText(OWNER.toLowerCase());
    // The page shows no brief text, so nothing a sender wrote is ever rendered here.
    await expect(page.getByText("unique-brief-text")).toHaveCount(0);

    expect(seen.calls.map((c) => c.functionName).sort()).toEqual(["getAttestation", "getAttestationUid", "getAttestationUid"]);
    expect(new Set(seen.calls.map((c) => c.block))).toEqual(new Set([`0x${HEAD.toString(16)}`]));
    expect(await serious(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
});
