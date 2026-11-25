import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  getAddress,
  keccak256,
  parseAbi,
  parseUnits,
  toBytes,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import addresses from "../content/generated/base-addresses.json" with { type: "json" };
import deployments from "../content/generated/deployments.json" with { type: "json" };
import { ASK_OPEN } from "../content/ask-open";
import { REASONS } from "../content/reasons";
import type { CachedLog } from "../lib/chain/cache";
import { deploymentConfig } from "../lib/chain/config";
import { decisionLog, hash32 } from "../test/helpers/fake-ledger";
import { AGENT_TEST_CODE, AGENT_TEST_SUFFIX, erc8021Suffix, executeCalldata } from "../test/helpers/maat-v1";
import { installAskChain, type AskChain } from "./fake-ask-rpc";
import { collectErrors } from "./helpers";

const addr = (name: string) => getAddress(addresses.find((a) => a.name === name)!.value);
const GOOGLC = addr("GOOGLC");

// The build serves the committed deployments table at /data/deployments.json, so /ask previews against the real vault.
// The fake chain answers for that address and for its deploy tx, mined in block 61,698,517 on Base.
const RECORDED = deploymentConfig(deployments)!;
const VAULT = RECORDED.vault;
const DEPLOY = 61_698_517n;
const HEAD = DEPLOY + 120_000n;
const OWNER = getAddress("0x00000000000000000000000000000000000000a1");
const SENDER = getAddress("0x00000000000000000000000000000000000a11ce");
// A test inbox, served to the real build only by the second describe below; deployments/README.md records none.
const INBOX = getAddress("0x00000000000000000000000000000000000b0001");
const INBOX_TX = hash32(4242);
const SENT: Hash = `0x${"5e".repeat(32)}`;
const NOTICE =
  "Nobody trades through Maat; the vault trades only its own funds. Tokenized stocks are only available in eligible jurisdictions outside of the U.S.";
const MARKET_CLOSED = REASONS.indexOf("MARKET_CLOSED") + 1;

// MaatInbox as contracts/src/MaatInbox.sol declares it, written out here so the spec checks the page's encoding
// instead of reusing it (test/ask-inbox.test.ts ties lib/chain/inbox.ts to the same source).
const inboxAbi = parseAbi(["function brief(string text) returns (uint256 id)", "event Brief(uint256 indexed id, address indexed from, string text)"]);
/** The input a brief transaction carries: brief(text) calldata, then the ERC-8021 suffix. */
const briefInput = (text: string, suffix: Hex) => `${encodeFunctionData({ abi: inboxAbi, functionName: "brief", args: [text] })}${suffix.slice(2)}`;

const RLO = String.fromCodePoint(0x202e);
const FFFD = String.fromCodePoint(0xfffd);
const HOSTILE = `<img src=x onerror="window.__pwned=1"> [click](https://evil.example) ${RLO}gnp.exe`;
/** What the feed shows: the same text, with the right-to-left override replaced by U+FFFD. */
const HOSTILE_SHOWN = `<img src=x onerror="window.__pwned=1"> [click](https://evil.example) ${FFFD}gnp.exe`;

/** A Brief log of the inbox, encoded with its ABI. */
function briefLog(id: number, from: Address, text: string, block: bigint): CachedLog {
  const topics = encodeEventTopics({ abi: inboxAbi, eventName: "Brief", args: { id: BigInt(id), from } }) as Hex[];
  return { blockNumber: block.toString(), logIndex: 0, transactionHash: hash32(9000 + id), topics, data: encodeAbiParameters([{ type: "string" }], [text]) };
}

function chain(withInbox: boolean): AskChain {
  // The vault's first Decision, sent by its owner with the test Builder Code at the end of its calldata.
  const ownerInput = `${executeCalldata({ rationaleHash: keccak256(toBytes("first")) })}${erc8021Suffix([AGENT_TEST_CODE]).slice(2)}` as Hex;
  const inboxLogs = [briefLog(1, SENDER, HOSTILE, HEAD - 1500n)];
  const c: AskChain = {
    head: HEAD,
    vault: VAULT,
    owner: OWNER,
    vaultLogs: [decisionLog(1, DEPLOY + 5n)],
    receipts: {
      [RECORDED.deployTx!.toLowerCase()]: { block: DEPLOY },
      [hash32(1)]: { block: DEPLOY + 5n, to: VAULT },
      ...(withInbox ? { [INBOX_TX]: { block: HEAD - 2000n } } : {}),
    },
    txs: { [hash32(1)]: { from: OWNER, to: VAULT, input: ownerInput } },
    preview: MARKET_CLOSED,
    decimals: { [GOOGLC.toLowerCase()]: 18 },
  };
  if (!withInbox) return c;
  return {
    ...c,
    inbox: INBOX,
    inboxLogs,
    // The page waits for the receipt of the brief it sent; once Base "has" it, the brief is in the inbox's logs.
    onReceipt: (hash) => {
      if (hash !== SENT || c.receipts[SENT]) return;
      c.receipts[SENT] = { block: HEAD - 5n, to: INBOX };
      inboxLogs.push(briefLog(2, SENDER, "sell it all", HEAD - 5n));
    },
  };
}

/** An EIP-6963 wallet on Base that records every request on window.__walletRequests and answers a send with `sent`. */
async function installWallet(page: Page) {
  await page.addInitScript(
    ({ sender, sent }) => {
      const requests: { method: string; params?: unknown }[] = [];
      (window as unknown as { __walletRequests: typeof requests }).__walletRequests = requests;
      const provider = {
        request: async ({ method, params }: { method: string; params?: unknown }) => {
          requests.push({ method, params });
          if (method === "eth_requestAccounts" || method === "eth_accounts") return [sender];
          if (method === "eth_chainId") return "0x2105";
          if (method === "eth_sendTransaction") return sent;
          throw Object.assign(new Error(`${method} is not supported`), { code: 4200 });
        },
      };
      const info = { uuid: "e2e-fake-wallet", name: "Fake Wallet", icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E", rdns: "test.fake.wallet" };
      const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    },
    { sender: SENDER, sent: SENT },
  );
}

async function serious(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`);
}

test.describe("/ask with the committed deployments table, which records no MaatInbox", () => {
  test("says the inbox is not open, offers no send, and asks the real vault for free", async ({ page }) => {
    const errors = collectErrors(page);
    await installWallet(page);
    const seen = await installAskChain(page, chain(false));
    await page.goto("/ask");

    await expect(page.getByRole("heading", { level: 1, name: "Brief the agent" })).toBeVisible();
    await expect(page.getByRole("note")).toHaveText(NOTICE);
    await expect(page.locator('[data-ask-state="not-open"]')).toContainText("The inbox is not open yet.");
    await expect(page.getByRole("button", { name: /^Send with/ })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Briefs" })).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    expect(await (await page.request.get("/data/ask.json")).json()).toEqual({ open: ASK_OPEN });

    const form = page.getByRole("form", { name: "Ask the real vault" });
    await form.getByLabel("Action").selectOption("SELL");
    await form.getByLabel("Token").selectOption(GOOGLC);
    await form.getByLabel(/^Amount/).fill("2.5");
    await form.getByRole("button", { name: "Ask the vault" }).click();
    await expect(form.locator('[data-preview-reason="MARKET_CLOSED"]')).toBeVisible();
    await expect(form.getByRole("status")).toContainText("the vault would refuse it");
    expect(seen.previews).toEqual([{ action: 1, token: GOOGLC, amount: parseUnits("2.5", 18) }]);
    expect(seen.methods).not.toContain("eth_sendTransaction");

    expect(await serious(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
});

/** Serves the test inbox in /data/deployments.json, and the owner's switch in /data/ask.json as `open`. */
async function serveInbox(page: Page, open: boolean) {
  await page.route("**/data/deployments.json", async (route) => {
    const res = await route.fetch();
    const file = (await res.json()) as { contracts: unknown[] };
    file.contracts.push({ network: "Base mainnet", contract: "MaatInbox", address: INBOX, tx: INBOX_TX, date: "2026-11-25" });
    await route.fulfill({ response: res, json: file });
  });
  await page.route("**/data/ask.json", async (route) => route.fulfill({ response: await route.fetch(), json: { open } }));
}

test.describe("/ask with a test MaatInbox served in deployments.json and the switch off", () => {
  test("still says the inbox is not open and offers no send", async ({ page }) => {
    await installWallet(page);
    const seen = await installAskChain(page, chain(true));
    await serveInbox(page, false);
    await page.goto("/ask");
    await expect(page.locator('[data-ask-state="not-open"]')).toContainText("MaatInbox is recorded in deployments/README.md, but this page does not send briefs yet.");
    await expect(page.getByRole("button", { name: /^Send with/ })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Briefs" })).toHaveCount(0);
    expect(seen.logRequests.filter((r) => r.address.toLowerCase() === INBOX.toLowerCase())).toEqual([]);
  });
});

test.describe("/ask with a test MaatInbox served in deployments.json and the switch on in ask.json", () => {
  test.beforeEach(async ({ page }) => {
    await serveInbox(page, true);
  });

  test("shows a fixture brief as plain text, then sends a brief whose request ends with the Builder Code suffix", async ({ page }) => {
    const errors = collectErrors(page);
    await installWallet(page);
    const seen = await installAskChain(page, chain(true));
    await page.goto("/ask");

    await expect(page.locator(`[data-builder-code="${AGENT_TEST_CODE}"]`)).toBeVisible();
    await expect(page.locator('[data-ask-state="not-open"]')).toHaveCount(0);

    const feed = page.getByRole("list", { name: "Briefs" });
    const first = feed.locator('[data-brief-id="1"]');
    await expect(first.locator("[data-brief-text]")).toHaveText(HOSTILE_SHOWN);
    await expect(first).toContainText("0x0000");
    await expect(feed.locator("a, img")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    await expect(page.getByTestId("count-briefs")).toHaveText("1");
    await expect(page.getByTestId("count-wallets")).toHaveText("1");
    for (const id of ["count-persuaded", "count-allowed", "count-refused"]) await expect(page.getByTestId(id)).toHaveText("not available yet");

    const send = page.getByRole("button", { name: "Send with Fake Wallet" });
    await expect(send).toBeDisabled();
    await page.getByLabel("Your brief").fill("sell it all");
    await expect(page.getByText("11 / 280 bytes")).toBeVisible();
    await send.click();

    await expect(page.getByText(/^Included in block/)).toBeVisible({ timeout: 15_000 });
    const requests = await page.evaluate(() => (window as unknown as { __walletRequests: { method: string; params?: unknown }[] }).__walletRequests);
    const sends = requests.filter((r) => r.method === "eth_sendTransaction");
    expect(sends).toHaveLength(1);
    const tx = (sends[0]!.params as [{ data: Hex; to: Address; from: Address }])[0];
    expect(tx.data).toBe(briefInput("sell it all", AGENT_TEST_SUFFIX));
    expect(tx.data.endsWith(AGENT_TEST_SUFFIX.slice(2))).toBe(true);
    expect(tx.to.toLowerCase()).toBe(INBOX.toLowerCase());
    expect(tx.from.toLowerCase()).toBe(SENDER.toLowerCase());
    expect(seen.methods).toContain("eth_getTransactionReceipt");

    await expect(feed.locator('[data-brief-id="2"] [data-brief-text]')).toHaveText("sell it all");
    await expect(page.getByTestId("count-briefs")).toHaveText("2");
    expect(await serious(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("keeps the send buttons off for a brief over 280 bytes and says why", async ({ page }) => {
    await installWallet(page);
    await installAskChain(page, chain(true));
    await page.goto("/ask");
    await page.getByLabel("Your brief").fill("é".repeat(141));
    await expect(page.getByText("282 / 280 bytes: 282 bytes is over the 280-byte limit.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send with Fake Wallet" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Send with Base Account" })).toBeDisabled();
  });
});
