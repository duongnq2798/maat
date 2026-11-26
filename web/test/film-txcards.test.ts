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
import { CAPTION_BAND, CAPTION_CLEARANCE, overlapProblem } from "../../film/lib/cards.mjs";
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
type TxEntry = {
  label: string;
  hash: string | null;
  expect: { event: string; contract?: string; reason?: string; etDate?: string; etBefore?: string; etFrom?: string };
};
const config = readTxConfig(REPO_ROOT) as { txs: Record<string, TxEntry> };
const mainnetRows = deploymentRows(lf("deployments/README.md")).filter((r) => r.network === "Base mainnet" && r.address);
const ctx = {
  tokens: tokenSymbols(addresses),
  contracts: Object.fromEntries(mainnetRows.map((r) => [r.address.toLowerCase(), r.contract])),
};
const HASH = "0xdfdb6739912a73542d90129bd7269a939dc8b2d47a869f56d9ab5e3a02e86c3b";
const ownerDecision = {
  label: "The vault's first mainnet Decision",
  hash: HASH,
  expect: { event: "Decision", contract: "MandateVault", reason: "MARKET_CLOSED", etDate: "2026-11-24" },
};
/** The fixture's receipt, with its block time moved to `iso` (a UTC instant) or its logs' emitter changed. */
const retimed = (iso: string) => ({ ...fixture, block: { ...fixture.block, timestamp: `0x${(Date.parse(iso) / 1000).toString(16)}` } });
const moved = (address: string) => ({ ...fixture, receipt: { ...fixture.receipt, logs: fixture.receipt.logs.map((l) => ({ ...l, address })) } });
const word = (n: number) => n.toString(16).padStart(64, "0");
/** A Brief log as MaatInbox emits it: id 7, from 0xabab…abab, with `text`. */
const briefLog = (text: string, address: string) => {
  const hex = Buffer.from(text, "utf8").toString("hex");
  return {
    address,
    topics: [BRIEF_TOPIC, `0x${word(7)}`, `0x${"0".repeat(24)}${"ab".repeat(20)}`],
    data: `0x${word(32)}${word(Buffer.byteLength(text))}${hex.padEnd(Math.ceil(hex.length / 64) * 64, "0")}`,
    logIndex: "0x0",
  };
};
/** "13:00" for 780 minutes after midnight. */
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

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

  it("expects each Decision from the vault and each Brief from the inbox", () => {
    for (const [key, entry] of Object.entries(config.txs)) {
      expect(entry.expect.contract, key).toBe(entry.expect.event === "Decision" ? "MandateVault" : "MaatInbox");
    }
    expect(mainnetRows.map((r) => r.contract)).toContain("MandateVault");
  });

  it("expects Thanksgiving on the calendar's Thanksgiving and the early-close pair either side of its early close", () => {
    const holiday = FACTS.calendar.value.holidays.find((h) => h.date === config.txs.thanksgiving?.expect.etDate);
    expect(holiday?.name).toBe("Thanksgiving");
    const allowed = config.txs.earlyCloseAllowed?.expect;
    const refused = config.txs.earlyCloseRefused?.expect;
    const early = FACTS.calendar.value.earlyCloses.find((e) => e.date === allowed?.etDate);
    expect(early).toBeDefined();
    expect(refused?.etDate).toBe(allowed?.etDate);
    expect(allowed?.etBefore).toBe(hhmm(early?.closeMin ?? -1));
    expect(refused?.etFrom).toBe(hhmm(early?.closeMin ?? -1));
    expect(allowed?.reason).toBe("OK");
    expect(refused?.reason).toBe("MARKET_CLOSED");
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

  it("renders the tx as text: hash, block and time, sender and vault, intent and verdict", () => {
    expect(model.kind).toBe("tx");
    if (model.kind !== "tx") return;
    expect((model.rows ?? []).map((r) => [r.k, r.v])).toEqual([
      ["Transaction", HASH],
      ["Block", `61,700,601 · ${etLabel(Number(fixture.block.timestamp))} ET`],
      ["From", "0x3c3a…1d6a to MandateVault"],
      ["Intent", "BUY NVDAc · $5.00"],
      ["Verdict", "Refused · Market closed (MARKET_CLOSED)"],
    ]);
    expect(txProblems(model, ownerDecision.expect, ctx.contracts)).toEqual([]);
  });

  it("puts the hash in the card's text and a Basescan link card beside it", () => {
    const html = txCardHtml([model], { format: "wide", title: "Thanksgiving" });
    expect(html).toContain(HASH);
    expect(html).toContain(`basescan.org/tx/${HASH}`);
    expect(html).toContain('class="link-card"');
    expect(html).not.toContain("PLACEHOLDER");
  });

  it("refuses to show it as a tx the receipt does not match", () => {
    expect(txProblems(model, { event: "Decision", reason: "MARKET_CLOSED", etDate: "2026-11-26" }, ctx.contracts)).toEqual([
      "thanksgiving: the tx is on 2026-11-24 ET, not 2026-11-26",
    ]);
    expect(txProblems(model, { event: "Decision", reason: "OK" }, ctx.contracts)).toEqual(["thanksgiving: the vault answered MARKET_CLOSED, not OK"]);
    expect(txProblems(model, { event: "Brief" }, ctx.contracts)).toEqual(["thanksgiving: the receipt has no Brief event"]);
  });

  it("checks the time of day against the early close: a pre-open refusal on Fri 27 Nov is not the one after the close", () => {
    const { earlyCloseAllowed, earlyCloseRefused } = config.txs;
    if (!earlyCloseAllowed || !earlyCloseRefused) throw new Error("txs.json lost the early-close pair");
    // 14:00 UTC is 09:00 ET on Fri 27 Nov: before the open, so neither side of the 13:00 early close it claims.
    const beforeOpen = txCardModel("earlyCloseRefused", { ...earlyCloseRefused, hash: HASH }, retimed("2026-11-27T14:00:00Z"), ctx);
    expect(txProblems(beforeOpen, earlyCloseRefused.expect, ctx.contracts)).toEqual(["earlyCloseRefused: the tx is at 09:00 ET, before 13:00"]);
    // 18:30 UTC is 13:30 ET: after the early close.
    const afterClose = txCardModel("earlyCloseRefused", { ...earlyCloseRefused, hash: HASH }, retimed("2026-11-27T18:30:00Z"), ctx);
    expect(txProblems(afterClose, earlyCloseRefused.expect, ctx.contracts)).toEqual([]);
    const asAllowed = txCardModel("earlyCloseAllowed", { ...earlyCloseAllowed, hash: HASH }, retimed("2026-11-27T18:30:00Z"), ctx);
    expect(txProblems(asAllowed, earlyCloseAllowed.expect, ctx.contracts)).toEqual([
      "earlyCloseAllowed: the vault answered MARKET_CLOSED, not OK",
      "earlyCloseAllowed: the tx is at 13:30 ET, not before 13:00",
    ]);
  });

  it("refuses a Decision that the vault of deployments/README.md did not emit", () => {
    const spoof = txCardModel("thanksgiving", ownerDecision, moved(`0x${"be".repeat(20)}`), ctx);
    expect(txProblems(spoof, ownerDecision.expect, ctx.contracts)).toEqual([
      "thanksgiving: its Decision event comes from 0xbebe…bebe, not the MandateVault of deployments/README.md",
    ]);
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

  it("decodes a Brief log's emitter, id, sender and text", () => {
    const text = "Buy 5 USD of NVDAc if the market is open";
    const log = briefLog(text, `0x${"CD".repeat(20)}`);
    expect(decodeLog(log)).toEqual({ event: "Brief", address: `0x${"cd".repeat(20)}`, id: 7n, from: `0x${"ab".repeat(20)}`, text });
  });

  it("refuses a Brief until its emitter is the MaatInbox row of deployments/README.md", () => {
    const entry = { label: "An outside wallet's brief", hash: HASH, expect: { event: "Brief", contract: "MaatInbox" } };
    const inbox = `0x${"cd".repeat(20)}`;
    const data = { ...fixture, receipt: { ...fixture.receipt, to: inbox, logs: [briefLog("hello", inbox)] } };
    const model = txCardModel("strangerBrief", entry, data, ctx);
    expect(txProblems(model, entry.expect, ctx.contracts)).toEqual([
      "strangerBrief: its Brief event comes from 0xcdcd…cdcd, not the MaatInbox of deployments/README.md",
    ]);
    expect(txProblems(model, entry.expect, { ...ctx.contracts, [inbox]: "MaatInbox" })).toEqual([]);
  });

  it("dates a block time in New York time", () => {
    expect(etTime(Number(fixture.block.timestamp))).toEqual({
      date: "2026-11-24",
      time: "09:28",
      label: `${etLabel(Number(fixture.block.timestamp))} ET`,
    });
    expect(etLabel(Number(fixture.block.timestamp))).toContain("09:28");
  });
});

describe("the tx card's layout", () => {
  it("keeps its content above the band the caption takes, in both cuts", () => {
    const model = txCardModel("thanksgiving", ownerDecision, fixture, ctx);
    for (const format of ["wide", "tall"] as const) {
      const html = txCardHtml([model, model], { format, title: "The early-close pair" });
      expect(html).toMatch(new RegExp(`\\.frame\\{padding:\\d+px \\d+px ${CAPTION_BAND[format]}px;justify-content:safe center`));
    }
  });

  it("names an overlap between a card's content and a caption box", () => {
    expect(overlapProblem("06-early-close-tx", 700, 700 + CAPTION_CLEARANCE)).toBeNull();
    expect(overlapProblem("06-early-close-tx", 943.4, 876)).toBe(
      `06-early-close-tx: the card's content ends at 943 px and the caption box starts at 876 px; they need ${CAPTION_CLEARANCE} px between them`,
    );
  });
});
