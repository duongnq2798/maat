// @vitest-environment node
import { keccak256, toBytes, type Hash } from "viem";
import { describe, expect, it } from "vitest";
import snapshot from "@/content/generated/decisions-snapshot.json";
import { CHECK_LABELS } from "@/content/engine";
import { REASON_RAISED_AT, REASONS, type ReasonCode } from "@/content/reasons";
import { decodeVaultLogs } from "@/lib/chain/events";
import {
  BAND_TEXT,
  balanceTicks,
  cardModel,
  clip,
  dateLine,
  excerpt,
  FOOTER,
  HIDDEN_BRIEF_TEXT,
  HIDDEN_REPLY,
  NO_BRIEF_TEXT,
  NO_REPLY,
  ordinalOf,
  SIGN_OFF,
  TICK_CHECK,
  timeLine,
} from "@/lib/card/model";
import { parseCardFile } from "@/lib/card/read";
import { AGENT, cardCase, fixtureJson, OTHER_PAYEE, OWNER, usdcTransfer } from "./helpers/card";
import { VECTORS } from "./helpers/maat-v1";

const ts = (iso: string) => Date.parse(iso) / 1000;
const TX1 = "0xdfdb6739912a73542d90129bd7269a939dc8b2d47a869f56d9ab5e3a02e86c3b";
const TX2 = "0x61622340a151c73c3f2b3bc910292a3e3136bd4aa7ecd55a92f59914953a23c8";
/** The first Decision of Maat's agent, 2026-11-27. */
const TX3 = "0xca9e2dfe58cea6dc033292a1733a64658e702c3de25627ee7af136d42a38bed6";

describe("the Balance's ticks", () => {
  it("light up to the check a code maps to: passed before it, failed at it, not reached after", () => {
    expect(balanceTicks("BUY", "MARKET_CLOSED")).toEqual(["PASS", "PASS", "PASS", "FAIL", "SKIP", "SKIP", "SKIP", "SKIP", "SKIP"]);
    expect(balanceTicks("BUY", "TOKEN_NOT_ALLOWED")).toEqual(["FAIL", ...Array(8).fill("SKIP")]);
    expect(balanceTicks("BUY", "CONCENTRATION")).toEqual([...Array(8).fill("PASS"), "FAIL"]);
    expect(balanceTicks("SELL", "SIZE_LIMIT")).toEqual([...Array(7).fill("PASS"), "FAIL", "SKIP"]);
  });

  it("map each code to the check of the same name", () => {
    const label = (code: keyof typeof TICK_CHECK) => CHECK_LABELS[TICK_CHECK[code]!];
    expect(label("TOKEN_NOT_ALLOWED")).toBe("Token allowed");
    expect(label("TOKEN_PAUSED")).toBe("Token not paused");
    expect(label("POLICY_BLOCKED")).toBe("Vault policy");
    expect(label("MARKET_CLOSED")).toBe("Market session");
    expect(label("FEED_STALE")).toBe("Feed freshness");
    expect(label("MULTIPLIER_COOLDOWN")).toBe("Multiplier stable");
    expect(label("PREMIUM_TOO_HIGH")).toBe("DEX premium");
    expect(label("SIZE_LIMIT")).toBe("Size limits");
    expect(label("CONCENTRATION")).toBe("Concentration");
    expect(Object.keys(TICK_CHECK)).toHaveLength(CHECK_LABELS.length);
  });

  it("light none when the code does not name exactly one of the nine checks", () => {
    const none = Array(9).fill("SKIP");
    // BAD_PRICE is returned at two of the nine (the feed read and the pool read), as GuardLib.checkMarket shows.
    expect(REASON_RAISED_AT.BAD_PRICE.filter((s) => s.fn === "GuardLib.checkMarket")).toHaveLength(2);
    const unmapped = REASONS.filter((r) => !(r in TICK_CHECK));
    expect(unmapped).toEqual(expect.arrayContaining(["BAD_PRICE", "INSUFFICIENT_BALANCE", "VAULT_PAUSED", "SWAP_FAILED", "TRANSFER_FAILED"]));
    for (const code of [...unmapped, "OK"] as ReasonCode[]) expect(balanceTicks("BUY", code), code).toEqual(none);
  });

  it("light none for an action that does not run the nine checks", () => {
    expect(balanceTicks("PAY_EXPENSE", "SIZE_LIMIT")).toEqual(Array(9).fill("SKIP"));
    expect(balanceTicks("SUPPLY", "TOKEN_NOT_ALLOWED")).toEqual(Array(9).fill("SKIP"));
    expect(balanceTicks("BORROW", "MARKET_CLOSED")).toEqual(Array(9).fill("SKIP"));
  });
});

describe("Weighing № N", () => {
  const positions = decodeVaultLogs(snapshot.logs as never)
    .filter((e) => e.name === "Decision")
    .map((e) => ({ blockNumber: e.blockNumber, logIndex: e.logIndex, tx: e.txHash }));

  it("numbers the two operator Decisions of 24 Nov 1 and 2 and the agent's first 3, from the committed decisions snapshot", () => {
    // A later snapshot may hold later Decisions too; the first three never change.
    expect(positions.slice(0, 3).map((p) => p.tx)).toEqual([TX1, TX2, TX3]);
    expect(ordinalOf(positions, positions[0]!)).toBe(1);
    expect(ordinalOf(positions, positions[1]!)).toBe(2);
    expect(ordinalOf(positions, positions[2]!)).toBe(3);
  });

  it("counts in chain order: block, then log index", () => {
    const logs = [
      { blockNumber: 10n, logIndex: 9 },
      { blockNumber: 12n, logIndex: 1 },
      { blockNumber: 10n, logIndex: 3 },
      { blockNumber: 12n, logIndex: 0 },
    ];
    expect(ordinalOf(logs, { blockNumber: 10n, logIndex: 3 })).toBe(1);
    expect(ordinalOf(logs, { blockNumber: 10n, logIndex: 9 })).toBe(2);
    expect(ordinalOf(logs, { blockNumber: 12n, logIndex: 0 })).toBe(3);
    expect(ordinalOf(logs, { blockNumber: 12n, logIndex: 1 })).toBe(4);
  });

  it("refuses to number a Decision that is not among the logs, or is there twice", () => {
    expect(() => ordinalOf([{ blockNumber: 1n, logIndex: 0 }], { blockNumber: 2n, logIndex: 0 })).toThrow(/not among/);
    expect(() => ordinalOf([{ blockNumber: 1n, logIndex: 0 }, { blockNumber: 1n, logIndex: 0 }], { blockNumber: 1n, logIndex: 0 })).toThrow(/repeated/);
  });
});

describe("the ET date line and the session state", () => {
  it("names the day and its NYSE session from the calendar port", () => {
    expect(dateLine(ts("2026-11-27T14:45:00Z"))).toBe("Fri 27 Nov · early close 13:00 ET");
    expect(dateLine(ts("2026-11-26T15:00:00Z"))).toBe("Thu 26 Nov · Thanksgiving, NYSE closed");
    expect(dateLine(ts("2026-11-28T15:00:00Z"))).toBe("Sat 28 Nov · weekend, NYSE closed");
    expect(dateLine(ts("2026-11-24T14:28:15Z"))).toBe("Tue 24 Nov · NYSE open 09:30-16:00 ET");
  });

  it("places the block's time in that session", () => {
    expect(timeLine(ts("2026-11-24T14:28:15Z"))).toBe("09:28 ET · before the 09:30 open");
    expect(timeLine(ts("2026-11-24T16:59:02Z"))).toBe("11:59 ET · NYSE open");
    expect(timeLine(ts("2026-11-27T18:30:00Z"))).toBe("13:30 ET · after the 13:00 close");
    expect(timeLine(ts("2026-11-26T15:00:00Z"))).toBe("10:00 ET · NYSE closed");
    expect(timeLine(ts("2026-11-29T01:00:00Z"))).toBe("20:00 ET · NYSE closed");
  });
});

describe("the rationale excerpt", () => {
  it("keeps a text that fits as it is", () => {
    expect(excerpt("Buy 5 USD of NVDAc.", 40)).toBe("Buy 5 USD of NVDAc.");
  });

  it("keeps the agent's own disclosure of an expected refusal whole, and the closed-market note", () => {
    const text =
      "NVDAc is 4 points under its target weight. The feed is fresh and the pool is close to it. " +
      "Two more sentences of context that a card has no room for. And one more. " +
      "NYSE is closed, so I expect the vault to refuse this; the refusal is worth recording. (market closed, weekend)";
    const out = excerpt(text, 160);
    expect(out).toContain("NYSE is closed, so I expect the vault to refuse this; the refusal is worth recording.");
    expect(out.startsWith("NVDAc is 4 points under its target weight.")).toBe(true);
    expect(out.endsWith(" (market closed, weekend)")).toBe(true);
    expect(out).toContain(" … ");
    expect(out).not.toContain("Two more sentences");
  });

  it("never runs past its budget, however many sentences disclose a refusal", () => {
    const s = [
      "I expect the vault to refuse this buy because the NYSE session for NVDA has not opened yet.",
      "If it is refused, the refusal itself is the record I want.",
      "A second refusal later would confirm the check holds through the morning and is not a one-off reading of the clock.",
      "I am proposing it so that the refusal is on the record and anyone can read the reason code next to the hash.",
    ];
    const text = `${s.join(" ")} (market closed, before the open)`;
    for (const budget of [40, 60, 150, 200, 300]) expect(excerpt(text, budget).length, `budget ${budget}`).toBeLessThanOrEqual(budget);
    const out = excerpt(text, 200);
    expect(out).toBe(`${s[0]} ${s[1]} … (market closed, before the open)`);
  });

  it("cuts a disclosure that alone is longer than its budget, keeping the words that say refuse", () => {
    const early = "I propose this knowing the vault will refuse it, because the market is closed and a refusal on the record is the point.";
    const head = excerpt(`First, some context about weights. ${early}`, 60);
    expect(head).toBe("… I propose this knowing the vault will refuse it, because…");
    const late =
      "Because the calendar for Thanksgiving week shows the session closed on Thursday and short on Friday, and the vault reads that calendar onchain at every execute, I expect it to refuse this buy.";
    const tail = excerpt(late, 80);
    expect(tail.length).toBeLessThanOrEqual(80);
    expect(tail).toBe("…reads that calendar onchain at every execute, I expect it to refuse this buy.");
    const middle = excerpt(`${"Some context. ".repeat(3)}${late.replace("I expect it to refuse this buy.", "I expect it to refuse this buy, and a refusal on the record is the point of the whole exercise today.")}`, 60);
    expect(middle.length).toBeLessThanOrEqual(60);
    expect(middle).toMatch(/refuse/);
  });

  it("cuts a long text with no disclosure on a space, sentence by sentence", () => {
    const out = excerpt("One short sentence. Then a second sentence that is somewhat longer. And a third.", 50);
    expect(out).toBe("One short sentence. …");
    const long = excerpt("word ".repeat(40).trim(), 30);
    expect(long.length).toBeLessThanOrEqual(30);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("the cut of a brief or a reply", () => {
  it("keeps a text that fits, and cuts a longer one on a space within the budget, refusal or not", () => {
    expect(clip("Buy NVDAc now.", 40)).toBe("Buy NVDAc now.");
    const reply = "I will not predict prices. The mandate decides; the vault will refuse outside the session, so this stays a record.";
    const out = clip(reply, 60);
    expect(out).toBe("I will not predict prices. The mandate decides; the vault…");
    expect(out.length).toBeLessThanOrEqual(60);
  });

  it("cuts a text with no space at the budget", () => {
    const out = clip("W".repeat(280), 110);
    expect(out).toBe(`${"W".repeat(109)}…`);
  });
});

describe("the card of a recorded mainnet Decision", () => {
  it("draws Weighing № 1, the operator's refused BUY of 24 Nov", () => {
    const m = cardModel(parseCardFile(fixtureJson("weighing-card-1.json")));
    expect(m).toMatchObject({
      kind: "mainnet",
      band: null,
      title: "Weighing № 1",
      dateLine: "Tue 24 Nov · NYSE open 09:30-16:00 ET",
      timeLine: "09:28 ET · before the 09:30 open",
      plate: "refused",
      headline: "MARKET_CLOSED",
      verdict: "Refused · Market closed (MARKET_CLOSED)",
      intent: "BUY · NVDAc · $5.00",
      bill: null,
      sender: "owner, by hand",
      rationale: { state: "none", status: "no rationale in this tx" },
      rationaleHash: "0x0baa4c52…57f6",
      block: "block 61,700,601",
      tx: "tx 0xdfdb6739…6c3b",
      footer: FOOTER,
      signOff: SIGN_OFF,
      stem: "weighing-1-dfdb6739",
    });
    expect(m.balance).toEqual({ verdict: "refused", ticks: ["PASS", "PASS", "PASS", "FAIL", "SKIP", "SKIP", "SKIP", "SKIP", "SKIP"] });
  });

  it("draws Weighing № 2, the operator's allowed BUY of 24 Nov, with no tick lit", () => {
    const m = cardModel(parseCardFile(fixtureJson("weighing-card-2.json")));
    expect(m).toMatchObject({
      title: "Weighing № 2",
      timeLine: "11:59 ET · NYSE open",
      plate: "allowed",
      headline: "Allowed",
      verdict: "Allowed · All checks passed (OK)",
      intent: "BUY · NVDAc · $5.00",
      sender: "owner, by hand",
      rationale: { state: "none", status: "no rationale in this tx" },
      block: "block 61,745,836",
      stem: "weighing-2-61622340",
    });
    expect(m.balance).toEqual({ verdict: "allowed", ticks: Array(9).fill("SKIP") });
  });

  it("carries the footer and the sign-off on every card", () => {
    for (const read of [cardCase(), cardCase({ kind: "fork" }), cardCase({ action: "PAY_EXPENSE", extraLogs: [usdcTransfer(OWNER, 1_000_000n)], amount: 1_000_000n })]) {
      const m = cardModel(read);
      expect([m.footer, m.signOff]).toEqual(["Own treasury only. Not offered to US persons.", "Every trade is weighed."]);
    }
  });
});

describe("the rationale check", () => {
  const blob = VECTORS.V1.blob;

  it("prints the text with hash verified only when keccak256 of the blob is the Decision's rationaleHash", () => {
    const m = cardModel(cardCase({ from: AGENT, blob }));
    expect(m.rationale).toEqual({
      state: "verified",
      status: "hash verified",
      text: "Fixture rationale: NVDAc is under its target weight and the feed is fresh, so buy 5 USD.",
      by: "Maat's agent · claude-sonnet-5-5",
    });
    expect(m.sender).toBe("agent");
  });

  it("shows no text when the hash does not match", () => {
    const m = cardModel(cardCase({ from: AGENT, blob, rationaleHash: keccak256(toBytes("another text")) }));
    expect(m.rationale).toEqual({ state: "mismatch", status: "hash mismatch: text not shown" });
  });

  it("says when the transaction carries no rationale", () => {
    expect(cardModel(cardCase({ from: AGENT })).rationale).toEqual({ state: "none", status: "no rationale in this tx" });
  });

  it("reads nothing from a transaction that is not a direct execute call, and labels no sender, as /ledger does", () => {
    const m = cardModel(cardCase({ from: AGENT, blob, to: "0x0000000000000000000000000000000000000Bad" }));
    expect(m.rationale.state).toBe("not-read");
    expect(m.sender).toBe("sender not labeled");
    expect(cardModel(cardCase({ from: AGENT, blob, owner: null })).sender).toBe("sender unknown");
  });

  it("keeps the closed-market note of a refusal the agent logged", () => {
    const m = cardModel(cardCase({ from: AGENT, blob: VECTORS.V6.blob, reason: "MARKET_CLOSED", timestamp: ts("2026-11-26T15:00:00Z") }));
    expect(m.rationale.state === "verified" && m.rationale.text.endsWith(" (market closed, NYSE holiday: Thanksgiving)")).toBe(true);
    expect(m.dateLine).toBe("Thu 26 Nov · Thanksgiving, NYSE closed");
  });
});

describe("the sender label, as /ledger's chip prints it", () => {
  it("labels the owner, an agent, a probe and a brief-driven Decision", () => {
    expect(cardModel(cardCase()).sender).toBe("owner, by hand");
    expect(cardModel(cardCase({ from: AGENT, blob: VECTORS.V1.blob })).sender).toBe("agent");
    const probe = cardModel(cardCase({ from: AGENT, blob: VECTORS.V4.blob }));
    expect(probe.sender).toBe("probe");
    expect(probe.rationale).toMatchObject({ state: "verified", by: "probe text, not a Claude proposal" });
    expect(cardModel(cardCase({ from: AGENT, blob: VECTORS.V5.blob })).sender).toBe("brief-driven");
  });

  it("never calls the owner's Decision the agent's, whatever its calldata carries", () => {
    const m = cardModel(cardCase({ from: OWNER, blob: VECTORS.V1.blob }));
    expect(m.sender).toBe("owner, by hand");
    // /ledger shows the blob's model as a plain fact here; only an agent or brief-driven Decision is Maat's agent's.
    expect(m.rationale).toMatchObject({ state: "verified", by: "model claude-sonnet-5-5" });
    const unknown = cardModel(cardCase({ from: AGENT, blob: VECTORS.V1.blob, owner: null }));
    expect([unknown.sender, unknown.rationale]).toEqual(["sender unknown", expect.objectContaining({ by: "model claude-sonnet-5-5" })]);
    expect(cardModel(cardCase({ from: AGENT, blob: VECTORS.V5.blob })).rationale).toMatchObject({ by: "Maat's agent · claude-sonnet-5-5" });
  });
});

describe("a brief-driven Decision", () => {
  it("names the brief and says honestly when its text and the reply are not available", () => {
    const m = cardModel(cardCase({ from: AGENT, blob: VECTORS.V5.blob }));
    expect(m.briefs).toEqual([{ id: 7, head: "Brief #7", text: NO_BRIEF_TEXT, reply: NO_REPLY, hasText: false, hasReply: false }]);
    expect([NO_BRIEF_TEXT, NO_REPLY]).toEqual(["brief text not available", "reply not available"]);
  });

  it("prints the brief as plain text once it is read, and the reply once the journal has one", () => {
    const m = cardModel(
      cardCase({
        from: AGENT,
        blob: VECTORS.V5.blob,
        briefs: [{ id: 7, text: "Buy NVDAc now​ please", from: "0x00000000000000000000000000000000000b7eE1", reply: "Adopted inside the mandate." }],
      }),
    );
    expect(m.briefs).toEqual([
      { id: 7, head: "Brief #7 · from 0x0000…7eE1", text: "Buy NVDAc now� please", reply: "Adopted inside the mandate.", hasText: true, hasReply: true },
    ]);
  });

  it("has no brief panel when the blob adopts no brief", () => {
    expect(cardModel(cardCase({ from: AGENT, blob: VECTORS.V1.blob })).briefs).toEqual([]);
  });

  it("names no brief from a blob whose hash does not match, as /ledger's Briefs", () => {
    const read = cardCase({ from: AGENT, blob: VECTORS.V5.blob, rationaleHash: keccak256(toBytes("another text")), briefs: [{ id: 7, text: "Buy NVDAc now.", from: AGENT, reply: "No." }] });
    const m = cardModel(read);
    expect([m.sender, m.rationale.state, m.briefs]).toEqual(["brief-driven", "mismatch", []]);
  });

  it("never quotes a brief on the owner's /ask hide-list, nor the reply to it", () => {
    const read = cardCase({
      from: AGENT,
      blob: VECTORS.V5.blob,
      briefs: [{ id: 7, text: "abusive text", from: "0x00000000000000000000000000000000000b7eE1", reply: "a reply that quotes the abusive text" }],
    });
    expect(cardModel(read, [7]).briefs).toEqual([
      { id: 7, head: "Brief #7 · from 0x0000…7eE1", text: HIDDEN_BRIEF_TEXT, reply: HIDDEN_REPLY, hasText: false, hasReply: false },
    ]);
    expect([HIDDEN_BRIEF_TEXT, HIDDEN_REPLY]).toEqual(["brief text hidden by the owner, as on /ask", "reply hidden with its brief"]);
    expect(cardModel(read, [8]).briefs[0]).toMatchObject({ text: "abusive text", hasText: true });
  });
});

describe("a compute bill", () => {
  const bill = (text: string, extra: Partial<Parameters<typeof cardCase>[0]> = {}) => {
    const blob = `maat:v1:{"b":62500000,"c":"0123456789abcdef0123456789abcdef01234567","j":"0x${"0".repeat(64)}","k":"bill","r":"run-card-test","s":[],"t":${JSON.stringify(text)}}`;
    return cardCase({ from: AGENT, action: "PAY_EXPENSE", amount: 1_000_000n, blob, payee: OWNER, extraLogs: [usdcTransfer(OWNER, 1_000_000n)], ...extra });
  };

  it("is a bill on a neutral plate, with the amount and payee from the logs, never a trade", () => {
    const m = cardModel(bill("Compute bill: $1.000000 of Claude API usage unpaid as of UTC day 20784"));
    expect(m.plate).toBe("bill");
    expect(m.bill).toEqual({ line: "Compute bill paid · $1.00 · to the owner's allowlisted address", payee: "0x3c3a…1D6a" });
    expect(m.headline).toBe("Compute bill paid");
    expect(m.intent).toBe("PAY_EXPENSE · USDC · $1.00");
    expect(m.balance.ticks).toEqual(Array(9).fill("SKIP"));
    expect(m.verdict).toBe("Allowed · All checks passed (OK)");
  });

  it("names a payee that is not the owner by its address", () => {
    const m = cardModel(bill("Compute bill: $2.500000 of Claude API usage", { amount: 2_500_000n, payee: OTHER_PAYEE, extraLogs: [usdcTransfer(OTHER_PAYEE, 2_500_000n)] }));
    expect(m.bill).toEqual({ line: "Compute bill paid · $2.50 · to the allowlisted address 0x0000…ee01", payee: "0x0000…ee01" });
  });

  it("says a refused bill was not paid", () => {
    const m = cardModel(bill("Compute bill: $1.000000 of Claude API usage", { reason: "PAYEE_NOT_ALLOWED", extraLogs: [] }));
    expect(m.bill?.line).toBe("Compute bill not paid · $1.00");
    expect(m.verdict).toBe("Refused · Payee not approved (PAYEE_NOT_ALLOWED)");
    expect(m.plate).toBe("bill");
  });

  it("calls a payment with no bill blob an expense", () => {
    const m = cardModel(cardCase({ action: "PAY_EXPENSE", amount: 1_000_000n, payee: OWNER, extraLogs: [usdcTransfer(OWNER, 1_000_000n)] }));
    expect(m.bill?.line).toBe("Expense paid · $1.00 · to the owner's allowlisted address");
  });
});

describe("a Decision that is not from Base mainnet", () => {
  it.each([
    ["fork", "FORK REPLAY", "fork-replay-abababab"],
    ["simulated", "SIMULATED", "simulated-abababab"],
    ["preview", "PREVIEW, NOT A DECISION", "preview-not-a-decision-abababab"],
  ] as const)("a %s read prints the band %s and is not numbered", (kind, band, stem) => {
    const m = cardModel(cardCase({ kind }));
    expect(m.band).toBe(band);
    expect(BAND_TEXT[kind]).toBe(band);
    expect(m.title).toBe("Weighing · not numbered");
    expect(m.stem).toBe(stem);
  });

  it("refuses a number on a card that is not mainnet, and a mainnet card without one", () => {
    expect(() => cardModel(cardCase({ kind: "fork", ordinal: 4 }))).toThrow(/not numbered/);
    expect(() => cardModel(cardCase({ kind: "mainnet", ordinal: null }))).toThrow(/ordinal/);
  });

  it("refuses a transaction with no Decision of the vault", () => {
    const read = cardCase();
    expect(() => cardModel({ ...read, logs: [] })).toThrow(/0 Decision logs/);
  });
});

// Keep the test vectors honest: V5 adopts brief 7 and V4 is a probe, as the spec's table says.
it("uses the spec's vectors as the spec describes them", () => {
  expect(VECTORS.V5.blob).toContain('"q":[7]');
  expect(VECTORS.V4.blob).toContain('"k":"probe"');
  expect(keccak256(toBytes(VECTORS.V1.blob))).toBe(VECTORS.V1.hash as Hash);
});
