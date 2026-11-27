import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { encodeAbiParameters, encodeEventTopics, getAddress, keccak256, toBytes, type Address, type Hash, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { ASK_NOTICE, AskApp } from "@/app/(site)/ask/AskApp";
import { PreviewForm } from "@/app/(site)/ask/PreviewForm";
import AskPage, { metadata } from "@/app/(site)/ask/page";
import { askConfig, askIsOpen, fetchAskConfig } from "@/app/(site)/ask/config";
import { GET as GET_ASK } from "@/app/data/ask.json/route";
import { Nav } from "@/components/sections/Nav";
import { ASK_OG_IMAGE } from "@/content/ask-card";
import { ASK_OPEN } from "@/content/ask-open";
import { ACTIONS } from "@/content/decisions";
import { REASONS } from "@/content/reasons";
import type { CachedLog } from "@/lib/chain/cache";
import { inboxAbi } from "@/lib/chain/inbox";
import { shortAddress } from "@/lib/chain/tokens";
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

describe("/ask while the owner's switch in web/content/ask-open.ts is off", () => {
  it("is closed with the committed switch and deployments table", () => {
    expect(ASK_OPEN).toBe(false);
    expect(askIsOpen(askConfig(docsData.deployments))).toBe(false);
  });

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

  it("points its og:image and twitter:image to its own card, not the landing's", () => {
    const og = metadata.openGraph as { images?: unknown[] } | undefined;
    const tw = metadata.twitter as { images?: unknown[] } | undefined;
    expect(og?.images).toEqual([ASK_OG_IMAGE]);
    expect(tw?.images).toEqual([ASK_OG_IMAGE]);
    expect(ASK_OG_IMAGE.url).toBe("/og/ask.png");
  });

  it("leads with the invitation line, word for word", () => {
    render(<AskPage />);
    expect(screen.getByText(/^Try to talk Maat's agent into a bad trade\. The vault has the last word\./)).toBeInTheDocument();
  });

  it("uses the notice of the inbox spec §4", () => {
    expect(readRepo("docs/superpowers/specs/2026-11-25-maat-inbox-design.md")).toContain(`> ${ASK_NOTICE}\n`);
  });
});

describe("the owner's switch: /ask opens only when it is on and the inbox and the vault are recorded", () => {
  // The committed table without its MaatInbox row, plus a test inbox when `inbox` is true.
  const rows = (inbox: boolean) => [
    ...docsData.deployments.filter((r) => r.contract !== "MaatInbox"),
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
    // The nav draws its Ask link only while the owner's switch is on; the next test renders it.
    const nav = join(web, "components", "sections", "Nav.tsx");
    const sources = ["app", "components", "content", "lib"]
      .flatMap((d) => files(join(web, d)))
      .filter((f) => !f.startsWith(own) && f !== nav);
    const linked = sources.filter((f) => links(f, readFileSync(f, "utf8"))).map((f) => relative(web, f).split(sep).join("/"));
    expect(linked).toEqual([]);
  });

  it.skipIf(open)("renders no nav link to /ask, on the landing or off it", () => {
    for (const onLanding of [true, false]) {
      const { container, unmount } = render(<Nav onLanding={onLanding} />);
      expect([...container.querySelectorAll("a")].map((a) => a.getAttribute("href")), `onLanding=${onLanding}`).not.toContain("/ask");
      unmount();
    }
  });
});

/** A Brief log of the inbox, encoded with its ABI. */
function briefLog(id: number, from: Address, text: string, block: bigint): CachedLog {
  const topics = encodeEventTopics({ abi: inboxAbi, eventName: "Brief", args: { id: BigInt(id), from } }) as Hex[];
  return { blockNumber: block.toString(), logIndex: 0, transactionHash: hash32(9000 + id), topics, data: encodeAbiParameters([{ type: "string" }], [text]) };
}

describe("/ask once it is open", () => {
  /** A Brief log as the receipt of its transaction carries it. */
  const receiptLog = (l: CachedLog) => ({ address: INBOX, topics: l.topics, data: l.data });

  /**
   * The page with an open inbox, a fake Base and a fake EIP-6963 wallet. `emitBrief` false gives the sent transaction a
   * receipt with no Brief; `holdSend` keeps eth_sendTransaction pending until `release()`; `baseAccount` answers the
   * Base Account requests; `sentInput` is the input Base reports for the sent transaction (the wallet's data by default).
   */
  function setup(opts: { emitBrief?: boolean; holdSend?: boolean; baseAccount?: Record<string, unknown>; sentInput?: Hex } = {}) {
    const { emitBrief = true } = opts;
    const ownerInput = `${executeCalldata({ rationaleHash: keccak256(toBytes("first")) })}${erc8021Suffix([AGENT_TEST_CODE]).slice(2)}` as Hex;
    const logs: CachedLog[] = [decisionLog(1, DEPLOY + 5n), briefLog(1, SENDER, "<b>buy</b> https://evil.example", DEPLOY + 9n)];
    const fake = fakeLedgerClient({
      head: DEPLOY + 100n,
      deployTx: { hash: hash32(4242), block: DEPLOY },
      logs,
      txs: { [hash32(1)]: { from: OWNER, to: VAULT, input: ownerInput } },
    });
    const requests: { method: string; params?: unknown }[] = [];
    const sentData = () => (requests.find((r) => r.method === "eth_sendTransaction")?.params as [{ data: Hex }] | undefined)?.[0].data;
    const receipts: Hash[] = [];
    let added = false;
    const client = {
      ...fake,
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === "owner") return OWNER;
        throw new Error(`unexpected readContract ${functionName}`);
      },
      getTransactionReceipt: async ({ hash }: { hash: Hash }) => {
        if (hash === SENT) {
          receipts.push(hash);
          if (!emitBrief) return { blockNumber: DEPLOY + 50n, status: "success", logs: [] };
          const log = briefLog(2, SENDER, "the new brief", DEPLOY + 50n);
          if (!added) logs.push(log);
          added = true;
          return { blockNumber: DEPLOY + 50n, status: "success", logs: [receiptLog(log)] };
        }
        return fake.getTransactionReceipt({ hash });
      },
      getTransaction: async ({ hash }: { hash: Hash }) => {
        if (hash === SENT) return { hash, from: SENDER, to: INBOX, input: opts.sentInput ?? sentData() };
        return fake.getTransaction({ hash });
      },
    } as unknown as LedgerClient;
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const wallet: InjectedWallet = {
      info: { uuid: "fake-1", name: "Fake Wallet", icon: "", rdns: "test.fake" },
      provider: {
        request: async ({ method, params }) => {
          requests.push({ method, params });
          if (method === "eth_requestAccounts" || method === "eth_accounts") return [SENDER];
          if (method === "eth_chainId") return "0x2105";
          if (method === "eth_sendTransaction") return opts.holdSend ? held.then(() => SENT) : SENT;
          throw Object.assign(new Error(`${method} unsupported`), { code: 4200 });
        },
      },
    };
    const baseAccount = async () => ({
      request: async ({ method, params }: { method: string; params?: unknown }) => {
        requests.push({ method, params });
        const answers = { eth_requestAccounts: [SENDER], ...opts.baseAccount };
        if (method in answers) return answers[method as keyof typeof answers];
        throw Object.assign(new Error(`${method} unsupported`), { code: 4200 });
      },
    });
    const config = { open: true, vault: VAULT, deployTx: hash32(4242), inbox: { inbox: INBOX, deployTx: hash32(4242) }, deployments: [] };
    render(
      <AskApp
        initial={config}
        deps={{
          client,
          fetchConfig: () => new Promise(() => {}),
          // The team set as /proof traces it: here no team wallet sent a brief.
          team: async () => ({ members: new Set<string>(), complete: true }),
          watch: (onChange) => {
            onChange([wallet]);
            return () => {};
          },
          baseAccount,
        }}
      />,
    );
    return { requests, receipts, release };
  }

  const box = () => screen.getByLabelText("Your brief") as HTMLTextAreaElement;
  const write = (text: string) => fireEvent.change(box(), { target: { value: text } });
  const codeRead = () => waitFor(() => expect(document.querySelector(`[data-builder-code="${AGENT_TEST_CODE}"]`)).not.toBeNull());
  const calls = (status: number, receiptStatus: "0x1" | "0x0") => ({
    wallet_sendCalls: { id: "0xbundle" },
    wallet_getCallsStatus: {
      version: "2.0.0",
      id: "0xbundle",
      chainId: "0x2105",
      atomic: true,
      status,
      receipts: [{ blockHash: hash32(77), blockNumber: "0x10", gasUsed: "0x5208", logs: [], status: receiptStatus, transactionHash: SENT }],
    },
  });

  it("reads the Builder Code, shows the feed as text, and sends a brief whose calldata ends with the suffix", async () => {
    const { requests } = setup();
    expect(screen.queryByText("The inbox is not open yet.")).toBeNull();
    await codeRead();

    const feed = await screen.findByRole("list", { name: "Briefs" });
    expect(within(feed).getByText("<b>buy</b> https://evil.example")).toBeInTheDocument();
    expect(within(feed).queryAllByRole("link")).toEqual([]);
    // The counters wait for the journal and the team set as well as the feed's logs, so they can settle after the feed shows.
    await waitFor(() => expect(screen.getByTestId("count-briefs")).toHaveTextContent("1"));

    const send = screen.getByRole("button", { name: "Send with Fake Wallet" });
    expect(send).toBeDisabled();
    write("sell it all");
    expect(screen.getByText("11 / 280 bytes")).toBeInTheDocument();
    fireEvent.click(send);

    await screen.findByText(/^Included in block 2,000,050 as brief #2\. It is in the feed below\./);
    const tx = (requests.find((r) => r.method === "eth_sendTransaction")!.params as [{ data: Hex; to: Address }])[0];
    expect(tx.data).toBe(briefTxData("sell it all", AGENT_TEST_SUFFIX));
    expect(tx.to.toLowerCase()).toBe(INBOX.toLowerCase());
    expect(await screen.findByText("Its calldata ends with the Builder Code suffix.")).toHaveAttribute("data-suffix-check", "end");
    expect(box().value).toBe("");
    await waitFor(() => expect(screen.getByTestId("count-briefs")).toHaveTextContent("2"));
    expect(within(screen.getByRole("list", { name: "Briefs" })).getByText("the new brief")).toBeInTheDocument();
  });

  it("says how each path carries the Builder Code", async () => {
    setup();
    await codeRead();
    const line = document.querySelector(`[data-builder-code="${AGENT_TEST_CODE}"]`)!;
    expect(line).toHaveTextContent("A browser wallet puts it at the end of the brief's calldata (ERC-8021).");
    expect(line).toHaveTextContent("Base Account is asked to add it through the dataSuffix capability, and may leave it out.");
    expect(line).toHaveTextContent("Once the brief is included, the page checks the calldata.");
  });

  it("says the brief is not in the inbox when its transaction emitted no Brief, and keeps the text", async () => {
    setup({ emitBrief: false });
    await codeRead();
    write("sell it all");
    fireEvent.click(screen.getByRole("button", { name: "Send with Fake Wallet" }));
    expect(
      await screen.findByText(/^Included in block 2,000,050, but the transaction emitted no Brief from the inbox, so the brief is not in the feed\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/It is in the feed below/)).toBeNull();
    expect(box().value).toBe("sell it all");
    await waitFor(() => expect(screen.getByTestId("count-briefs")).toHaveTextContent("1"));
  });

  it("keeps the box read-only while the wallet is asked, so the text on the page is the text it signs", async () => {
    const { requests, release } = setup({ holdSend: true });
    await codeRead();
    write("buy 5 USDC of NVDAc");
    fireEvent.click(screen.getByRole("button", { name: "Send with Fake Wallet" }));
    await waitFor(() => expect(requests.some((r) => r.method === "eth_sendTransaction")).toBe(true));
    expect(box()).toHaveAttribute("readonly");
    release();
    await screen.findByText(/^Included in block/);
    expect(box()).not.toHaveAttribute("readonly");
    expect(box().value).toBe("");
  });

  it("sends with Base Account and reports the suffix the wallet put inside its call", async () => {
    const wrapped = `0x1234${briefTxData("sell it all", AGENT_TEST_SUFFIX).slice(2)}${"00".repeat(20)}` as Hex;
    const { requests } = setup({ baseAccount: calls(200, "0x1"), sentInput: wrapped });
    await codeRead();
    write("sell it all");
    fireEvent.click(screen.getByRole("button", { name: "Send with Base Account" }));
    await screen.findByText(/^Included in block 2,000,050 as brief #2\./);
    const [params] = requests.find((r) => r.method === "wallet_sendCalls")!.params as [{ capabilities: unknown }];
    expect(JSON.parse(JSON.stringify(params.capabilities))).toEqual({ dataSuffix: { value: AGENT_TEST_SUFFIX, optional: true } });
    expect(await screen.findByText("Its calldata carries the Builder Code suffix inside the wallet's call.")).toHaveAttribute("data-suffix-check", "inside");
  });

  it("says when Base Account's transaction does not carry the suffix", async () => {
    setup({ baseAccount: calls(200, "0x1"), sentInput: briefTxData("sell it all", null) });
    await codeRead();
    write("sell it all");
    fireEvent.click(screen.getByRole("button", { name: "Send with Base Account" }));
    expect(await screen.findByText("Its calldata does not carry the Builder Code suffix.")).toHaveAttribute("data-suffix-check", "none");
  });

  it("shows Base Account's failure, and never says the brief is in the feed, when the wallet reports the call failed", async () => {
    const { receipts } = setup({ baseAccount: calls(500, "0x0") });
    await codeRead();
    write("sell it all");
    fireEvent.click(screen.getByRole("button", { name: "Send with Base Account" }));
    expect(await screen.findByText("Base Account reported the brief's call as failed (status 500), so the brief is not in the inbox.")).toBeInTheDocument();
    expect(screen.queryByText(/^Included in block/)).toBeNull();
    expect(receipts).toEqual([]);
    expect(box().value).toBe("sell it all");
  });

  it("keeps the send buttons off for a text over 280 bytes and says why", () => {
    setup();
    write("é".repeat(141));
    expect(screen.getByText("282 / 280 bytes: 282 bytes is over the 280-byte limit.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send with Fake Wallet" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send with Base Account" })).toBeDisabled();
  });
});

describe("the free preview of PAY_EXPENSE", () => {
  const PAYEE = getAddress("0x000000000000000000000000000000000000fee1");
  const OTHER = getAddress("0x00000000000000000000000000000000000bad01");

  /** A vault that lists PAYEE in payees() and allows an expense only to it, recording each previewIntent. */
  function vault() {
    const asked: { payee: Address; action: number }[] = [];
    const client = {
      getBlockNumber: async () => 61_000_000n,
      readContract: async ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => {
        if (functionName === "payees") return [PAYEE.toLowerCase()];
        if (functionName !== "previewIntent") throw new Error(`unexpected readContract ${functionName}`);
        const intent = args![0] as { payee: Address; action: number };
        asked.push({ payee: intent.payee, action: intent.action });
        return intent.payee.toLowerCase() === PAYEE.toLowerCase() ? 0 : 1 + REASONS.indexOf("PAYEE_NOT_ALLOWED");
      },
    } as unknown as LedgerClient;
    render(<PreviewForm vault={VAULT} client={client} />);
    return { asked };
  }

  const form = () => screen.getByRole("form", { name: "Ask the real vault" });
  const payee = () => within(form()).getByLabelText("Payee") as HTMLInputElement;

  it("asks for a payee only for PAY_EXPENSE, fills in the vault's first payee and names it in the answer", async () => {
    const { asked } = vault();
    expect(within(form()).queryByLabelText("Payee")).toBeNull();
    fireEvent.change(within(form()).getByLabelText("Action"), { target: { value: "PAY_EXPENSE" } });
    await waitFor(() => expect(payee().value).toBe(PAYEE));
    expect(within(form()).getByText("Filled with the vault's first payee, from payees().")).toBeInTheDocument();
    fireEvent.click(within(form()).getByRole("button", { name: "Ask the vault" }));
    await waitFor(() => expect(form().querySelector('[data-preview-reason="OK"]')).not.toBeNull());
    expect(asked).toEqual([{ payee: PAYEE, action: ACTIONS.indexOf("PAY_EXPENSE") }]);
    expect(within(form()).getByRole("status")).toHaveTextContent(`PAY_EXPENSE NVDAc, 20 USDC to ${shortAddress(PAYEE)}, at block 61,000,000: the vault would allow it.`);
  });

  it("asks about the payee the visitor enters, and refuses to ask without a valid address", async () => {
    const { asked } = vault();
    fireEvent.change(within(form()).getByLabelText("Action"), { target: { value: "PAY_EXPENSE" } });
    await waitFor(() => expect(payee().value).toBe(PAYEE));
    fireEvent.change(payee(), { target: { value: "not an address" } });
    fireEvent.click(within(form()).getByRole("button", { name: "Ask the vault" }));
    expect(await within(form()).findByText("Enter the payee as a 0x address of 40 hex digits.")).toBeInTheDocument();
    expect(asked).toEqual([]);
    fireEvent.change(payee(), { target: { value: OTHER } });
    fireEvent.click(within(form()).getByRole("button", { name: "Ask the vault" }));
    await waitFor(() => expect(form().querySelector('[data-preview-reason="PAYEE_NOT_ALLOWED"]')).not.toBeNull());
    expect(asked).toEqual([{ payee: OTHER, action: ACTIONS.indexOf("PAY_EXPENSE") }]);
    expect(within(form()).getByRole("status")).toHaveTextContent(`to ${shortAddress(OTHER)}`);
  });
});
