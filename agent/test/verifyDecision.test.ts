import { readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Attribution } from "ox/erc8021";
import { concat, encodeAbiParameters, encodeEventTopics, keccak256, toBytes, toHex, zeroAddress, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { mandateVaultAbi } from "../src/abi/index.js";
import { addressOf } from "../src/addresses.js";
import { builderSuffix } from "../src/exec/builderCode.js";
import { encodeExecute } from "../src/exec/calls.js";
import { rowHash } from "../src/ledger/journal.js";
import { GENESIS } from "../src/rationale/blob.js";
import { canon } from "../src/rationale/canon.js";
import { verifyDecision, type DecisionReport } from "../src/rationale/verify.js";
import type { OnchainIntent } from "../src/types.js";
import { main, type VerifyClient } from "../scripts/verify-decision.js";

const FIXTURES = join(import.meta.dirname, "fixtures");
const INPUT_FILE = join(FIXTURES, "calldata-v1.hex");
const JOURNAL_FILE = join(FIXTURES, "journal-v1.jsonl");
const INPUT = readFileSync(INPUT_FILE, "utf8").trim() as Hex;
const JOURNAL = readFileSync(JOURNAL_FILE, "utf8");
const V1: Hex = JSON.parse(readFileSync(join(FIXTURES, "maat-v1-vectors.json"), "utf8")).V1.hex;
const V1_TEXT = Buffer.from(V1.slice(2), "hex").toString("latin1");
const [RUN_LINE] = JOURNAL.split("\n");
const RUN_HASH = "0x892d2dce569c783139f62dec297729642d35ff7e88bccd9d21dcb2defe2b84ff";
const TX: Hex = `0x${"ab".repeat(32)}`;
const VAULT: Address = "0x3F956072d18ddD20d5eFb74e9CCabf8Deade699b";
const OWNER: Address = "0x3c3a66f713DAE7e4A03Bbd81dB79FF65F42C1D6a";
const AGENT: Address = "0x2222222222222222222222222222222222222222";

const intent = (rationaleHash: Hex): OnchainIntent => ({
  id: keccak256(toBytes("spec-example")),
  action: 0,
  token: addressOf("NVDAc"),
  amount: 5_000_000n,
  minOut: 0n,
  payee: zeroAddress,
  rationaleHash,
});
const journal = (text: string, name = "journal-v1.jsonl") => [{ name, text }];
const statuses = (r: DecisionReport) => r.checks.map((c) => [c.name, c.status]);
const detail = (r: DecisionReport, name: string) => r.checks.find((c) => c.name === name)?.detail;

/** Published lines for `rows`, each chained to the one before it (§3.1). */
const chain = (rows: Record<string, unknown>[]): string => {
  let prev: Hex = GENESIS;
  return rows
    .map((r) => {
      const hash = rowHash(r, prev);
      const line = canon({ ...r, prev, hash });
      prev = hash;
      return line + "\n";
    })
    .join("");
};
const runRow = () => {
  const { prev: _p, hash: _h, ...row } = JSON.parse(RUN_LINE!);
  return row as Record<string, unknown>;
};
const sentRow = (over: Record<string, unknown> = {}) => ({
  kind: "sent",
  ts: "2026-11-24T16:59:10.000Z",
  runId: "1795539542000-a1b2c3d4",
  commit: "0123456789abcdef0123456789abcdef01234567",
  index: 0,
  intentId: keccak256(toBytes("spec-example")),
  action: "BUY",
  symbol: "NVDAc",
  amountUsd6: "5000000",
  rationaleHash: keccak256(V1),
  blob: V1_TEXT,
  preview: "OK",
  gate: "execute",
  txHash: TX,
  gas: "900000",
  ...over,
});

describe("the calldata fixture", () => {
  it("is the §5.6 calldata: execute ‖ V1 ‖ the fake_code suffix, 693 bytes", () => {
    expect(INPUT).toBe(concat([encodeExecute(intent(keccak256(V1))), V1, Attribution.toDataSuffix({ codes: ["fake_code"] }) as Hex]));
    expect((INPUT.length - 2) / 2).toBe(693);
  });
});

describe("verifyDecision", () => {
  it("passes the §5.6 input against the §5.7 journal: calldata, blob, hash, chain and the j anchor", () => {
    const r = verifyDecision({ input: INPUT, journal: journal(JOURNAL) });
    expect(r.verdict).toBe("PASS");
    expect(statuses(r)).toEqual([
      ["calldata", "pass"],
      ["blob", "pass"],
      ["hash", "pass"],
      ["journal", "pass"],
      ["anchor", "pass"],
    ]);
    expect(r.intentId).toBe(keccak256(toBytes("spec-example")));
    expect(detail(r, "hash")).toContain(keccak256(V1));
    expect(detail(r, "journal")).toBe("2 chained rows, head 0x3a54dfb09811088c8f2ffdecf4666c6e34f721a7e4166f1a6557dc3133ec4f8c");
    expect(detail(r, "anchor")).toBe(`j ${RUN_HASH} is the hash of journal-v1.jsonl:1, before journal-v1.jsonl:2 (the intent row carrying this blob)`);
  });

  it("re-derives the hash from the bytes: a blob changed in flight fails, and no journal row carries it", () => {
    const at = 2 * (228 + V1_TEXT.indexOf("Fixture") + 1) + 2;
    const changed = (INPUT.slice(0, at) + toHex("f").slice(2) + INPUT.slice(at + 2)) as Hex;
    const r = verifyDecision({ input: changed, journal: journal(JOURNAL) });
    expect(r.verdict).toBe("FAIL");
    expect(statuses(r)).toEqual([
      ["calldata", "pass"],
      ["blob", "pass"],
      ["hash", "fail"],
      ["journal", "pass"],
      ["anchor", "pending"],
    ]);
    expect(detail(r, "hash")).toMatch(/^keccak256\(blob\) 0x[0-9a-f]{64} is not the rationaleHash 0xbc7e8a95/);
  });

  it("fails a tampered journal, naming the file and line, and checks no anchor", () => {
    const tampered = JOURNAL.replace('"symbol":"NVDAc"', '"symbol":"AAPLc"');
    const r = verifyDecision({ input: INPUT, journal: journal(tampered) });
    expect(r.verdict).toBe("FAIL");
    expect(statuses(r)).toEqual([
      ["calldata", "pass"],
      ["blob", "pass"],
      ["hash", "pass"],
      ["journal", "fail"],
    ]);
    expect(detail(r, "journal")).toMatch(/^journal-v1\.jsonl:2: the hash 0x3a54dfb0[0-9a-f]+ does not match the row/);
  });

  it("names the day file a failing line is in when the journal spans several", () => {
    const [one, two] = JOURNAL.split("\n");
    const r = verifyDecision({ input: INPUT, journal: [{ name: "2026-11-24.jsonl", text: `${one}\n` }, { name: "2026-11-25.jsonl", text: `${two!.replace("BUY", "SELL")}\n` }] });
    expect(detail(r, "journal")).toMatch(/^2026-11-25\.jsonl:1: /);
    const ok = verifyDecision({ input: INPUT, journal: [{ name: "2026-11-24.jsonl", text: `${one}\n` }, { name: "2026-11-25.jsonl", text: `${two}\n` }] });
    expect(ok.verdict).toBe("PASS");
    expect(detail(ok, "anchor")).toContain("is the hash of 2026-11-24.jsonl:1, before 2026-11-25.jsonl:1");
  });

  it("finds the sent row by tx hash: pending until the journal has it, anchored when j is an earlier row", () => {
    expect(verifyDecision({ input: INPUT, txHash: TX, journal: journal(JOURNAL) })).toMatchObject({ verdict: "PENDING" });
    const pending = verifyDecision({ input: INPUT, txHash: TX, journal: journal(JOURNAL) });
    expect(detail(pending, "anchor")).toBe(`no sent or reconcile row has tx ${TX} yet: the journal has not caught up`);

    const anchored = verifyDecision({ input: INPUT, txHash: TX, journal: journal(chain([runRow(), sentRow()])) });
    expect(anchored.verdict).toBe("PASS");
    expect(detail(anchored, "anchor")).toBe(`j ${RUN_HASH} is the hash of journal-v1.jsonl:1, before journal-v1.jsonl:2 (the sent row for tx ${TX})`);
  });

  it("calls the anchor broken when j names no earlier row, or the sent row's blob is not the onchain one", () => {
    const otherRun = { ...runRow(), runId: "another-run" };
    const noJ = verifyDecision({ input: INPUT, txHash: TX, journal: journal(chain([otherRun, sentRow()])) });
    expect(noJ.verdict).toBe("FAIL");
    expect(detail(noJ, "anchor")).toBe(`broken: j ${RUN_HASH} is not the hash of any row before journal-v1.jsonl:2`);

    const otherBlob = verifyDecision({ input: INPUT, txHash: TX, journal: journal(chain([runRow(), sentRow({ blob: V1_TEXT.replace("Fixture", "Fixturf") })])) });
    expect(otherBlob.verdict).toBe("FAIL");
    expect(detail(otherBlob, "anchor")).toBe("broken: the blob on journal-v1.jsonl:2 is not the onchain blob");

    const reconcile = { kind: "reconcile", ts: "2026-11-24T17:10:00.000Z", runId: "r2", commit: "unknown", intentId: keccak256(toBytes("spec-example")), action: "BUY", txHash: TX, outcome: "applied" };
    expect(verifyDecision({ input: INPUT, txHash: TX, journal: journal(chain([runRow(), reconcile])) }).verdict).toBe("PASS");
  });

  it("anchors a GENESIS j only when no chained row comes before the row", () => {
    const genesisBlob = V1_TEXT.replace(RUN_HASH, GENESIS);
    const input = concat([encodeExecute(intent(keccak256(toBytes(genesisBlob)))), toHex(genesisBlob), builderSuffix("bc_fake1234")]);
    expect(verifyDecision({ input, txHash: TX, journal: journal(chain([sentRow({ blob: genesisBlob })])) }).verdict).toBe("PASS");
    const late = verifyDecision({ input, txHash: TX, journal: journal(chain([runRow(), sentRow({ blob: genesisBlob })])) });
    expect(detail(late, "anchor")).toBe("broken: j is GENESIS but journal-v1.jsonl:1 is a chained row before journal-v1.jsonl:2");
  });

  it("checks a Decision with no blob against the text it is given, and fails it without one", () => {
    const text = "Owner-sent first decision: BUY 5 USD of NVDAc";
    const owner = concat([encodeExecute(intent(keccak256(toBytes(text)))), builderSuffix("bc_fake1234")]);
    const r = verifyDecision({ input: owner, rationale: text });
    expect(r.verdict).toBe("PASS");
    expect(statuses(r)).toEqual([
      ["calldata", "pass"],
      ["blob", "pass"],
      ["hash", "pass"],
    ]);
    expect(detail(r, "blob")).toBe("none: no blob after the call; the hash is checked against the given text");
    expect(verifyDecision({ input: owner, rationale: `${text}.` }).verdict).toBe("FAIL");
    const bare = verifyDecision({ input: owner });
    expect(statuses(bare)).toEqual([
      ["calldata", "pass"],
      ["blob", "fail"],
    ]);
    expect(detail(bare, "blob")).toBe("none: no blob after the call; give its text with --rationale to check the hash");
  });

  it("fails an invalid or foreign blob, naming why", () => {
    const bad = "maat:v1:{}";
    const invalid = verifyDecision({ input: concat([encodeExecute(intent(keccak256(toBytes(bad)))), toHex(bad), builderSuffix("bc_fake1234")]) });
    expect(invalid.verdict).toBe("FAIL");
    expect(detail(invalid, "blob")).toMatch(/^invalid: /);
    const foreign = verifyDecision({ input: concat([encodeExecute(intent(keccak256(toBytes("hello")))), toHex("hello"), builderSuffix("bc_fake1234")]) });
    expect(detail(foreign, "blob")).toBe("foreign: 5 bytes after the call that do not start with maat:v1:");
  });

  it("fails an input that is not a direct execute call", () => {
    const r = verifyDecision({ input: "0x12345678" });
    expect(r).toMatchObject({ verdict: "FAIL", intentId: null });
    expect(statuses(r)).toEqual([["calldata", "fail"]]);
    expect(detail(r, "calldata")).toBe("not a direct execute call: 4 bytes, selector 0x12345678");
  });

  it("checks the Decision log's rationaleHash when it was read, and fails a receipt without one", () => {
    expect(statuses(verifyDecision({ input: INPUT, decisionHash: keccak256(V1) }))).toContainEqual(["decision", "pass"]);
    const wrong = verifyDecision({ input: INPUT, decisionHash: GENESIS });
    expect(wrong.verdict).toBe("FAIL");
    expect(detail(wrong, "decision")).toBe(`the Decision log's rationaleHash ${GENESIS} is not the intent's ${keccak256(V1)}`);
    expect(detail(verifyDecision({ input: INPUT, decisionHash: null }), "decision")).toBe("no Decision log for this intent in the receipt");
  });

  it("labels the sender when it knows the tx sender and the vault owner (spec §4)", () => {
    expect(verifyDecision({ input: INPUT, from: AGENT, owner: OWNER }).label).toBe("agent");
    expect(verifyDecision({ input: INPUT, from: OWNER, owner: OWNER }).label).toBe("owner, by hand");
    expect(verifyDecision({ input: INPUT }).label).toBeUndefined();
  });
});

describe("scripts/verify-decision.ts", () => {
  const run = async (argv: string[], client?: VerifyClient) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await main(argv, { out: (s) => out.push(s), err: (s) => err.push(s), ...(client ? { client: () => client } : {}) });
    return { code, out, err };
  };

  it("prints one line per check and PASS for the fixture input and journal, exit 0", async () => {
    const r = await run(["--input", INPUT_FILE, "--journal", JOURNAL_FILE]);
    expect(r.code).toBe(0);
    expect(r.err).toEqual([]);
    expect(r.out[0]).toBe(`intent ${keccak256(toBytes("spec-example"))}, rationaleHash ${keccak256(V1)}`);
    expect(r.out.slice(1, -1).map((l) => l.split(" ")[0])).toEqual(["PASS", "PASS", "PASS", "PASS", "PASS"]);
    expect(r.out.at(-1)).toBe("PASS");
  });

  it("takes the input as hex on the command line, and exits 1 on a failed check", async () => {
    expect((await run(["--input", INPUT])).code).toBe(0);
    const dir = await mkdtemp(join(tmpdir(), "maat-verify-"));
    await writeFile(join(dir, "j.jsonl"), JOURNAL.replace("BUY", "SELL"));
    const bad = await run(["--input", INPUT_FILE, "--journal", join(dir, "j.jsonl")]);
    expect(bad.code).toBe(1);
    expect(bad.out.at(-1)).toBe("FAIL");
    expect(bad.out).toContainEqual(expect.stringMatching(/^FAIL journal +j\.jsonl:2: /));
  });

  it("exits 2 while the journal has no row for the tx yet", async () => {
    const r = await run(["--input", INPUT_FILE, "--journal", JOURNAL_FILE, "--tx", TX]);
    expect(r.code).toBe(2);
    expect(r.out.at(-1)).toBe("PENDING");
  });

  it("exits 3 on bad arguments or an unreadable file, naming the problem", async () => {
    expect(await run([])).toMatchObject({ code: 3, err: ["verify-decision: give --input <hex or file>, or --tx <hash> with --rpc <url>"] });
    expect((await run(["--input", "0xzz"])).code).toBe(3);
    expect((await run(["--input", join(FIXTURES, "missing.hex")])).err[0]).toMatch(/^verify-decision: cannot read --input /);
    expect((await run(["--rpc", "http://127.0.0.1:1"])).code).toBe(3);
  });

  it("reads the tx, its receipt's Decision and the vault owner over RPC, and never prints the RPC URL", async () => {
    const id = keccak256(toBytes("spec-example"));
    const decision = (rationaleHash: Hex) => ({
      address: VAULT,
      topics: encodeEventTopics({ abi: mandateVaultAbi, eventName: "Decision", args: { intentId: id, token: addressOf("NVDAc") } }) as [Hex, ...Hex[]],
      data: encodeAbiParameters(
        [{ type: "uint8" }, { type: "uint256" }, { type: "bool" }, { type: "uint8" }, { type: "bytes32" }],
        [0, 5_000_000n, true, 0, rationaleHash],
      ),
    });
    const asked: string[] = [];
    const client = (rationaleHash: Hex): VerifyClient => ({
      getTransaction: async ({ hash }) => (asked.push(`tx ${hash}`), { input: INPUT, from: AGENT, to: VAULT }),
      getTransactionReceipt: async () => ({ logs: [decision(rationaleHash)] }),
      readContract: async () => OWNER,
    });
    const url = "https://base.example/v2/fake-key-123";
    const ok = await run(["--tx", TX, "--rpc", url, "--journal", JOURNAL_FILE], client(keccak256(V1)));
    expect(asked).toEqual([`tx ${TX}`]);
    expect(ok.out).toContainEqual("PASS decision  the Decision log's rationaleHash is the intent's");
    expect(ok.out).toContainEqual("sender: agent");
    expect(ok.code).toBe(2); // the fixture journal has no sent row for this tx
    const wrong = await run(["--tx", TX, "--rpc", url], client(GENESIS));
    expect(wrong.code).toBe(1);
    expect([...ok.out, ...ok.err, ...wrong.out, ...wrong.err].join("\n")).not.toContain("fake-key");
  });

  describe("--vault", () => {
    const id = keccak256(toBytes("spec-example"));
    const LOOKALIKE: Address = "0x4444444444444444444444444444444444444444";
    const url = "https://base.example/v2/fake-key-123";
    // A Decision log with the vault's event signature and the right rationaleHash, emitted by `address`.
    const log = (address: Address) => ({
      address,
      topics: encodeEventTopics({ abi: mandateVaultAbi, eventName: "Decision", args: { intentId: id, token: addressOf("NVDAc") } }) as [Hex, ...Hex[]],
      data: encodeAbiParameters([{ type: "uint8" }, { type: "uint256" }, { type: "bool" }, { type: "uint8" }, { type: "bytes32" }], [0, 5_000_000n, true, 0, keccak256(V1)]),
    });
    const client = (to: Address, read: Address[] = []): VerifyClient => ({
      getTransaction: async () => ({ input: INPUT, from: AGENT, to }),
      getTransactionReceipt: async () => ({ logs: [log(to)] }),
      readContract: async ({ address }) => (read.push(address), OWNER),
    });

    it("defaults to the Base mainnet MandateVault and names it in the calldata check", async () => {
      const read: Address[] = [];
      const r = await run(["--tx", TX, "--rpc", url], client(VAULT, read));
      expect(r.out).toContainEqual(expect.stringMatching(new RegExp(`^PASS calldata  228-byte execute call to the vault ${VAULT}, `)));
      expect(read).toEqual([VAULT]);
      expect(r.code).toBe(0);
    });

    it("fails the calldata check for a tx to another contract, however its logs and owner() look", async () => {
      const read: Address[] = [];
      const r = await run(["--tx", TX, "--rpc", url], client(LOOKALIKE, read));
      expect(r.code).toBe(1);
      expect(r.out).toContainEqual(`FAIL calldata  the tx calls ${LOOKALIKE}, not the vault ${VAULT}`);
      expect(r.out).not.toContainEqual("PASS decision  the Decision log's rationaleHash is the intent's");
      expect(r.out.join("\n")).not.toContain("sender:");
      expect(read).toEqual([VAULT]); // owner() is read from the vault, never from the contract the tx called
      expect(r.out.at(-1)).toBe("FAIL");
    });

    it("checks against the vault --vault names, and needs --rpc and an address", async () => {
      expect((await run(["--tx", TX, "--rpc", url, "--vault", LOOKALIKE], client(LOOKALIKE))).code).toBe(0);
      expect(await run(["--input", INPUT_FILE, "--vault", VAULT])).toMatchObject({ code: 3, err: ["verify-decision: --vault needs --tx with --rpc"] });
      expect(await run(["--tx", TX, "--rpc", url, "--vault", "0x12"], client(VAULT))).toMatchObject({ code: 3, err: ["verify-decision: --vault is not an address"] });
    });
  });
});
