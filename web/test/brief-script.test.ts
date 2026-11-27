// @vitest-environment node
// scripts/brief.mjs prepares a brief for a sender's own wallet without the site's code. These tests hold its written
// constants to deployments/README.md and viem, and its calldata to the encoder /ask sends with.
import { encodeAbiParameters, encodeEventTopics, keccak256, toBytes, toFunctionSelector } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inboxAbi, MAX_BRIEF_BYTES } from "@/lib/chain/inbox";
import { briefTxData, erc8021Suffix as siteSuffix } from "@/lib/wallet/suffix";
import { readRepo } from "./helpers/solidity";
import * as script from "../../scripts/brief.mjs";

const s = script as unknown as {
  INBOX: string;
  VAULT: string;
  MAX_BYTES: number;
  BRIEF_SELECTOR: string;
  BRIEF_TOPIC: string;
  DECISION_TOPIC: string;
  briefData(text: string, suffix?: string | null): string;
  erc8021Suffix(code: string): string;
  suffixCode(input: string): string | null;
  briefFromLogs(logs: { address: string; topics: string[]; data: string }[]): { id: bigint; from: string; text: string } | null;
  clean(text: string): string;
  readBuilderCode(url: string): Promise<{ code?: string; why?: string }>;
  main(argv: string[]): Promise<number>;
};

const TEXTS = ["hi", "Hold more USDC before the long weekend?", "x".repeat(32), "é".repeat(140), "🙂 a brief with an emoji", "y".repeat(280)];

describe("scripts/brief.mjs", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("names the inbox and the vault deployments/README.md records", () => {
    const table = readRepo("deployments/README.md");
    const row = (name: string) => new RegExp(`\\| Base mainnet \\| ${name} \\| \\[\`(0x[0-9a-fA-F]{40})\``).exec(table)?.[1];
    expect(s.INBOX).toBe(row("MaatInbox"));
    expect(s.VAULT).toBe(row("MandateVault"));
    expect(s.MAX_BYTES).toBe(MAX_BRIEF_BYTES);
  });

  it("writes the selector and topics viem computes", () => {
    expect(s.BRIEF_SELECTOR).toBe(toFunctionSelector("brief(string)"));
    expect(s.BRIEF_TOPIC).toBe(keccak256(toBytes("Brief(uint256,address,string)")));
    expect(s.DECISION_TOPIC).toBe(keccak256(toBytes("Decision(bytes32,uint8,address,uint256,bool,uint8,bytes32)")));
  });

  it("builds the same transaction data as /ask, with and without a Builder Code", () => {
    const suffix = siteSuffix("bc_w7i5vjdv");
    expect(`0x${s.erc8021Suffix("bc_w7i5vjdv")}`).toBe(suffix);
    for (const text of TEXTS) {
      expect(s.briefData(text)).toBe(briefTxData(text, null));
      expect(s.briefData(text, s.erc8021Suffix("bc_w7i5vjdv"))).toBe(briefTxData(text, suffix));
    }
  });

  it("refuses what the contract refuses", () => {
    expect(() => s.briefData("")).toThrow(/1 to 280 bytes/);
    expect(() => s.briefData("é".repeat(141))).toThrow(/this one is 282/);
    expect(() => s.erc8021Suffix("Not-A-Code")).toThrow(/not a Builder Code/);
  });

  it("reads the code back from the end of a call", () => {
    const input = `0xad4cd4ad${"00".repeat(260)}${s.erc8021Suffix("bc_w7i5vjdv")}`;
    expect(s.suffixCode(input)).toBe("bc_w7i5vjdv");
    expect(s.suffixCode(`0xad4cd4ad${"00".repeat(260)}`)).toBeNull();
  });

  it("decodes the Brief log of a receipt", () => {
    const from = "0x00000000000000000000000000000000000000a1";
    const topics = encodeEventTopics({ abi: inboxAbi, eventName: "Brief", args: { id: 7n, from } }) as string[];
    const data = encodeAbiParameters([{ type: "string" }], ["Why hold NVDAc?"]);
    expect(s.briefFromLogs([{ address: s.INBOX.toLowerCase(), topics, data }])).toEqual({ id: 7n, from, text: "Why hold NVDAc?" });
    expect(s.briefFromLogs([{ address: s.VAULT, topics, data }])).toBeNull();
  });

  it("shows escapes from the chain or an RPC as U+FFFD", async () => {
    const ESC = String.fromCharCode(0x1b);
    const R = String.fromCodePoint(0xfffd);
    const raw = ["ok", ESC, "[2J", ESC, "]8;;https://x", String.fromCharCode(0x07), String.fromCharCode(0x9b), "31m", String.fromCharCode(0x200b)].join("");
    expect(s.clean(raw)).toBe(["ok", R, "[2J", R, "]8;;https://x", R, R, "31m", R].join(""));
    const from = "0x00000000000000000000000000000000000000a1";
    const topics = encodeEventTopics({ abi: inboxAbi, eventName: "Brief", args: { id: 1n, from } }) as string[];
    const data = encodeAbiParameters([{ type: "string" }], ["x"]);
    expect(s.briefFromLogs([{ address: s.INBOX, topics: [topics[0]!, topics[1]!, `0x${ESC}[2J`], data }])).toBeNull();

    const out: string[] = [];
    const err = vi.spyOn(console, "error").mockImplementation((m: string) => void out.push(m));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        const { method } = JSON.parse(init.body) as { method: string };
        if (method === "eth_chainId") return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x2105" }));
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -1, message: `boom ${ESC}[2J` } }), { status: 403 });
      }),
    );
    expect(await s.main(["--status", `0x${"ab".repeat(32)}`])).toBe(1);
    expect(out).toEqual([`eth_getTransactionReceipt: boom ${R}[2J (HTTP 403)`]);
    err.mockRestore();
  });

  it("says a hash with no receipt is pending or unknown", async () => {
    const out: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((m: string) => void out.push(m));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        const { method } = JSON.parse(init.body) as { method: string };
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: method === "eth_chainId" ? "0x2105" : null }));
      }),
    );
    expect(await s.main(["--status", `0x${"ab".repeat(32)}`])).toBe(1);
    expect(out.join(" ")).toMatch(/has no receipt yet: it is pending or unknown/);
    log.mockRestore();
  });

  it("takes the code only from a first Decision the owner sent", async () => {
    const owner = "0x3c3a66f713dae7e4a03bbd81db79ff65f42c1d6a";
    const input = `0xad4cd4ad${"00".repeat(260)}${s.erc8021Suffix("bc_w7i5vjdv")}`;
    const chain = (sender: string) =>
      vi.fn(async (_url: string, init: { body: string }) => {
        const { method } = JSON.parse(init.body) as { method: string };
        const result: Record<string, unknown> = {
          eth_call: `0x${owner.slice(2).padStart(64, "0")}`,
          eth_blockNumber: "0x3b00000",
          eth_getLogs: [{ transactionHash: `0x${"11".repeat(32)}` }],
          eth_getTransactionByHash: { from: sender, to: s.VAULT, input },
        };
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: result[method] }));
      });
    vi.stubGlobal("fetch", chain(owner));
    expect(await s.readBuilderCode("http://rpc")).toEqual({ code: "bc_w7i5vjdv" });
    vi.stubGlobal("fetch", chain("0x00000000000000000000000000000000000000b2"));
    expect(await s.readBuilderCode("http://rpc")).toEqual({ why: "the vault's first Decision was not sent by its owner" });
  });

  it("asks for no key and refuses a bad address before any read", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await s.main(["hi", "--from", "0x123"])).toBe(2);
    expect(await s.main(["--private-key", "0xabc", "hi"])).toBe(2);
    expect(fetch).not.toHaveBeenCalled();
    err.mockRestore();
    expect(readRepo("scripts/brief.mjs")).not.toMatch(/private.?key|mnemonic|eth_sendRawTransaction|eth_sendTransaction/i);
  });
});
