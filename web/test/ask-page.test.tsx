import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { encodeAbiParameters, encodeEventTopics, keccak256, toBytes, type Address, type Hash, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { ASK_NOTICE, AskApp } from "@/app/(site)/ask/AskApp";
import AskPage, { metadata } from "@/app/(site)/ask/page";
import { askConfig, askIsOpen, fetchAskConfig } from "@/app/(site)/ask/config";
import { GET as GET_ASK } from "@/app/data/ask.json/route";
import { ASK_OPEN } from "@/content/ask-open";
import type { CachedLog } from "@/lib/chain/cache";
import { inboxAbi } from "@/lib/chain/inbox";
import { docsData } from "@/lib/docs/generated";
import type { LedgerClient } from "@/lib/chain/load";
import type { InjectedWallet } from "@/lib/wallet/eip6963";
import { briefTxData } from "@/lib/wallet/suffix";
import { decisionLog, fakeLedgerClient, hash32 } from "./helpers/fake-ledger";
import { AGENT_TEST_CODE, AGENT_TEST_SUFFIX, erc8021Suffix, executeCalldata } from "./helpers/maat-v1";

// jsdom gives import.meta.url no file: scheme, so the repo root comes from the working directory, web/.
const REPO_ROOT = join(process.cwd(), "..");
const readRepo = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8").split("\r\n").join("\n");

const VAULT: Address = "0x00000000000000000000000000000000000Aa001";
const INBOX: Address = "0x00000000000000000000000000000000000B0001";
const OWNER: Address = "0x00000000000000000000000000000000000000A1";
const SENDER: Address = "0x00000000000000000000000000000000000A11cE";
const DEPLOY = 2_000_000n;
const SENT: Hash = `0x${"5e".repeat(32)}`;

describe("/ask while deployments/README.md records no MaatInbox", () => {
  it("shows the notice word for word, the not-open state and the free preview, with no way to send", () => {
    render(<AskPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Brief the agent" })).toBeInTheDocument();
    expect(screen.getByRole("note").textContent).toBe(
      "Nobody trades through Maat; the vault trades only its own funds. Tokenized stocks are only available in eligible jurisdictions outside of the U.S.",
    );
    expect(screen.getByText("The inbox is not open yet.")).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Ask the real vault" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask the vault" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /^Send with/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Briefs" })).toBeNull();
  });

  it("names its canonical URL and asks search engines not to index it yet", () => {
    expect(metadata.alternates?.canonical).toBe("/ask");
    expect(metadata.robots).toEqual({ index: false, follow: true });
    expect(String(metadata.title)).toBe("Brief the agent · Maat");
    const d = String(metadata.description);
    expect(d.length).toBeGreaterThanOrEqual(50);
    expect(d.length).toBeLessThanOrEqual(160);
  });

  it("uses the notice of the inbox spec §4", () => {
    expect(readRepo("docs/superpowers/specs/2026-11-25-maat-inbox-design.md")).toContain(`> ${ASK_NOTICE}\n`);
  });
});

describe("the owner's switch: /ask opens only when it is on and the inbox and the vault are recorded", () => {
  const rows = (inbox: boolean) => [
    ...docsData.deployments,
    ...(inbox ? [{ network: "Base mainnet", contract: "MaatInbox", address: INBOX, tx: hash32(4242), date: "2026-11-25" }] : []),
  ];

  it("is the boolean of web/content/ask-open.ts, which askConfig takes by default", () => {
    expect(typeof ASK_OPEN).toBe("boolean");
    expect(askConfig(rows(true)).open).toBe(ASK_OPEN);
  });

  it("keeps the page closed while the switch is off, even with the inbox recorded", () => {
    expect(askIsOpen(askConfig(rows(true), false))).toBe(false);
    expect(askIsOpen(askConfig(rows(false), true))).toBe(false);
    expect(askIsOpen({ ...askConfig(rows(true), true), vault: null })).toBe(false);
    expect(askIsOpen(askConfig(rows(true), true))).toBe(true);
  });

  it("reads the switch at runtime from /data/ask.json, and the addresses from /data/deployments.json", async () => {
    const served: Record<string, unknown> = { "/data/deployments.json": { contracts: rows(true) }, "/data/ask.json": { open: true } };
    const fetchImpl = (async (url: string) => new Response(JSON.stringify(served[url]), { status: served[url] ? 200 : 404 })) as unknown as typeof fetch;
    const c = await fetchAskConfig(fetchImpl);
    expect(c.open).toBe(true);
    expect(c.inbox?.inbox).toBe(INBOX);
    expect(askIsOpen(c)).toBe(true);
    served["/data/ask.json"] = { open: "yes" };
    await expect(fetchAskConfig(fetchImpl)).rejects.toThrow();
    delete served["/data/ask.json"];
    await expect(fetchAskConfig(fetchImpl)).rejects.toThrow("/data/ask.json answered HTTP 404");
  });

  it("serves the committed switch at /data/ask.json", async () => {
    expect(await GET_ASK().json()).toEqual({ open: ASK_OPEN });
  });

  it("says the inbox is not open, with no way to send and no feed, when the inbox is recorded but the switch is off", () => {
    const config = askConfig(rows(true), false);
    render(<AskApp initial={config} deps={{ client: fakeLedgerClient({ head: 1n, logs: [] }), fetchConfig: () => new Promise(() => {}) }} />);
    expect(screen.getByText("The inbox is not open yet.")).toBeInTheDocument();
    expect(screen.getByText(/MaatInbox is recorded in deployments\/README\.md, but this page does not send briefs yet\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Send with/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Briefs" })).toBeNull();
  });
});

describe("no page links /ask while it is not open", () => {
  const open = askIsOpen(askConfig(docsData.deployments));
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : /\.(tsx?|mdx|json)$/.test(name) ? [path] : [];
    });

  // In code, any quoted "/ask" path could become an href. In a docs page, only a link target is a link: a Markdown
  // link or reference, or an href. The guide names the page in a code span, which renders as text.
  const CODE_LINK = /["'`(]\/ask(?=["'`)#?/])/;
  const MDX_LINK = /(?:\]\(\s*|^\[[^\]]+\]:\s*|href=\{?\s*["'`])\/ask(?=[\s"'`)#?/}]|$)/m;
  const links = (path: string, text: string) => (path.endsWith(".mdx") ? MDX_LINK : CODE_LINK).test(text);

  it("tells a link to /ask from a mention of it", () => {
    for (const text of ["[Ask](/ask)", "[Ask]( /ask#send)", "[ask]: /ask", '<a href="/ask">Ask</a>', '<Card href={"/ask/"} />']) {
      expect(links("page.mdx", text), text).toBe(true);
    }
    for (const text of ["The site's `/ask` page", "web/app/(site)/ask/AskApp.tsx", "/asking", "[Ask](/asks)"]) expect(links("page.mdx", text), text).toBe(false);
    for (const text of ['href: "/ask"', "`/ask#feed`", "{ href: '/ask/' }"]) expect(links("nav.ts", text), text).toBe(true);
    expect(links("nav.ts", '"/asking"')).toBe(false);
  });

  it.skipIf(open)("finds no link to /ask in the site's code or docs outside the page itself", () => {
    const web = join(REPO_ROOT, "web");
    const own = join(web, "app", "(site)", "ask");
    const sources = ["app", "components", "content", "lib"].flatMap((d) => files(join(web, d))).filter((f) => !f.startsWith(own));
    const linked = sources.filter((f) => links(f, readFileSync(f, "utf8"))).map((f) => relative(web, f).split(sep).join("/"));
    expect(linked).toEqual([]);
  });
});

/** A Brief log of the inbox, encoded with its ABI. */
function briefLog(id: number, from: Address, text: string, block: bigint): CachedLog {
  const topics = encodeEventTopics({ abi: inboxAbi, eventName: "Brief", args: { id: BigInt(id), from } }) as Hex[];
  return { blockNumber: block.toString(), logIndex: 0, transactionHash: hash32(9000 + id), topics, data: encodeAbiParameters([{ type: "string" }], [text]) };
}

describe("/ask once the inbox is recorded", () => {
  function setup() {
    const ownerInput = `${executeCalldata({ rationaleHash: keccak256(toBytes("first")) })}${erc8021Suffix([AGENT_TEST_CODE]).slice(2)}` as Hex;
    const logs: CachedLog[] = [decisionLog(1, DEPLOY + 5n), briefLog(1, SENDER, "<b>buy</b> https://evil.example", DEPLOY + 9n)];
    const fake = fakeLedgerClient({
      head: DEPLOY + 100n,
      deployTx: { hash: hash32(4242), block: DEPLOY },
      logs,
      txs: { [hash32(1)]: { from: OWNER, to: VAULT, input: ownerInput } },
    });
    const client = {
      ...fake,
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === "owner") return OWNER;
        throw new Error(`unexpected readContract ${functionName}`);
      },
      getTransactionReceipt: async ({ hash }: { hash: Hash }) => {
        if (hash === SENT) {
          logs.push(briefLog(2, SENDER, "the new brief", DEPLOY + 50n));
          return { blockNumber: DEPLOY + 50n, status: "success" };
        }
        return fake.getTransactionReceipt({ hash });
      },
    } as unknown as LedgerClient;
    const requests: { method: string; params?: unknown }[] = [];
    const wallet: InjectedWallet = {
      info: { uuid: "fake-1", name: "Fake Wallet", icon: "", rdns: "test.fake" },
      provider: {
        request: async ({ method, params }) => {
          requests.push({ method, params });
          if (method === "eth_requestAccounts" || method === "eth_accounts") return [SENDER];
          if (method === "eth_chainId") return "0x2105";
          if (method === "eth_sendTransaction") return SENT;
          throw Object.assign(new Error(`${method} unsupported`), { code: 4200 });
        },
      },
    };
    const config = { open: true, vault: VAULT, deployTx: hash32(4242), inbox: { inbox: INBOX, deployTx: hash32(4242) } };
    render(
      <AskApp
        initial={config}
        deps={{
          client,
          fetchConfig: () => new Promise(() => {}),
          watch: (onChange) => {
            onChange([wallet]);
            return () => {};
          },
        }}
      />,
    );
    return { requests };
  }

  it("reads the Builder Code, shows the feed as text, and sends a brief whose calldata ends with the suffix", async () => {
    const { requests } = setup();
    expect(screen.queryByText("The inbox is not open yet.")).toBeNull();
    await waitFor(() => expect(document.querySelector(`[data-builder-code="${AGENT_TEST_CODE}"]`)).not.toBeNull());

    const feed = await screen.findByRole("list", { name: "Briefs" });
    expect(within(feed).getByText("<b>buy</b> https://evil.example")).toBeInTheDocument();
    expect(within(feed).queryAllByRole("link")).toEqual([]);
    expect(screen.getByTestId("count-briefs")).toHaveTextContent("1");

    const send = screen.getByRole("button", { name: "Send with Fake Wallet" });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Your brief"), { target: { value: "sell it all" } });
    expect(screen.getByText("11 / 280 bytes")).toBeInTheDocument();
    fireEvent.click(send);

    await screen.findByText(/^Included in block/);
    const tx = (requests.find((r) => r.method === "eth_sendTransaction")!.params as [{ data: Hex; to: Address }])[0];
    expect(tx.data).toBe(briefTxData("sell it all", AGENT_TEST_SUFFIX));
    expect(tx.to.toLowerCase()).toBe(INBOX.toLowerCase());
    await waitFor(() => expect(screen.getByTestId("count-briefs")).toHaveTextContent("2"));
    expect(within(screen.getByRole("list", { name: "Briefs" })).getByText("the new brief")).toBeInTheDocument();
  });

  it("keeps the send buttons off for a text over 280 bytes and says why", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Your brief"), { target: { value: "é".repeat(141) } });
    expect(screen.getByText("282 / 280 bytes: 282 bytes is over the 280-byte limit.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send with Fake Wallet" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send with Base Account" })).toBeDisabled();
  });
});
