import { readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InvalidInputRpcError, RpcRequestError, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { briefKey, briefsLine, DEPLOYMENTS_FILE, inboxRecord, readBriefLogs, readInboxRecord, safeBlock } from "../src/briefs/inbox.js";
import { MAX_LOG_RANGE, MIN_LOG_RANGE } from "../src/chain/logWindows.js";
import { FakeInbox, INBOX, INBOX_DEPLOY_TX, SENDERS } from "./fakes/fakeInbox.js";

const HEAD = `| Network | Contract | Address | Tx | Date |
|---|---|---|---|---|
| Base mainnet | MandateVault | [\`0x3F956072d18ddD20d5eFb74e9CCabf8Deade699b\`](https://basescan.org/address/0x3F956072d18ddD20d5eFb74e9CCabf8Deade699b) | [\`0xf5a532fe5d8b2ddf7fce312f524537e614f4988b425972dd1098f3d56631c9c1\`](https://basescan.org/tx/0xf5a532fe5d8b2ddf7fce312f524537e614f4988b425972dd1098f3d56631c9c1) | 2026-11-24 |`;
const inboxRow = (address: string, tx: string) => `\n| Base mainnet | MaatInbox | ${address} | ${tx} | 2026-11-30 |`;

describe("the MaatInbox record in deployments/README.md", () => {
  it("is null while the table has no MaatInbox row, or the row's address is empty", () => {
    expect(inboxRecord(HEAD)).toBeNull();
    expect(inboxRecord(HEAD + inboxRow("", ""))).toBeNull();
  });

  it("reads the address and the deploy tx, as links or as plain code", () => {
    const tx = "0x" + "ab".repeat(32);
    expect(inboxRecord(HEAD + inboxRow(`[\`${INBOX}\`](https://basescan.org/address/${INBOX})`, `[\`${tx}\`](https://basescan.org/tx/${tx})`))).toEqual({ inbox: INBOX, deployTx: tx });
    expect(inboxRecord(HEAD + inboxRow(`\`${INBOX.toLowerCase()}\``, ""))).toEqual({ inbox: INBOX, deployTx: null });
  });

  it("refuses a MaatInbox row whose address or tx is not one", () => {
    expect(() => inboxRecord(HEAD + inboxRow("0x1234", ""))).toThrow(/MaatInbox address "0x1234" is not an address/);
    expect(() => inboxRecord(HEAD + inboxRow(INBOX, "0xabc"))).toThrow(/MaatInbox tx "0xabc" is not a transaction hash/);
  });

  it("reads the repository's own table: the MaatInbox the owner deployed on Base mainnet on 2026-11-27", () => {
    const deployed = {
      inbox: "0x6a3D27f2d8a5BC991Bf4511aAA698A5B2DCDf12a",
      deployTx: "0x61b7f0b44ae01a6fbb34e0e7c35d53c2ffd1228fbc3f0b3dd020741826850db4",
    };
    expect(inboxRecord(readFileSync(DEPLOYMENTS_FILE, "utf8"))).toEqual(deployed);
    expect(readInboxRecord()).toEqual(deployed);
  });

  it("is null when the file does not exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "maat-inbox-"));
    expect(readInboxRecord(join(dir, "README.md"))).toBeNull();
    await writeFile(join(dir, "README.md"), HEAD + inboxRow(INBOX, INBOX_DEPLOY_TX));
    expect(readInboxRecord(join(dir, "README.md"))).toEqual({ inbox: INBOX, deployTx: INBOX_DEPLOY_TX });
  });
});

describe("the start line", () => {
  it("says briefs are off and no inbox log is read when no MaatInbox is recorded", () => {
    expect(briefsLine({ record: null })).toBe("maat agent: briefs=off: deployments/README.md records no MaatInbox, so no inbox log is read");
  });

  it("says briefs are off when the record has no deploy tx or cannot be read, and why", () => {
    expect(briefsLine({ record: { inbox: INBOX, deployTx: null } })).toBe(
      `maat agent: briefs=off: deployments/README.md records MaatInbox ${INBOX} with no deploy tx, so no inbox log is read`,
    );
    expect(briefsLine({ record: null, problem: 'MaatInbox address "0x1234" is not an address' })).toBe(
      'maat agent: briefs=off: deployments/README.md: MaatInbox address "0x1234" is not an address, so no inbox log is read',
    );
  });

  it("names the inbox and the safe block when briefs are on", () => {
    expect(briefsLine({ record: { inbox: INBOX, deployTx: INBOX_DEPLOY_TX } })).toBe(
      `maat agent: briefs=on: MaatInbox ${INBOX}, Brief logs read up to the safe block, at most 3 a round, 20 a day and 2 per sender a day`,
    );
  });
});

describe("reading Brief logs", () => {
  it("reads only up to the safe tag", async () => {
    const f = new FakeInbox();
    f.safe = 1234n;
    expect(await safeBlock(f.client())).toBe(1234n);
    expect(f.blockTags).toEqual(["safe"]);
  });

  it("decodes each log into (id, from, text) and its identity (id, txHash, logIndex), in id order", async () => {
    const f = new FakeInbox();
    f.brief(2, SENDERS[1]!, "sell it all", 120n, 3);
    f.brief(1, SENDERS[0]!, "buy more NVDAc", 110n);
    const briefs = await readBriefLogs(f.client(), INBOX, 100n, 200n);
    expect(briefs.map((b) => [b.id, b.from, b.text, b.block, b.logIndex])).toEqual([
      [1, SENDERS[0], "buy more NVDAc", 110n, 0],
      [2, SENDERS[1], "sell it all", 120n, 3],
    ]);
    expect(briefKey(briefs[1]!)).toBe(`2:${briefs[1]!.txHash}:3`);
    expect(f.queries.every((q) => q.address === INBOX)).toBe(true);
  });

  it("reads in windows of at most 9,000 blocks, with no gap and no overlap", async () => {
    const f = new FakeInbox();
    f.brief(1, SENDERS[0]!, "first", 100n);
    f.brief(2, SENDERS[0]!, "last", 100n + 2n * MAX_LOG_RANGE + 5n);
    const briefs = await readBriefLogs(f.client(), INBOX, 100n, 100n + 2n * MAX_LOG_RANGE + 10n);
    expect(briefs.map((b) => b.id)).toEqual([1, 2]);
    expect(f.queries.map((q) => [q.fromBlock, q.toBlock])).toEqual([
      [100n, 100n + MAX_LOG_RANGE - 1n],
      [100n + MAX_LOG_RANGE, 100n + 2n * MAX_LOG_RANGE - 1n],
      [100n + 2n * MAX_LOG_RANGE, 100n + 2n * MAX_LOG_RANGE + 10n],
    ]);
  });

  it("halves the window on a range error, down to 200 blocks, as the fallback RPC needs", async () => {
    const f = new FakeInbox();
    f.rangeCap = MIN_LOG_RANGE;
    f.brief(1, SENDERS[0]!, "x", 150n);
    const briefs = await readBriefLogs(f.client(), INBOX, 1n, 1000n);
    expect(briefs.map((b) => b.id)).toEqual([1]);
    const ok = f.queries.filter((q) => q.toBlock - q.fromBlock + 1n <= MIN_LOG_RANGE);
    expect(ok[0]).toMatchObject({ fromBlock: 1n, toBlock: 200n });
    expect(ok.at(-1)).toMatchObject({ toBlock: 1000n });
  });

  it("throws any other RPC error, so the round reads no brief rather than a partial set", async () => {
    const f = new FakeInbox();
    f.fail = new InvalidInputRpcError(new RpcRequestError({ body: {}, error: { code: -32000, message: "upstream down" }, url: "http://127.0.0.1:1" }));
    await expect(readBriefLogs(f.client(), INBOX, 1n, 10n)).rejects.toThrow(/upstream down/);
  });

  it("decodes text leniently: invalid UTF-8 becomes U+FFFD, and a log of another shape is passed over", async () => {
    const f = new FakeInbox();
    f.rawBrief(1, SENDERS[0]!, "0xff41" as Hex, 110n);
    f.junk(111n);
    const briefs = await readBriefLogs(f.client(), INBOX, 100n, 200n);
    expect(briefs.map((b) => b.text)).toEqual(["\u{FFFD}A"]);
  });
});
