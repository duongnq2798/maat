// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAbiItem, toEventSelector, type Abi, type AbiEvent } from "viem";
import { describe, expect, it } from "vitest";
import abis from "@/content/generated/abi.json";
import addresses from "@/content/generated/base-addresses.json";
import { FACTS } from "@/content/facts";
import { REASON_LABEL, REASONS } from "@/content/reasons";
import { etLabel } from "@/lib/chain/ledger";
import { txKeys } from "../../film/lib/beats.mjs";
import { deploymentRows } from "../../film/lib/sources.mjs";
import {
  ACTIONS,
  BRIEF_TOPIC,
  DECISION_TOPIC,
  REASON_CODES,
  REASON_LABELS,
  decodeLog,
  etTime,
  readTxConfig,
  tokenSymbols,
  txCardHtml,
  txCardModel,
  txProblems,
} from "../../film/lib/tx.mjs";
import { REPO_ROOT, enumMembers, readRepo } from "./helpers/solidity";

// Beats 5 to 7 show transactions the agent has not sent yet. Their hashes live in film/txs.json: a missing hash
// renders a labelled placeholder card, never an invented row, and a set hash renders the tx as text with a Basescan
// link card, from the receipt the capture reads. The fixture is the receipt of the vault's first mainnet Decision.

const lf = (rel: string) => readRepo(rel).replace(/\r\n/g, "\n");
const fixture = JSON.parse(readFileSync(join(REPO_ROOT, "web/test/fixtures/film-tx-decision.json"), "utf8")) as {
  receipt: { transactionHash: string; blockNumber: string; logs: { topics: string[]; data: string; logIndex: string }[] };
  block: { number: string; timestamp: string };
};
type TxEntry = { label: string; hash: string | null; expect: { event: string; reason?: string; etDate?: string } };
const config = readTxConfig(REPO_ROOT) as { txs: Record<string, TxEntry> };
const ctx = {
  tokens: tokenSymbols(addresses),
  contracts: Object.fromEntries(deploymentRows(lf("deployments/README.md")).map((r) => [r.address.toLowerCase(), r.contract])),
};
const HASH = "0xdfdb6739912a73542d90129bd7269a939dc8b2d47a869f56d9ab5e3a02e86c3b";
const ownerDecision = { label: "The vault's first mainnet Decision", hash: HASH, expect: { event: "Decision", reason: "MARKET_CLOSED", etDate: "2026-11-24" } };

describe("film/txs.json", () => {
  it("has one entry for each transaction beats 5 to 7 show, and no other", () => {
    expect(Object.keys(config.txs).sort()).toEqual(txKeys().map((t) => t.key).sort());
  });

  it("holds either no hash yet or a 32-byte tx hash, with a label and what the receipt must show", () => {
    for (const [key, entry] of Object.entries(config.txs)) {
      expect(entry.hash === null || /^0x[0-9a-fA-F]{64}$/.test(entry.hash), key).toBe(true);
      expect(entry.label.length, key).toBeGreaterThan(0);
      expect(["Decision", "Brief"], key).toContain(entry.expect.event);
    }
  });

  it("expects Thanksgiving on the calendar's Thanksgiving and the early-close pair on its early close day", () => {
    const holiday = FACTS.calendar.value.holidays.find((h) => h.date === config.txs.thanksgiving?.expect.etDate);
    expect(holiday?.name).toBe("Thanksgiving");
    for (const key of ["earlyCloseAllowed", "earlyCloseRefused"]) {
      expect(FACTS.calendar.value.earlyCloses.map((e) => e.date)).toContain(config.txs[key]?.expect.etDate);
    }
    expect(config.txs.earlyCloseAllowed?.expect.reason).toBe("OK");
    expect(config.txs.earlyCloseRefused?.expect.reason).toBe("MARKET_CLOSED");
    expect(config.txs.thanksgiving?.expect.reason).toBe("MARKET_CLOSED");
  });
});

describe("a tx with no hash yet", () => {
  const model = txCardModel("thanksgiving", { ...ownerDecision, hash: null }, undefined, ctx);

  it("is a placeholder, labelled as one", () => {
    expect(model.kind).toBe("placeholder");
    const html = txCardHtml([model], { format: "wide", title: "Thanksgiving" });
    expect(html).toContain("PLACEHOLDER");
    expect(html).toContain("The vault&#39;s first mainnet Decision");
    expect(html).toContain("not on Base yet");
  });

  it("shows no hash, no block and no Basescan link", () => {
    const html = txCardHtml([model], { format: "tall", title: "Thanksgiving" });
    expect(html).not.toMatch(/0x[0-9a-f]{8}/i);
    expect(html).not.toContain("basescan.org/tx");
    expect(html).not.toMatch(/\d{2},\d{3},\d{3}/);
  });
});

describe("a tx whose hash is set (the vault's first mainnet Decision)", () => {
  const model = txCardModel("thanksgiving", ownerDecision, fixture, ctx);

  it("is the real mainnet tx the site's facts record", () => {
    const recorded = FACTS.mainnetDecisions.value[0];
    const log = fixture.receipt.logs.find((l) => l.topics[0] === DECISION_TOPIC);
    expect(recorded?.transactionHash).toBe(HASH);
    expect(fixture.receipt.transactionHash).toBe(HASH);
    expect(log?.topics).toEqual(recorded?.topics);
    expect(log?.data).toBe(recorded?.data);
    expect(Number(fixture.receipt.blockNumber)).toBe(Number(recorded?.blockNumber));
    expect(Number(fixture.block.timestamp)).toBe(recorded?.blockTime);
  });

  it("renders the tx as text: hash, block, time, sender, vault, intent and verdict", () => {
    expect(model.kind).toBe("tx");
    if (model.kind !== "tx") return;
    const rows = Object.fromEntries((model.rows ?? []).map((r) => [r.k, r.v]));
    expect(rows).toMatchObject({
      Transaction: HASH,
      Block: "61,700,601",
      Time: etLabel(Number(fixture.block.timestamp)) + " ET",
      To: "MandateVault",
      Intent: "BUY NVDAc · $5.00",
      Verdict: "Refused · Market closed (MARKET_CLOSED)",
    });
    expect(rows.From).toBe("0x3c3a…1d6a");
    expect(txProblems(model, ownerDecision.expect)).toEqual([]);
  });

  it("puts the hash in the card's text and a Basescan link card beside it", () => {
    const html = txCardHtml([model], { format: "wide", title: "Thanksgiving" });
    expect(html).toContain(HASH);
    expect(html).toContain(`basescan.org/tx/${HASH}`);
    expect(html).toContain('class="link-card"');
    expect(html).not.toContain("PLACEHOLDER");
  });

  it("refuses to show it as a tx the receipt does not match", () => {
    expect(txProblems(model, { event: "Decision", reason: "MARKET_CLOSED", etDate: "2026-11-26" })).toEqual([
      "thanksgiving: the tx is on 2026-11-24 ET, not 2026-11-26",
    ]);
    expect(txProblems(model, { event: "Decision", reason: "OK" })).toEqual(["thanksgiving: the vault answered MARKET_CLOSED, not OK"]);
    expect(txProblems(model, { event: "Brief" })).toEqual(["thanksgiving: the receipt has no Brief event"]);
  });

  it("never makes up a row when the receipt could not be read", () => {
    expect(() => txCardModel("thanksgiving", ownerDecision, undefined, ctx)).toThrow(/no receipt/);
  });
});

describe("the decoder agrees with the contracts and the site", () => {
  it("uses the topic of the vault's Decision event in its compiled ABI, and of the inbox's Brief event in its source", () => {
    const decision = (abis.MandateVault as unknown as Abi).find((x): x is AbiEvent => x.type === "event" && x.name === "Decision");
    expect(decision && toEventSelector(decision)).toBe(DECISION_TOPIC);
    const line = /event Brief\([^)]*\)/.exec(readRepo("contracts/src/MaatInbox.sol"))?.[0] ?? "";
    expect(line).not.toBe("");
    expect(toEventSelector(parseAbiItem(line) as AbiEvent)).toBe(BRIEF_TOPIC);
  });

  it("names actions and reasons as Types.sol orders them, with the site's reason labels", () => {
    const types = readRepo("contracts/src/Types.sol");
    expect(ACTIONS).toEqual(enumMembers(types, "Action"));
    expect(REASON_CODES).toEqual(enumMembers(types, "Reason"));
    expect(REASON_CODES).toEqual(["OK", ...REASONS]);
    expect(REASON_LABELS).toEqual(REASON_LABEL);
  });

  it("decodes a Brief log's id, sender and text", () => {
    const text = "Buy 5 USD of NVDAc if the market is open";
    const hex = Buffer.from(text, "utf8").toString("hex");
    const words = (n: number) => n.toString(16).padStart(64, "0");
    const log = {
      topics: [BRIEF_TOPIC, `0x${words(7)}`, `0x${"0".repeat(24)}${"ab".repeat(20)}`],
      data: `0x${words(32)}${words(text.length)}${hex.padEnd(Math.ceil(hex.length / 64) * 64, "0")}`,
    };
    expect(decodeLog(log)).toEqual({ event: "Brief", id: 7n, from: `0x${"ab".repeat(20)}`, text });
  });

  it("dates a block time in New York time", () => {
    expect(etTime(Number(fixture.block.timestamp))).toEqual({ date: "2026-11-24", label: `${etLabel(Number(fixture.block.timestamp))} ET` });
  });
});
