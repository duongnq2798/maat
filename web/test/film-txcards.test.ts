// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAbiItem, toEventSelector, type Abi, type AbiEvent } from "viem";
import { describe, expect, it } from "vitest";
import abis from "@/content/generated/abi.json";
import addresses from "@/content/generated/base-addresses.json";
import { FACTS } from "@/content/facts";
import { REASON_LABEL, REASONS } from "@/content/reasons";
import { etLabel, senderLabel as siteSenderLabel } from "@/lib/chain/ledger";
import { decodeExecuteInput } from "@/lib/chain/rationale";
import { txKeys } from "../../film/lib/beats.mjs";
import { CAPTION_BAND, CAPTION_CLEARANCE, overlapProblem } from "../../film/lib/cards.mjs";
import { deploymentRows } from "../../film/lib/sources.mjs";
import {
  ACTIONS,
  BRIEF_TOPIC,
  DECISION_TOPIC,
  REASON_CODES,
  REASON_LABELS,
  SENDERS,
  decodeLog,
  etTime,
  readTxConfig,
  senderLabel,
  tokenSymbols,
  txCardHtml,
  txCardModel,
  txProblems,
  txSender,
} from "../../film/lib/tx.mjs";
import { CONTRACTS, EXECUTOR, INBOX, OWNER, STRANGER, briefData, verdict } from "./helpers/film-persuasion";
import { VECTORS } from "./helpers/maat-v1";
import { REPO_ROOT, enumMembers, readRepo } from "./helpers/solidity";

// Beats 5 to 7 show transactions by hash, from film/txs.json: a missing hash renders a labelled placeholder card, never
// an invented row, and a set hash renders the tx as text with a Basescan link card, from the receipt the capture reads,
// once it shows what the entry expects, its sender included. The fixture is the receipt of the vault's first mainnet
// Decision.

const lf = (rel: string) => readRepo(rel).replace(/\r\n/g, "\n");
const fixture = JSON.parse(readFileSync(join(REPO_ROOT, "web/test/fixtures/film-tx-decision.json"), "utf8")) as {
  receipt: { transactionHash: string; blockNumber: string; logs: { topics: string[]; data: string; logIndex: string }[] };
  block: { number: string; timestamp: string };
};
type TxEntry = {
  label: string;
  hash: string | null;
  expect: { event: string; contract?: string; reason?: string; sender?: string; etDate?: string; etBefore?: string; etFrom?: string };
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
      expect(SENDERS[entry.expect.event as keyof typeof SENDERS], key).toContain(entry.expect.sender);
    }
  });

  it("names who sent each tx: Maat's agent on Thanksgiving, probes for the early-close pair, an outside wallet's brief and the agent's brief-driven answer", () => {
    expect(Object.fromEntries(Object.entries(config.txs).map(([key, entry]) => [key, entry.expect.sender]))).toEqual({
      thanksgiving: "agent",
      earlyCloseAllowed: "probe",
      earlyCloseRefused: "probe",
      strangerBrief: "outside",
      vaultAnswer: "brief-driven",
    });
    expect(config.txs.earlyCloseAllowed?.label).toMatch(/^Probe /);
    expect(config.txs.earlyCloseRefused?.label).toMatch(/^Probe /);
  });

  it("refuses an entry that does not say who must have sent its tx", () => {
    const dir = mkdtempSync(join(tmpdir(), "film-txs-"));
    mkdirSync(join(dir, "film"));
    const write = (expect: Record<string, string>) =>
      writeFileSync(join(dir, "film/txs.json"), JSON.stringify({ txs: { thanksgiving: { label: "x", hash: null, expect } } }));
    write({ event: "Decision", contract: "MandateVault" });
    expect(() => readTxConfig(dir)).toThrow(/thanksgiving: expect\.sender must be one of "agent", "probe", "brief-driven", "owner, by hand"/);
    write({ event: "Brief", contract: "MaatInbox", sender: "agent" });
    expect(() => readTxConfig(dir)).toThrow(/expect\.sender must be one of "outside", "team"/);
    write({ event: "Decision", contract: "MandateVault", sender: "agent" });
    expect(() => readTxConfig(dir)).not.toThrow();
  });

  it("shows Maat's agent's Thanksgiving Decision, which is on Base (block 62,776,552)", () => {
    expect(config.txs.thanksgiving?.hash).toBe("0xca9e2dfe58cea6dc033292a1733a64658e702c3de25627ee7af136d42a38bed6");
    expect(config.txs.thanksgiving?.label).toBe("Maat's agent's intent on Thanksgiving");
    expect(config.txs.thanksgiving?.expect).toEqual({ event: "Decision", contract: "MandateVault", reason: "MARKET_CLOSED", sender: "agent", etDate: "2026-11-26" });
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
    // A shipped cut prints no repository instruction.
    expect(html).not.toContain("film/txs.json");
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
    // The fixture is the owner's Decision, not a probe: this checks the time only (the sender is checked below).
    const timeOnly = (entry: TxEntry) => ({ ...entry, expect: { ...entry.expect, sender: undefined } });
    // 14:00 UTC is 09:00 ET on Fri 27 Nov: before the open, so neither side of the 13:00 early close it claims.
    const beforeOpen = txCardModel("earlyCloseRefused", { ...earlyCloseRefused, hash: HASH }, retimed("2026-11-27T14:00:00Z"), ctx);
    expect(txProblems(beforeOpen, timeOnly(earlyCloseRefused).expect, ctx.contracts)).toEqual(["earlyCloseRefused: the tx is at 09:00 ET, before 13:00"]);
    // 18:30 UTC is 13:30 ET: after the early close.
    const afterClose = txCardModel("earlyCloseRefused", { ...earlyCloseRefused, hash: HASH }, retimed("2026-11-27T18:30:00Z"), ctx);
    expect(txProblems(afterClose, timeOnly(earlyCloseRefused).expect, ctx.contracts)).toEqual([]);
    const asAllowed = txCardModel("earlyCloseAllowed", { ...earlyCloseAllowed, hash: HASH }, retimed("2026-11-27T18:30:00Z"), ctx);
    expect(txProblems(asAllowed, timeOnly(earlyCloseAllowed).expect, ctx.contracts)).toEqual([
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

describe("who sent a tx", () => {
  const who = (input: string) => ({ input, owner: OWNER, team: [] as string[] });
  /** The vault's Decision sent by `from` with `blob`, as an entry that expects `sender`. */
  const decisionBy = (blob: string, sender: string, from = EXECUTOR) => {
    const v = verdict({ blob, from });
    const entry = { label: "x", hash: v.data.receipt.transactionHash, expect: { event: "Decision", contract: "MandateVault", sender } };
    return { model: txCardModel("thanksgiving", entry, v.data, { tokens: {}, contracts: CONTRACTS }), entry, input: v.input };
  };

  it("labels a Decision as /ledger does", () => {
    for (const [blob, from] of [
      [VECTORS.V1.blob, EXECUTOR],
      [VECTORS.V4.blob, EXECUTOR],
      [VECTORS.V5.blob, EXECUTOR],
      [VECTORS.V1.blob, OWNER],
      ["", EXECUTOR],
    ] as const) {
      const call = decodeExecuteInput(verdict({ blob, from }).input);
      expect(call).not.toBeNull();
      if (!call) continue;
      expect(senderLabel(from, OWNER, call.blob)).toBe(siteSenderLabel(from as `0x${string}`, OWNER as `0x${string}`, call.blob));
    }
  });

  it("takes Maat's agent's own intent as agent, a probe as probe and an adopted brief as brief-driven", () => {
    for (const [blob, label] of [
      [VECTORS.V1.blob, "agent"],
      [VECTORS.V4.blob, "probe"],
      [VECTORS.V5.blob, "brief-driven"],
    ] as const) {
      const { model, entry, input } = decisionBy(blob, label);
      expect(txSender(model, model.events[0], who(input))).toEqual({ label });
      expect(txProblems(model, entry.expect, CONTRACTS, who(input))).toEqual([]);
    }
  });

  it("never shows a probe as Claude's intent, or Maat's agent's own intent as a probe", () => {
    const probe = decisionBy(VECTORS.V4.blob, "agent");
    expect(txProblems(probe.model, probe.entry.expect, CONTRACTS, who(probe.input))).toEqual(['thanksgiving: it was sent as "probe", not "agent"']);
    const own = decisionBy(VECTORS.V1.blob, "probe");
    expect(txProblems(own.model, own.entry.expect, CONTRACTS, who(own.input))).toEqual(['thanksgiving: it was sent as "agent", not "probe"']);
    const byHand = decisionBy(VECTORS.V1.blob, "agent", OWNER);
    expect(txProblems(byHand.model, byHand.entry.expect, CONTRACTS, who(byHand.input))).toEqual(['thanksgiving: it was sent as "owner, by hand", not "agent"']);
  });

  it("stops when it cannot say who sent it: no calldata or owner read, no blob the vault recorded, or no direct call", () => {
    const { model, entry } = decisionBy(VECTORS.V1.blob, "agent");
    expect(txProblems(model, entry.expect, CONTRACTS)).toEqual(["thanksgiving: the vault's owner() was not read, so the film cannot say who sent it"]);
    expect(txProblems(model, entry.expect, CONTRACTS, { owner: OWNER })).toEqual(["thanksgiving: its calldata was not read, so the film cannot say who sent it"]);
    const noBlob = decisionBy("", "agent");
    expect(txProblems(noBlob.model, noBlob.entry.expect, CONTRACTS, who(noBlob.input)).join("\n")).toMatch(/no maat:v1 blob that hashes to the Decision's rationaleHash \(none\)/);
    const unrecorded = verdict({ blob: VECTORS.V1.blob, rationaleHash: VECTORS.V5.hash });
    const m = txCardModel("thanksgiving", entry, unrecorded.data, { tokens: {}, contracts: CONTRACTS });
    expect(txProblems(m, entry.expect, CONTRACTS, who(unrecorded.input)).join("\n")).toMatch(/no maat:v1 blob that hashes to the Decision's rationaleHash \(v1\)/);
    const indirect = verdict({ blob: VECTORS.V1.blob, to: `0x${"ee".repeat(20)}` });
    const im = txCardModel("thanksgiving", entry, indirect.data, { tokens: {}, contracts: CONTRACTS });
    expect(txProblems(im, entry.expect, { ...CONTRACTS, [`0x${"ee".repeat(20)}`]: "Router" }, who(indirect.input)).join("\n")).toMatch(/not a direct execute call to MandateVault/);
  });

  it("takes a brief from a team wallet or the vault's owner as team, and any other as outside", () => {
    const entry = { label: "An outside wallet's brief", hash: `0x${"12".repeat(32)}`, expect: { event: "Brief", contract: "MaatInbox", sender: "outside" } };
    const brief = (from: string) => txCardModel("strangerBrief", entry, briefData("hello", { from }), { tokens: {}, contracts: CONTRACTS });
    const team = [`0x${"77".repeat(20)}`];
    expect(txProblems(brief(STRANGER), entry.expect, CONTRACTS, { owner: OWNER, team })).toEqual([]);
    expect(txProblems(brief(team[0]!), entry.expect, CONTRACTS, { owner: OWNER, team })).toEqual(['strangerBrief: it was sent as "team", not "outside"']);
    expect(txProblems(brief(OWNER), entry.expect, CONTRACTS, { owner: OWNER, team })).toEqual(['strangerBrief: it was sent as "team", not "outside"']);
    expect(CONTRACTS[INBOX]).toBe("MaatInbox");
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

  it("decodes a Brief log's emitter, id, sender, text and log index (which the journal names a brief by)", () => {
    const text = "Buy 5 USD of NVDAc if the market is open";
    const log = briefLog(text, `0x${"CD".repeat(20)}`);
    expect(decodeLog(log)).toEqual({ event: "Brief", address: `0x${"cd".repeat(20)}`, id: 7n, from: `0x${"ab".repeat(20)}`, text, logIndex: 0 });
    expect(decodeLog({ ...log, logIndex: "0x1a" })).toMatchObject({ logIndex: 26 });
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
