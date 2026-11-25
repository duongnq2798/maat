import { decodeFunctionData, type Address, type Hash, type Hex } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { briefCalldata, inboxAbi } from "@/lib/chain/inbox";
import { baseAccountProvider, resetBaseAccountProvider } from "@/lib/wallet/base-account";
import { watchWallets, type Eip1193Provider, type InjectedWallet } from "@/lib/wallet/eip6963";
import { bundleTxHash, ensureBase, requestAccount, sendBriefBaseAccount, sendBriefInjected, walletErrorText } from "@/lib/wallet/send";
import { briefTxData } from "@/lib/wallet/suffix";
import { AGENT_TEST_SUFFIX } from "./helpers/maat-v1";

const sdk = vi.hoisted(() => ({ options: [] as unknown[], provider: { request: async () => null } }));
vi.mock("@base-org/account/browser", () => ({
  createBaseAccountSDK: (options: unknown) => {
    sdk.options.push(options);
    return { getProvider: () => sdk.provider };
  },
}));

const INBOX: Address = "0x00000000000000000000000000000000000B0001";
const ACCOUNT: Address = "0x00000000000000000000000000000000000A11cE";
const TX: Hash = `0x${"ab".repeat(32)}`;

type Handler = (params: unknown) => unknown;

/** An EIP-1193 provider that answers from `handlers` and records every request; a method with no handler fails with 4200. */
function fakeProvider(handlers: Record<string, Handler | unknown>) {
  const requests: { method: string; params?: unknown }[] = [];
  const provider: Eip1193Provider = {
    request: async ({ method, params }) => {
      requests.push({ method, params });
      if (!(method in handlers)) throw Object.assign(new Error(`${method} is not supported`), { code: 4200 });
      const h = handlers[method];
      return typeof h === "function" ? (h as Handler)(params) : h;
    },
  };
  return { provider, requests };
}

const onBase = { eth_chainId: "0x2105", eth_accounts: [ACCOUNT], eth_requestAccounts: [ACCOUNT] };

describe("requestAccount", () => {
  it("asks the wallet for its accounts and returns the first, checksummed", async () => {
    const { provider } = fakeProvider({ eth_requestAccounts: [ACCOUNT.toLowerCase()] });
    expect(await requestAccount(provider)).toBe(ACCOUNT);
  });

  it("fails with a sentence when the wallet gives no account", async () => {
    const { provider } = fakeProvider({ eth_requestAccounts: [] });
    await expect(requestAccount(provider)).rejects.toThrow("The wallet gave no account.");
  });
});

describe("ensureBase: the brief goes to Base mainnet, chain id 8453", () => {
  it("asks nothing more when the wallet is on Base", async () => {
    const { provider, requests } = fakeProvider(onBase);
    await ensureBase(provider);
    expect(requests.map((r) => r.method)).toEqual(["eth_chainId"]);
  });

  it("asks the wallet to switch to Base, then checks that it did", async () => {
    let chain = "0x1";
    const { provider, requests } = fakeProvider({ eth_chainId: () => chain, wallet_switchEthereumChain: () => ((chain = "0x2105"), null) });
    await ensureBase(provider);
    expect(requests).toEqual([
      { method: "eth_chainId", params: undefined },
      { method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] },
      { method: "eth_chainId", params: undefined },
    ]);
  });

  it("adds Base when the wallet does not know it (4902)", async () => {
    let chain = "0x1";
    const { provider, requests } = fakeProvider({
      eth_chainId: () => chain,
      wallet_switchEthereumChain: () => Promise.reject(Object.assign(new Error("Unrecognized chain"), { code: 4902 })),
      wallet_addEthereumChain: () => ((chain = "0x2105"), null),
    });
    await ensureBase(provider);
    const add = requests.find((r) => r.method === "wallet_addEthereumChain")?.params as [{ chainId: string; chainName: string; rpcUrls: string[] }];
    expect(add[0]).toMatchObject({ chainId: "0x2105", chainName: "Base", rpcUrls: ["https://mainnet.base.org"] });
  });

  it("fails when the wallet stays on another chain", async () => {
    const { provider } = fakeProvider({ eth_chainId: "0x1", wallet_switchEthereumChain: null });
    await expect(ensureBase(provider)).rejects.toThrow("Your wallet is not on Base (chain id 8453). Switch it to Base and send again.");
  });
});

describe("sendBriefInjected: viem writeContract with the Builder Code as dataSuffix", () => {
  it("sends brief(text) to the inbox with the exact ERC-8021 suffix after it", async () => {
    const { provider, requests } = fakeProvider({ ...onBase, eth_sendTransaction: TX });
    const text = "buy more NVDAc, it is cheap";
    expect(await sendBriefInjected({ provider, account: ACCOUNT, inbox: INBOX, text, suffix: AGENT_TEST_SUFFIX })).toBe(TX);
    const sent = requests.filter((r) => r.method === "eth_sendTransaction");
    expect(sent).toHaveLength(1);
    const tx = (sent[0]!.params as [{ data: Hex; to: Address; from: Address; value?: Hex }])[0];
    expect(tx.data).toBe(briefTxData(text, AGENT_TEST_SUFFIX));
    expect(tx.data.endsWith(AGENT_TEST_SUFFIX.slice(2))).toBe(true);
    expect(tx.to.toLowerCase()).toBe(INBOX.toLowerCase());
    expect(tx.from.toLowerCase()).toBe(ACCOUNT.toLowerCase());
    expect(BigInt(tx.value ?? "0x0")).toBe(0n);
    // What MaatInbox reads: the suffix after the ABI-encoded string is ignored.
    expect(decodeFunctionData({ abi: inboxAbi, data: tx.data }).args).toEqual([text]);
  });

  it("sends brief(text) alone when the Builder Code could not be read", async () => {
    const { provider, requests } = fakeProvider({ ...onBase, eth_sendTransaction: TX });
    await sendBriefInjected({ provider, account: ACCOUNT, inbox: INBOX, text: "hello", suffix: null });
    const tx = (requests.find((r) => r.method === "eth_sendTransaction")!.params as [{ data: Hex }])[0];
    expect(tx.data).toBe(briefCalldata("hello"));
  });

  it("refuses a text the contract would refuse before asking the wallet anything", async () => {
    const { provider, requests } = fakeProvider({ ...onBase, eth_sendTransaction: TX });
    await expect(sendBriefInjected({ provider, account: ACCOUNT, inbox: INBOX, text: "", suffix: AGENT_TEST_SUFFIX })).rejects.toThrow(/at least 1 byte/);
    await expect(sendBriefInjected({ provider, account: ACCOUNT, inbox: INBOX, text: "é".repeat(141), suffix: null })).rejects.toThrow(/282 bytes/);
    expect(requests).toEqual([]);
  });
});

describe("sendBriefBaseAccount: wallet_sendCalls with the dataSuffix capability", () => {
  it("carries the suffix as the dataSuffix capability, and the call carries brief(text) alone", async () => {
    const { provider, requests } = fakeProvider({ wallet_sendCalls: { id: "0xbundle" } });
    const text = "sell it all now";
    expect(await sendBriefBaseAccount({ provider, account: ACCOUNT, inbox: INBOX, text, suffix: AGENT_TEST_SUFFIX })).toEqual({ id: "0xbundle" });
    expect(requests.map((r) => r.method)).toEqual(["wallet_sendCalls"]);
    const [params] = requests[0]!.params as [Record<string, unknown>];
    expect(JSON.parse(JSON.stringify(params))).toEqual({
      atomicRequired: false,
      calls: [{ data: briefCalldata(text), to: INBOX }],
      capabilities: { dataSuffix: { value: AGENT_TEST_SUFFIX, optional: true } },
      chainId: "0x2105",
      from: ACCOUNT,
      version: "2.0.0",
    });
  });

  it("sends no capability when the Builder Code could not be read", async () => {
    const { provider, requests } = fakeProvider({ wallet_sendCalls: "0xbundle" });
    expect(await sendBriefBaseAccount({ provider, account: ACCOUNT, inbox: INBOX, text: "hi", suffix: null })).toEqual({ id: "0xbundle" });
    const [params] = requests[0]!.params as [Record<string, unknown>];
    expect(params.capabilities).toBeUndefined();
  });

  it("refuses a text the contract would refuse before asking the wallet anything", async () => {
    const { provider, requests } = fakeProvider({ wallet_sendCalls: "0xbundle" });
    await expect(sendBriefBaseAccount({ provider, account: ACCOUNT, inbox: INBOX, text: "a".repeat(281), suffix: null })).rejects.toThrow(/281 bytes/);
    expect(requests).toEqual([]);
  });
});

describe("bundleTxHash: the transaction of a wallet_sendCalls bundle, only when the wallet reports it succeeded", () => {
  const receipt = (status: "0x1" | "0x0") => ({ blockHash: `0x${"11".repeat(32)}`, blockNumber: "0x10", gasUsed: "0x5208", logs: [], status, transactionHash: TX });
  const calls = (status: number, receipts: unknown[]) => fakeProvider({ wallet_getCallsStatus: { version: "2.0.0", id: "0xbundle", chainId: "0x2105", atomic: true, status, receipts } });

  it("gives the transaction hash once the wallet reports the call included and successful", async () => {
    expect(await bundleTxHash(calls(200, [receipt("0x1")]).provider, "0xbundle")).toBe(TX);
  });

  it("fails with a sentence when the wallet reports the call as failed, even with a transaction hash", async () => {
    await expect(bundleTxHash(calls(500, [receipt("0x0")]).provider, "0xbundle")).rejects.toThrow(
      "Base Account reported the brief's call as failed (status 500), so the brief is not in the inbox.",
    );
  });

  it("fails when the wallet reports success but the transaction reverted", async () => {
    await expect(bundleTxHash(calls(200, [receipt("0x0")]).provider, "0xbundle")).rejects.toThrow(
      "Base Account reported that the brief's transaction reverted, so the brief is not in the inbox.",
    );
  });

  it("gives null when the wallet reports success with no transaction", async () => {
    expect(await bundleTxHash(calls(200, []).provider, "0xbundle")).toBeNull();
  });
});

describe("baseAccountProvider", () => {
  afterEach(() => resetBaseAccountProvider());

  it("creates the @base-org/account SDK for Base only, with telemetry off, once, and returns its provider", async () => {
    sdk.options.length = 0;
    expect(await baseAccountProvider()).toBe(sdk.provider);
    expect(await baseAccountProvider()).toBe(sdk.provider);
    expect(sdk.options).toEqual([{ appName: "Maat", appLogoUrl: null, appChainIds: [8453], preference: { telemetry: false } }]);
  });
});

describe("watchWallets: EIP-6963 discovery", () => {
  const announce = (detail: unknown) => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
  const info = (uuid: string, name: string) => ({ uuid, name, icon: "data:image/svg+xml,<svg/>", rdns: `io.example.${uuid}` });

  it("asks wallets to announce, lists each one once, skips malformed announcements and stops on request", () => {
    const seen: InjectedWallet[][] = [];
    const requested = vi.fn();
    window.addEventListener("eip6963:requestProvider", requested);
    const stop = watchWallets(window, (w) => seen.push(w));
    expect(requested).toHaveBeenCalledTimes(1);

    const provider = { request: async () => null };
    announce({ info: info("a", "Wallet A"), provider });
    announce({ info: info("a", "Wallet A again"), provider });
    announce({ info: { uuid: "b" }, provider });
    announce({ info: info("c", "Wallet C"), provider: {} });
    announce({ info: info("d", "Wallet D"), provider });
    expect(seen.at(-1)!.map((w) => w.info.name)).toEqual(["Wallet A", "Wallet D"]);

    stop();
    announce({ info: info("e", "Wallet E"), provider });
    expect(seen.at(-1)!.map((w) => w.info.name)).toEqual(["Wallet A", "Wallet D"]);
    window.removeEventListener("eip6963:requestProvider", requested);
  });
});

describe("walletErrorText", () => {
  it("says the person declined for 4001, and gives other errors' short messages", () => {
    expect(walletErrorText(Object.assign(new Error("User rejected the request."), { code: 4001 }))).toBe("You declined the request in your wallet.");
    expect(walletErrorText(new Error("insufficient funds for gas"))).toBe("insufficient funds for gas");
    expect(walletErrorText("odd")).toBe("odd");
  });
});
