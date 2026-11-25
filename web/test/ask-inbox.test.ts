// @vitest-environment node
import { encodeAbiParameters, encodeEventTopics, keccak256, toBytes, toHex, type Address, type Hash, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import type { CachedLog } from "@/lib/chain/cache";
import {
  briefBytes,
  briefCalldata,
  briefIdsIn,
  briefCounts,
  briefFeed,
  checkBrief,
  inboxAbi,
  inboxDeployment,
  MAX_BRIEF_BYTES,
  plainBriefText,
  readBriefs,
  waitForReceipt,
  type Brief,
} from "@/lib/chain/inbox";
import { constantValue, readRepo } from "./helpers/solidity";
import { fakeLedgerClient, hash32 } from "./helpers/fake-ledger";

const INBOX: Address = "0x00000000000000000000000000000000000B0001";
const ALICE: Address = "0x00000000000000000000000000000000000A11cE";
const BOB: Address = "0x0000000000000000000000000000000000000B0b";
const row = (contract: string, address = "", tx = "", network = "Base mainnet") => ({ network, contract, address, tx, date: "" });
const U = (code: number) => String.fromCodePoint(code);
const FFFD = U(0xfffd);
const RLO = U(0x202e);

describe("the inbox ABI", () => {
  const source = readRepo("contracts/src/MaatInbox.sol");

  it("matches contracts/src/MaatInbox.sol: brief(string), lastId, MAX_BYTES, the Brief event and BadLength", () => {
    expect(source).toContain("function brief(string calldata text) external returns (uint256 id)");
    expect(source).toContain("uint256 public lastId;");
    expect(source).toContain("event Brief(uint256 indexed id, address indexed from, string text);");
    expect(source).toContain("error BadLength(uint256 length);");
    expect(Number(constantValue(source, "MAX_BYTES"))).toBe(MAX_BRIEF_BYTES);
    const names = inboxAbi.map((x) => `${x.type} ${x.name}`);
    expect(names).toEqual(["function brief", "function lastId", "function MAX_BYTES", "event Brief", "error BadLength"]);
  });

  it("gives the selector of brief(string) and the topic of Brief(uint256,address,string)", () => {
    expect(briefCalldata("x").slice(0, 10)).toBe(keccak256(toBytes("brief(string)")).slice(0, 10));
    const [topic] = encodeEventTopics({ abi: inboxAbi, eventName: "Brief" });
    expect(topic).toBe(keccak256(toBytes("Brief(uint256,address,string)")));
  });
});

describe("inboxDeployment", () => {
  const TX = `0x${"cd".repeat(32)}` as Hash;

  it("is null while the table has no MaatInbox row, or its address cell is empty", () => {
    expect(inboxDeployment([row("MandateVault", "0x3F956072d18ddD20d5eFb74e9CCabf8Deade699b")])).toBeNull();
    expect(inboxDeployment([row("MaatInbox")])).toBeNull();
    expect(inboxDeployment([])).toBeNull();
  });

  it("returns the checksummed inbox and its deploy tx, or a null tx when that cell is empty", () => {
    expect(inboxDeployment([row("MaatInbox", INBOX.toLowerCase(), TX)])).toEqual({ inbox: INBOX, deployTx: TX });
    expect(inboxDeployment([row("MaatInbox", INBOX.toLowerCase())])).toEqual({ inbox: INBOX, deployTx: null });
  });

  it("ignores other networks and throws on a malformed address or tx", () => {
    expect(inboxDeployment([row("MaatInbox", INBOX, "", "Base Sepolia")])).toBeNull();
    expect(() => inboxDeployment([row("MaatInbox", "0x1234")])).toThrow(/MaatInbox address/);
    expect(() => inboxDeployment([row("MaatInbox", INBOX, "0xzz")])).toThrow(/MaatInbox tx/);
  });
});

describe("brief text validation, as MaatInbox.brief checks it: 1 to 280 bytes of UTF-8", () => {
  it("refuses 0 bytes", () => {
    expect(checkBrief("")).toEqual({ ok: false, bytes: 0, problem: "Write a brief first: it needs at least 1 byte." });
  });

  it("accepts 1 byte and 280 bytes", () => {
    expect(checkBrief("a")).toEqual({ ok: true, bytes: 1 });
    expect(checkBrief("a".repeat(280))).toEqual({ ok: true, bytes: 280 });
  });

  it("refuses 281 bytes", () => {
    expect(checkBrief("a".repeat(281))).toEqual({ ok: false, bytes: 281, problem: "281 bytes is over the 280-byte limit." });
  });

  it("counts UTF-8 bytes, not characters: 2-byte é, 3-byte €, 4-byte emoji", () => {
    expect(briefBytes("é")).toBe(2);
    expect(briefBytes("€")).toBe(3);
    expect(briefBytes("😀")).toBe(4);
    expect(checkBrief("é".repeat(140))).toEqual({ ok: true, bytes: 280 });
    expect(checkBrief("é".repeat(140) + "a")).toMatchObject({ ok: false, bytes: 281 });
    expect(checkBrief("😀".repeat(70))).toEqual({ ok: true, bytes: 280 });
    expect(checkBrief("😀".repeat(71))).toMatchObject({ ok: false, bytes: 284 });
    // 279 ASCII bytes and a 2-byte character: 280 characters would pass a character count, but it is 281 bytes.
    expect(checkBrief(`${"a".repeat(279)}é`)).toMatchObject({ ok: false, bytes: 281 });
    expect(`${"a".repeat(279)}é`.length).toBe(280);
  });

  it("counts a lone surrogate as the 3 bytes of U+FFFD, the bytes the encoder sends", () => {
    expect(briefBytes(String.fromCharCode(0xd800))).toBe(3);
  });
});

describe("briefCalldata", () => {
  it("is brief(text) ABI-encoded: the selector, the offset, the byte length and the UTF-8 bytes padded to 32", () => {
    const text = "sell it all now é";
    const selector = keccak256(toBytes("brief(string)")).slice(0, 10);
    const body = encodeAbiParameters([{ type: "string" }], [text]).slice(2);
    expect(briefCalldata(text)).toBe(`${selector}${body}`);
    const words = body.match(/.{64}/g)!;
    expect(BigInt(`0x${words[0]}`)).toBe(32n);
    expect(BigInt(`0x${words[1]}`)).toBe(18n);
    expect(`0x${words[2]}`.startsWith(toHex(toBytes(text)))).toBe(true);
  });

  it("throws on a text the contract would refuse, so nothing invalid is sent", () => {
    expect(() => briefCalldata("")).toThrow(/at least 1 byte/);
    expect(() => briefCalldata("a".repeat(281))).toThrow(/280-byte limit/);
  });
});

describe("plainBriefText", () => {
  it("replaces C0 and C1 controls, zero-width and direction code points with U+FFFD, as the agent's prompt does", () => {
    // Built from code points, so this file holds no invisible character itself.
    const codes = [0x00, 0x0a, 0x1f, 0x7f, 0x85, 0x9f, 0x200b, 0x200f, 0x202a, 0x202e, 0x2066, 0x2069];
    const hostile = codes.map((c) => `x${U(c)}`).join("") + "x";
    expect(plainBriefText(hostile)).toBe(codes.map(() => `x${FFFD}`).join("") + "x");
  });

  it("replaces every other format and default-ignorable code point, which a reader cannot see either", () => {
    // Soft hyphen, combining grapheme joiner, Arabic letter mark, Hangul fillers, Mongolian vowel separator, word joiner
    // to invisible plus, U+206A to U+206F, U+FEFF, variation selectors, and the tag characters U+E0000 to U+E007F.
    const codes = [
      0xad, 0x34f, 0x61c, 0x115f, 0x1160, 0x180e, 0x2060, 0x2064, 0x206a, 0x206f, 0x3164, 0xfe00, 0xfe0f, 0xfeff, 0xffa0, 0xe0001, 0xe0020, 0xe007f,
      0xe0100, 0xe01ef,
    ];
    const hostile = codes.map((c) => `x${U(c)}`).join("") + "x";
    expect(plainBriefText(hostile)).toBe(codes.map(() => `x${FFFD}`).join("") + "x");
  });

  it("leaves ASCII hidden in tag characters visible as marks: the feed and Claude see that something is there", () => {
    const tags = [..."SELL ALL"].map((c) => U(0xe0000 + c.charCodeAt(0))).join("");
    // The contract takes it: 3 bytes of "buy" and 4 bytes for each tag character.
    expect(checkBrief(`buy${tags}`)).toEqual({ ok: true, bytes: 3 + 4 * 8 });
    expect(plainBriefText(`buy${tags}`)).toBe(`buy${FFFD.repeat(8)}`);
  });

  it("keeps the code points just outside those ranges", () => {
    const kept = [0x20, 0x7e, 0xa0, 0xac, 0xae, 0x200a, 0x2010, 0x2029, 0x202f, 0x2070, 0x3165, 0xfe10, 0x1f600].map(U).join("");
    expect(plainBriefText(kept)).toBe(kept);
  });

  it("follows the rule of inbox spec §3, which the agent's prompt follows too", () => {
    expect(readRepo("docs/superpowers/specs/2026-11-25-maat-inbox-design.md")).toContain(
      "every code point of Unicode general category Cc or Cf, or with the Default_Ignorable_Code_Point property, replaced by U+FFFD",
    );
  });

  it("keeps every other character, markup and URLs included, as text", () => {
    const text = '<img src=x onerror="alert(1)"> **bold** [x](https://evil.example) مرحبا 😀';
    expect(plainBriefText(text)).toBe(text);
  });
});

/** A Brief log of the inbox, encoded with its ABI. */
function briefLog(id: number, from: Address, text: string, block: bigint): CachedLog {
  const topics = encodeEventTopics({ abi: inboxAbi, eventName: "Brief", args: { id: BigInt(id), from } }) as Hex[];
  return { blockNumber: block.toString(), logIndex: 0, transactionHash: hash32(9000 + id), topics, data: encodeAbiParameters([{ type: "string" }], [text]) };
}

const brief = (id: number, from: Address, text = `brief ${id}`): Brief => ({
  id,
  from,
  text,
  blockNumber: BigInt(100 + id),
  txHash: hash32(9000 + id),
  logIndex: 0,
});

describe("readBriefs", () => {
  const DEPLOY = 1_000_000n;
  const deployTx = { hash: hash32(42), block: DEPLOY };

  it("reads every Brief from the inbox's deploy block to the head, in id order", async () => {
    const client = fakeLedgerClient({
      head: DEPLOY + 120_000n,
      deployTx,
      logs: [briefLog(2, BOB, "second", DEPLOY + 90_000n), briefLog(1, ALICE, "first é", DEPLOY + 10n)],
    });
    const read = await readBriefs(client, { inbox: INBOX, deployTx: deployTx.hash });
    expect(read.complete).toBe(true);
    expect(read.head).toBe(DEPLOY + 120_000n);
    expect(read.briefs.map((b) => [b.id, b.from, b.text])).toEqual([
      [1, ALICE, "first é"],
      [2, BOB, "second"],
    ]);
    expect(Math.min(...client.logCalls.map((c) => Number(c.from)))).toBe(Number(DEPLOY));
  });

  it("says the read is not complete when a chunk fails", async () => {
    const client = fakeLedgerClient({ head: DEPLOY + 10n, deployTx, logs: [], failLogs: true });
    const read = await readBriefs(client, { inbox: INBOX, deployTx: deployTx.hash });
    expect(read.complete).toBe(false);
    expect(read.briefs).toEqual([]);
  });

  it("skips a log that is not a Brief", async () => {
    const other: CachedLog = { blockNumber: (DEPLOY + 1n).toString(), logIndex: 1, transactionHash: hash32(1), topics: [hash32(7)], data: "0x" };
    const client = fakeLedgerClient({ head: DEPLOY + 10n, deployTx, logs: [other, briefLog(1, ALICE, "kept", DEPLOY + 2n)] });
    const read = await readBriefs(client, { inbox: INBOX, deployTx: deployTx.hash });
    expect(read.briefs.map((b) => b.text)).toEqual(["kept"]);
  });
});

describe("waitForReceipt", () => {
  const noSleep = async () => {};

  it("asks again until Base has the receipt, then gives its block and status", async () => {
    let asked = 0;
    const client = {
      getTransactionReceipt: async () => {
        asked += 1;
        if (asked < 3) throw new Error("Transaction receipt could not be found");
        return { blockNumber: 77n, status: "success" as const, logs: [{ address: INBOX, topics: [hash32(5)], data: "0x" }] };
      },
    };
    expect(await waitForReceipt(client as never, hash32(1), { sleep: noSleep })).toEqual({
      blockNumber: 77n,
      status: "success",
      logs: [{ address: INBOX, topics: [hash32(5)], data: "0x" }],
    });
    expect(asked).toBe(3);
  });

  it("gives null once the time is up", async () => {
    let t = 0;
    const client = { getTransactionReceipt: async () => Promise.reject(new Error("not found")) };
    const read = await waitForReceipt(client as never, hash32(1), { timeoutMs: 10_000, intervalMs: 3000, sleep: async (ms) => void (t += ms), now: () => t });
    expect(read).toBeNull();
    expect(t).toBeGreaterThanOrEqual(10_000);
  });
});

describe("briefIdsIn: the briefs a receipt shows the inbox emitted", () => {
  const asReceiptLog = (address: Address, l: CachedLog) => ({ address, topics: l.topics, data: l.data });

  it("gives the id of each Brief the inbox emitted, and skips other contracts' logs and other events", () => {
    const other: Address = "0x00000000000000000000000000000000000B0002";
    const logs = [
      asReceiptLog(INBOX, briefLog(5, ALICE, "hi", 10n)),
      asReceiptLog(other, briefLog(6, ALICE, "a copy from another contract", 10n)),
      { address: INBOX, topics: [hash32(1)], data: "0x" as Hex },
      asReceiptLog(INBOX.toLowerCase() as Address, briefLog(7, BOB, "second", 10n)),
    ];
    expect(briefIdsIn(logs, INBOX)).toEqual([5, 7]);
  });

  it("gives none for a receipt with no Brief, as a smart wallet's outer transaction can have when the call inside failed", () => {
    expect(briefIdsIn([], INBOX)).toEqual([]);
  });
});

describe("the feed and the counters", () => {
  const briefs = [brief(1, ALICE), brief(2, BOB), brief(3, ALICE, `rude${RLO}text`)];

  it("lists briefs newest first with the sender shortened and the text made plain", () => {
    expect(briefFeed(briefs, [])).toEqual([
      { id: 3, from: ALICE, sender: "0x0000…11cE", text: `rude${FFFD}text`, txHash: hash32(9003) },
      { id: 2, from: BOB, sender: "0x0000…0B0b", text: "brief 2", txHash: hash32(9002) },
      { id: 1, from: ALICE, sender: "0x0000…11cE", text: "brief 1", txHash: hash32(9001) },
    ]);
  });

  it("leaves a hidden brief out of the feed but not out of the brief count", () => {
    expect(briefFeed(briefs, [2]).map((f) => f.id)).toEqual([3, 1]);
    expect(briefCounts(briefs, [2])).toEqual({ briefs: 3, wallets: 2, hidden: 1 });
    expect(briefCounts(briefs, [])).toEqual({ briefs: 3, wallets: 2, hidden: 0 });
  });

  it("counts an id on the hide-list that no brief has as nothing hidden", () => {
    expect(briefCounts(briefs, [99])).toEqual({ briefs: 3, wallets: 2, hidden: 0 });
  });

  it("counts wallets case-insensitively", () => {
    const lower = { ...brief(4, ALICE), from: ALICE.toLowerCase() as Address };
    expect(briefCounts([...briefs, lower], []).wallets).toBe(2);
  });
});
