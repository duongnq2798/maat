// @vitest-environment node
import { readFileSync } from "node:fs";
import { keccak256, toBytes, type Address, type Hash } from "viem";
import { describe, expect, it } from "vitest";
import { VERDICT_PLATE } from "@/components/sections/Vault";
import { intentPayee, liveRows } from "@/components/sections/vault-live";
import { intentText, plateOf, RECORDED_ROWS, toVaultRow } from "@/components/sections/vault-rows";
import { billLine } from "@/content/bill";
import { decisionTrails, type MainnetDecision, type TxInput } from "@/lib/chain/ledger";
import type { Treasury } from "@/lib/chain/treasury";
import { executeInput, NVDAC, OTHER_PAYEE, OWNER, USDC, VAULT } from "./helpers/card";

// The landing's bill rows (culture plan Q5): a PAY_EXPENSE reads as a bill, in the Weighing card's words, on a neutral
// plate; the Allowed plate is a quiet accent tint; Refused keeps its solid ink plate.

const BILL_TEXT = "Compute bill: $1.000000 of Claude API usage unpaid as of UTC day 20784";
const BILL_BLOB = `maat:v1:{"b":62500000,"c":"0123456789abcdef0123456789abcdef01234567","j":"0x${"0".repeat(64)}","k":"bill","r":"run-landing-test","s":[],"t":${JSON.stringify(BILL_TEXT)}}`;
const BILL_HASH = keccak256(toBytes(BILL_BLOB));
const TX: Hash = `0x${"cd".repeat(32)}`;

function decision(over: Partial<MainnetDecision> = {}): MainnetDecision {
  return {
    key: `${TX}:3`,
    blockNumber: 62_400_000n,
    txHash: TX,
    timestamp: 1_795_707_000,
    timeLabel: "Thu 26 Nov 10:30",
    etDay: "2026-11-26",
    intentId: `0x${"11".repeat(32)}`,
    action: "BUY",
    token: NVDAC,
    symbol: "NVDAc",
    amount: 5_000_000n,
    amountLabel: "$5.00",
    allowed: true,
    reason: "OK",
    rationaleHash: `0x${"22".repeat(32)}`,
    gasUsed: 120_000n,
    ...over,
  };
}

/** A PAY_EXPENSE of $1.00 out of the vault. */
const billDecision = (over: Partial<MainnetDecision> = {}) =>
  decision({ action: "PAY_EXPENSE", token: USDC, symbol: "USDC", amount: 1_000_000n, amountLabel: "$1.00", rationaleHash: BILL_HASH, ...over });

/** What the landing's live read hands liveRows: the Decisions, their transactions and trails, and the vault's owner. */
function snapshot(d: MainnetDecision, tx: TxInput | null, owner: Address | null = OWNER) {
  const txs = new Map<string, TxInput>(tx === null ? [] : [[d.txHash.toLowerCase(), tx]]);
  return {
    decisions: [d],
    txs,
    trails: decisionTrails([d], txs, { vault: VAULT, owner, complete: true }),
    treasury: owner === null ? null : ({ owner } as Treasury),
  };
}

const billTx = (o: { payee?: Address; blob?: string | null; rationaleHash?: Hash } = {}): TxInput => ({
  from: OWNER,
  to: VAULT,
  input: executeInput({
    action: "PAY_EXPENSE",
    token: USDC,
    amount: 1_000_000n,
    payee: o.payee ?? OWNER,
    rationaleHash: o.rationaleHash ?? BILL_HASH,
    blob: o.blob === undefined ? BILL_BLOB : o.blob,
  }),
});

const lineOf = (d: MainnetDecision, tx: TxInput | null, owner: Address | null = OWNER) => {
  const row = liveRows(snapshot(d, tx, owner))[0]!;
  return row.bill === null ? null : billLine(row.bill);
};

describe("the bill label", () => {
  it("reads a paid compute bill to the owner in the Weighing card's words", () => {
    expect(billLine({ name: "Compute bill", amount: "$1.00", allowed: true, payee: OWNER, owner: OWNER })).toBe(
      "Compute bill paid · $1.00 · to the owner's allowlisted address",
    );
    // The owner is matched whatever the case of either address.
    expect(billLine({ name: "Compute bill", amount: "$1.00", allowed: true, payee: OWNER.toLowerCase(), owner: OWNER })).toBe(
      "Compute bill paid · $1.00 · to the owner's allowlisted address",
    );
  });

  it("names any other payee by its short address, says when the payee was not read, and says a refused bill was not paid", () => {
    expect(billLine({ name: "Compute bill", amount: "$2.50", allowed: true, payee: OTHER_PAYEE, owner: OWNER })).toBe(
      "Compute bill paid · $2.50 · to the allowlisted address 0x0000…ee01",
    );
    // With the owner unknown, the payee is never called the owner's.
    expect(billLine({ name: "Compute bill", amount: "$1.00", allowed: true, payee: OWNER, owner: null })).toBe(
      "Compute bill paid · $1.00 · to the allowlisted address 0x3c3a…1D6a",
    );
    expect(billLine({ name: "Expense", amount: "$1.00", allowed: true, payee: null, owner: OWNER })).toBe("Expense paid · $1.00 · payee not read");
    expect(billLine({ name: "Compute bill", amount: "$1.00", allowed: false, payee: OWNER, owner: OWNER })).toBe("Compute bill not paid · $1.00");
  });
});

describe("a live PAY_EXPENSE on the landing", () => {
  it("is a compute bill when its calldata carries a bill blob whose hash the Decision logged, paid to the payee its intent names", () => {
    const [row] = liveRows(snapshot(billDecision(), billTx()));
    expect(row!.bill).toEqual({ name: "Compute bill", amount: "$1.00", allowed: true, payee: OWNER, owner: OWNER });
    expect(billLine(row!.bill!)).toBe("Compute bill paid · $1.00 · to the owner's allowlisted address");
    expect(plateOf(row!)).toBe("bill");
    expect(intentText(row!)).toBe("Compute bill · $1.00");
    expect(intentText(row!)).not.toMatch(/PAY_EXPENSE|USDC/);
  });

  it("is an expense when the calldata carries no bill blob, or one whose hash the Decision did not log", () => {
    expect(lineOf(billDecision({ rationaleHash: keccak256(toBytes("smoke")) }), billTx({ blob: null, rationaleHash: keccak256(toBytes("smoke")) }))).toBe(
      "Expense paid · $1.00 · to the owner's allowlisted address",
    );
    expect(lineOf(billDecision({ rationaleHash: keccak256(toBytes("another text")) }), billTx({ rationaleHash: keccak256(toBytes("another text")) }))).toBe(
      "Expense paid · $1.00 · to the owner's allowlisted address",
    );
  });

  it("names another payee, an unread payee and an unknown owner as they are", () => {
    expect(lineOf(billDecision(), billTx({ payee: OTHER_PAYEE }))).toBe("Compute bill paid · $1.00 · to the allowlisted address 0x0000…ee01");
    expect(lineOf(billDecision(), null)).toBe("Expense paid · $1.00 · payee not read");
    expect(lineOf(billDecision(), billTx(), null)).toBe("Compute bill paid · $1.00 · to the allowlisted address 0x3c3a…1D6a");
    // A transaction that is not a direct execute call to the vault says nothing about the intent's payee.
    expect(lineOf(billDecision(), { ...billTx(), to: OTHER_PAYEE })).toBe("Expense paid · $1.00 · payee not read");
  });

  it("keeps a refused bill on the Refused plate, named as a bill", () => {
    const [row] = liveRows(snapshot(billDecision({ allowed: false, reason: "PAYEE_NOT_ALLOWED" }), billTx({ payee: OTHER_PAYEE })));
    expect(plateOf(row!)).toBe("refused");
    expect(billLine(row!.bill!)).toBe("Compute bill not paid · $1.00");
    expect(intentText(row!)).toBe("Compute bill · $1.00");
  });

  it("leaves a trade as it was: no bill, its own plate and intent", () => {
    const [allowed] = liveRows(snapshot(decision(), null));
    expect(allowed!.bill).toBeNull();
    expect(plateOf(allowed!)).toBe("allowed");
    expect(intentText(allowed!)).toBe("BUY NVDAc · $5.00");
    const [refused] = liveRows(snapshot(decision({ allowed: false, reason: "MARKET_CLOSED" }), null));
    expect(plateOf(refused!)).toBe("refused");
    // A row from the ledger's loader alone, with no trail, is the same row.
    expect(toVaultRow(decision())).toEqual(allowed);
  });

  it("reads the payee from the intent's sixth word, and nothing from calldata too short to hold one", () => {
    expect(intentPayee(billTx({ payee: OTHER_PAYEE }).input)).toBe(OTHER_PAYEE);
    expect(intentPayee("0x4ad3993f")).toBeNull();
  });
});

describe("the recorded Decisions", () => {
  it("are two trades, so neither is a bill", () => {
    expect(RECORDED_ROWS.map((r) => [r.bill, plateOf(r)])).toEqual([
      [null, "allowed"],
      [null, "refused"],
    ]);
  });
});

// Read by path: Vitest runs in web/.
const css = readFileSync("app/globals.css", "utf8");
const TOKENS = new Map<string, string>();
for (const [, name, hex] of css.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)) {
  if (!TOKENS.has(name!)) TOKENS.set(name!, hex!.toUpperCase());
}

/** WCAG 2.2 contrast ratio of two tokens of app/globals.css. */
function contrast(fg: string, bg: string): number {
  const lum = (token: string) => {
    const hex = TOKENS.get(token);
    if (hex === undefined) throw new Error(`no --color-${token} in app/globals.css`);
    const n = Number.parseInt(hex.slice(1), 16);
    const c = (v: number) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
    return 0.2126 * c((n >> 16) & 255) + 0.7152 * c((n >> 8) & 255) + 0.0722 * c(n & 255);
  };
  const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The one token a class list sets with `prefix-`, as in "bg-accent-tint". */
function token(classes: string, prefix: "bg" | "text"): string {
  const found = [...classes.matchAll(new RegExp(`(?:^|\\s)${prefix}-([a-z][a-z0-9-]*)(?=\\s|$)`, "g"))].map((m) => m[1]!).filter((t) => TOKENS.has(t));
  expect(found, `${prefix}- in "${classes}"`).toHaveLength(1);
  return found[0]!;
}

describe("the verdict plates (contrast, spec 2026-11-23 section 9.2)", () => {
  it("sets Allowed on a quiet accent tint, never the solid accent, and keeps Refused on solid ink", () => {
    expect(VERDICT_PLATE.allowed.box).not.toMatch(/(^|\s)bg-accent(\s|$)/);
    expect(token(VERDICT_PLATE.allowed.box, "bg")).toBe("accent-tint");
    expect(token(VERDICT_PLATE.allowed.word, "text")).toBe("accent");
    expect(VERDICT_PLATE.refused.box).toMatch(/(^|\s)bg-ink(\s|$)/);
    expect(token(VERDICT_PLATE.bill.box, "bg")).not.toMatch(/^accent|^refuse/);
  });

  it.each(["allowed", "bill"] as const)("gives every text on the %s plate its minimum contrast", (kind) => {
    const p = VERDICT_PLATE[kind];
    const bg = token(p.box, "bg");
    // The verdict word, 30 px semibold: 4.5:1 or more.
    expect(contrast(token(p.word, "text"), bg)).toBeGreaterThanOrEqual(4.5);
    // The small mono labels (VAULT DECISION, the gas), at 11 px: 7:1 or more.
    expect(contrast(token(p.label, "text"), bg)).toBeGreaterThanOrEqual(7);
    // The ReasonTag in its neutral tone: the label in ink, the 11 px code in ink-2, the pinned exception (4.5:1).
    expect(p.tag).toBe("neutral");
    expect(contrast("ink", bg)).toBeGreaterThanOrEqual(7);
    expect(contrast("ink-2", bg)).toBeGreaterThanOrEqual(4.5);
  });
});
