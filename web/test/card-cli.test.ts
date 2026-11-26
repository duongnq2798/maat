// @vitest-environment node
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { encodeAbiParameters, encodeEventTopics, getAddress, type Address, type Hash, type Hex } from "viem";
import { afterEach, describe, expect, it } from "vitest";
import { pngSize } from "@/brand/render";
import { inboxAbi } from "@/lib/chain/inbox";
import { DEFAULT_OUT_DIR, runCard, UsageError, type CardDeps } from "@/lib/card/cli";
import type { CardRead, ChainPosition } from "@/lib/card/model";
import { parseCardFile, type CardClient, type CardSources } from "@/lib/card/read";
import { AGENT, cardCase, fixtureJson, VAULT } from "./helpers/card";
import { VECTORS } from "./helpers/maat-v1";

const TX1: Hash = "0xdfdb6739912a73542d90129bd7269a939dc8b2d47a869f56d9ab5e3a02e86c3b";
/** The vault's deploy block, 61,698,517 (deployments/README.md's MandateVault tx, read from Base on 2026-11-26). */
const DEPLOY_BLOCK = 61_698_517n;
/** Made-up deploy txs and inbox for the fake chain. */
const DEPLOY_TX: Hash = `0x${"de".repeat(32)}`;
const INBOX_TX: Hash = `0x${"1b".repeat(32)}`;
const INBOX: Address = getAddress("0x00000000000000000000000000000000000b0ec5");

const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "weighing-card-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface FakeChain {
  /** Every Decision of the vault on the fake chain, in any order. */
  decisions: ChainPosition[];
  status?: "success" | "reverted";
  logsFail?: boolean;
  briefLogs?: { topics: Hex[]; data: Hex }[];
}

/** A read-only Base that holds `read`'s transaction and nothing else, and records the log ranges asked for. */
function fakeBase(read: CardRead, chain: FakeChain) {
  const asked: { address: Address; fromBlock: bigint; toBlock: bigint }[] = [];
  const client = {
    async getTransactionReceipt({ hash }: { hash: Hash }) {
      if (hash === DEPLOY_TX) return { status: "success", blockNumber: DEPLOY_BLOCK, logs: [] };
      if (hash === INBOX_TX) return { status: "success", blockNumber: DEPLOY_BLOCK + 10n, logs: [] };
      if (hash.toLowerCase() !== read.txHash) throw new Error(`the fake chain has no tx ${hash}`);
      return { status: chain.status ?? "success", blockNumber: read.blockNumber, logs: read.logs };
    },
    async getTransaction({ hash }: { hash: Hash }) {
      if (hash.toLowerCase() !== read.txHash) throw new Error(`the fake chain has no tx ${hash}`);
      return read.tx;
    },
    async getBlock({ blockNumber }: { blockNumber: bigint }) {
      if (blockNumber !== read.blockNumber) throw new Error(`the fake chain has no block ${blockNumber}`);
      return { number: blockNumber, timestamp: BigInt(read.timestamp) };
    },
    async readContract({ address, functionName }: { address: Address; functionName: string }) {
      if (address === read.vault && functionName === "owner") return read.owner;
      throw new Error(`the fake chain has no ${functionName} at ${address}`);
    },
    async getLogs({ address, fromBlock, toBlock }: { address: Address; fromBlock: bigint; toBlock: bigint }) {
      asked.push({ address, fromBlock, toBlock });
      if (chain.logsFail) throw new Error("fake RPC down");
      if (address === read.vault) {
        return chain.decisions.filter((p) => p.blockNumber >= fromBlock && p.blockNumber <= toBlock).map((p) => ({ ...p, removed: false }));
      }
      if (address === INBOX) return (chain.briefLogs ?? []).map((l) => ({ ...l, blockNumber: DEPLOY_BLOCK + 20n, logIndex: 0, removed: false }));
      return [];
    },
  } as unknown as CardClient;
  return { client, asked };
}

const SOURCES: CardSources = { vault: VAULT, deployTx: DEPLOY_TX, inbox: null };
const deps = (client: CardClient, over: Partial<CardDeps> = {}): CardDeps => ({ client: () => client, sources: SOURCES, defaultOut: tempDir(), log: () => {}, ...over });
const one = () => parseCardFile(fixtureJson("weighing-card-1.json"));
const onePosition: ChainPosition = { blockNumber: 61_700_601n, logIndex: 24 };

describe("npm run card -- <txhash>", () => {
  it("reads the Decision from Base and writes both sizes to --out, numbered from the vault's deploy block", async () => {
    const { client, asked } = fakeBase(one(), { decisions: [onePosition] });
    const out = tempDir();
    const lines: string[] = [];
    const result = await runCard([TX1, "--out", out], deps(client, { log: (l) => lines.push(l) }));
    expect(result.files).toEqual([join(out, "weighing-1-dfdb6739-1600x900.png"), join(out, "weighing-1-dfdb6739-1080x1350.png")]);
    expect(result.files.map((f) => pngSize(readFileSync(f)))).toEqual([
      { width: 1600, height: 900 },
      { width: 1080, height: 1350 },
    ]);
    expect(asked).toEqual([{ address: VAULT, fromBlock: DEPLOY_BLOCK, toBlock: 61_700_601n }]);
    expect(lines[0]).toBe("Weighing № 1 · Refused · Market closed (MARKET_CLOSED) · BUY · NVDAc · $5.00 · owner, by hand");
    expect(lines.slice(1)).toEqual(result.files);
  }, 60_000);

  it("numbers the Decision by its place among every Decision of the vault, in chain order", async () => {
    const earlier: ChainPosition[] = [
      { blockNumber: 61_700_601n, logIndex: 30 },
      { blockNumber: 61_699_000n, logIndex: 3 },
      { blockNumber: 61_700_601n, logIndex: 2 },
    ];
    const { client } = fakeBase(one(), { decisions: [...earlier, onePosition] });
    const result = await runCard([TX1, "--out", tempDir()], deps(client));
    expect(result.model.title).toBe("Weighing № 3");
    expect(result.files[0]!.endsWith("weighing-3-dfdb6739-1600x900.png")).toBe(true);
  }, 60_000);

  it("refuses to number a Decision when the vault's logs could not all be read", async () => {
    const { client } = fakeBase(one(), { decisions: [onePosition], logsFail: true });
    await expect(runCard([TX1, "--out", tempDir()], deps(client))).rejects.toThrow("could not all be read, so the Decision cannot be numbered");
  });

  it("refuses a reverted transaction and one with no Decision of the vault", async () => {
    const reverted = fakeBase(one(), { decisions: [onePosition], status: "reverted" });
    await expect(runCard([TX1, "--out", tempDir()], deps(reverted.client))).rejects.toThrow("reverted: a reverted transaction logs no Decision");
    const none = fakeBase({ ...one(), logs: [] }, { decisions: [onePosition] });
    await expect(runCard([TX1, "--out", tempDir()], deps(none.client))).rejects.toThrow("holds 0 Decision logs of the vault");
  });

  it("reads the text of an adopted brief from the inbox's Brief logs when the inbox is deployed", async () => {
    const read = { ...cardCase({ from: AGENT, blob: VECTORS.V5.blob }), txHash: TX1 };
    const at: ChainPosition = { blockNumber: read.blockNumber, logIndex: read.logs.at(-1)!.logIndex };
    const brief = inboxAbi[3];
    const briefLog = {
      topics: encodeEventTopics({ abi: [brief], eventName: "Brief", args: { id: 7n, from: AGENT } }) as Hex[],
      data: encodeAbiParameters([{ type: "string" }], ["Buy 5 USD of NVDAc if the mandate allows it."]),
    };
    const { client, asked } = fakeBase(read, { decisions: [at], briefLogs: [briefLog] });
    const result = await runCard([TX1, "--out", tempDir()], deps(client, { sources: { ...SOURCES, inbox: { inbox: INBOX, deployTx: INBOX_TX } } }));
    expect(result.model.briefs).toEqual([
      expect.objectContaining({ id: 7, head: "Brief #7 · from 0x0000…6E17", text: "Buy 5 USD of NVDAc if the mandate allows it.", hasText: true, hasReply: false }),
    ]);
    // From the inbox's deploy block through the Decision's, newest chunk first.
    const inboxRanges = asked.filter((a) => a.address === INBOX);
    expect(inboxRanges[0]!.toBlock).toBe(read.blockNumber);
    expect(inboxRanges.at(-1)!.fromBlock).toBe(DEPLOY_BLOCK + 10n);
  }, 60_000);

  it("says brief text not available when the deployments table has no inbox", async () => {
    const read = { ...cardCase({ from: AGENT, blob: VECTORS.V5.blob }), txHash: TX1 };
    const at: ChainPosition = { blockNumber: read.blockNumber, logIndex: read.logs.at(-1)!.logIndex };
    const { client } = fakeBase(read, { decisions: [at] });
    const result = await runCard([TX1, "--out", tempDir()], deps(client));
    expect(result.model.briefs.map((b) => [b.head, b.text])).toEqual([["Brief #7", "brief text not available"]]);
  }, 60_000);

  it("needs a vault in the deployments table", async () => {
    const { client } = fakeBase(one(), { decisions: [onePosition] });
    await expect(runCard([TX1], deps(client, { sources: null }))).rejects.toThrow("deployments/README.md records no Base mainnet MandateVault");
  });
});

describe("npm run card -- --fixture FILE", () => {
  const forkFile = (dir: string, kind = "fork") => {
    const { decisionLogs: _numbered, ...rest } = fixtureJson("weighing-card-1.json") as Record<string, unknown>;
    const raw = { ...rest, kind, note: "made up for a test" };
    const file = join(dir, `${kind}.json`);
    writeFileSync(file, JSON.stringify(raw));
    return file;
  };
  const noBase: CardClient = new Proxy({} as CardClient, {
    get: () => {
      throw new Error("a --fixture card read Base");
    },
  });

  it("renders a fork transaction with its band, unnumbered, without reading Base", async () => {
    const dir = tempDir();
    const result = await runCard(["--fixture", forkFile(dir), "--out", dir], deps(noBase));
    expect(result.model.band).toBe("FORK REPLAY");
    expect(result.model.title).toBe("Weighing · not numbered");
    expect(result.files).toEqual([join(dir, "fork-replay-dfdb6739-1600x900.png"), join(dir, "fork-replay-dfdb6739-1080x1350.png")]);
  }, 60_000);

  it("writes to the default folder, made when missing, when no --out is given", async () => {
    const dir = tempDir();
    const defaultOut = join(dir, "not", "there", "yet");
    const result = await runCard(["--fixture", forkFile(dir, "preview")], deps(noBase, { defaultOut }));
    expect(result.files.map((f) => relative(defaultOut, f))).toEqual(["preview-not-a-decision-dfdb6739-1600x900.png", "preview-not-a-decision-dfdb6739-1080x1350.png"]);
    expect(result.files.every((f) => existsSync(f))).toBe(true);
  }, 60_000);

  it("refuses a mainnet file: a mainnet Decision is read from Base by its hash", async () => {
    const dir = tempDir();
    await expect(runCard(["--fixture", forkFile(dir, "mainnet"), "--out", dir], deps(noBase))).rejects.toThrow(UsageError);
    await expect(runCard(["--fixture", forkFile(dir, "mainnet"), "--out", dir], deps(noBase))).rejects.toThrow("a mainnet Decision is read from Base");
  });
});

describe("npm run card arguments", () => {
  it.each([
    [[], "give a transaction hash"],
    [["0x1234"], "0x1234 is not a transaction hash"],
    [[TX1, "--fixture", "x.json"], "a transaction hash or --fixture, not both"],
    [[TX1, TX1], "one transaction hash"],
    [[TX1, "--color"], "Unknown option"],
  ])("refuses %j", async (argv, message) => {
    const { client } = fakeBase(one(), { decisions: [onePosition] });
    const run = runCard(argv as string[], deps(client));
    await expect(run).rejects.toThrow(UsageError);
    await expect(runCard(argv as string[], deps(client))).rejects.toThrow(message);
  });

  it("writes by default to the build-in-public image folder at the repo root, which git ignores", () => {
    const root = resolve(process.cwd(), "..");
    expect(relative(root, DEFAULT_OUT_DIR).split(/[\\/]/)).toEqual([".superpowers", "build-in-public", "img"]);
    // git check-ignore exits 0 only for an ignored path: a card written there is never committed by accident.
    expect(() => execFileSync("git", ["check-ignore", "-q", join(DEFAULT_OUT_DIR, "weighing-1-dfdb6739-1600x900.png")], { cwd: root })).not.toThrow();
  });
});
