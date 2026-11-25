// @vitest-environment node
import { keccak256, toBytes, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import rationales from "@/content/generated/rationales.json";
import { staticRationaleSource, verifyRationale } from "@/lib/chain/rationale";
import { exportRationales } from "@/lib/rationales-export";

const TEXT = "Buy NVDAc: it sits under its target weight and the session is open.";
const hash = (t: string) => keccak256(toBytes(t));
const id = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const tx = (n: number) => `0x${(9000 + n).toString(16).padStart(64, "0")}` as Hex;

describe("verifyRationale", () => {
  it("is verified when keccak256 of the exact UTF-8 text equals the onchain hash", () => {
    expect(verifyRationale(TEXT, hash(TEXT))).toBe("verified");
  });

  it("is a mismatch for any other text, even one trailing space", () => {
    expect(verifyRationale(`${TEXT} `, hash(TEXT))).toBe("mismatch");
  });

  it("hashes non-ASCII text by its UTF-8 bytes, as agent/src/intent.ts rationaleHash does", () => {
    const fr = "Prix élevé — attendre la séance";
    expect(verifyRationale(fr, hash(fr))).toBe("verified");
    expect(verifyRationale(fr.normalize("NFD"), hash(fr))).toBe("mismatch");
  });

  it("is missing when no text was exported", () => {
    expect(verifyRationale(undefined, hash(TEXT))).toBe("missing");
  });

  it("compares hashes case-insensitively", () => {
    expect(verifyRationale(TEXT, hash(TEXT).toUpperCase().replace("0X", "0x") as Hex)).toBe("verified");
  });
});

const line = (o: Record<string, unknown>) => ({ ts: "2026-11-26T15:30:00.000Z", runId: "r1", ...o });

describe("exportRationales", () => {
  const rows = [
    line({ kind: "run", ok: true }),
    line({ kind: "intent", index: 0, intentId: id(1), rationale: TEXT, rationaleHash: hash(TEXT), txHash: tx(1) }),
    line({ kind: "sent", index: 1, intentId: id(2), rationale: "Pay the compute bill.", rationaleHash: hash("Pay the compute bill."), txHash: tx(2), ts: "2026-11-26T15:31:00.000Z" }),
    line({ kind: "skip", index: 2, symbol: "AAPLc", action: "BUY", error: "x" }),
    line({ kind: "intent", index: 3, intentId: id(3), rationale: "Never sent.", rationaleHash: hash("Never sent.") }),
    line({ kind: "intent", index: 1, intentId: id(2), rationale: "Pay the compute bill.", rationaleHash: hash("Pay the compute bill."), txHash: tx(2), ts: "2026-11-26T15:32:00.000Z" }),
  ];

  it("keeps one entry per intent that reached a transaction, oldest first", () => {
    expect(exportRationales(rows)).toEqual([
      { intentId: id(1), rationaleHash: hash(TEXT), text: TEXT, txHash: tx(1), ts: "2026-11-26T15:30:00.000Z" },
      { intentId: id(2), rationaleHash: hash("Pay the compute bill."), text: "Pay the compute bill.", txHash: tx(2), ts: "2026-11-26T15:32:00.000Z" },
    ]);
  });

  it("refuses a row whose text does not hash to its rationaleHash", () => {
    const bad = line({ kind: "intent", index: 0, intentId: id(4), rationale: "edited", rationaleHash: hash("original"), txHash: tx(4) });
    expect(() => exportRationales([bad])).toThrow(`rationale hash mismatch for ${id(4)}`);
  });
});

// The vault's two Decision events on Base mainnet, as their transaction receipts record them: the owner-sent BUY the
// vault refused with reason 6 (MARKET_CLOSED) and the one it allowed. Both commit to the same rationaleHash.
const MAINNET = [
  {
    txHash: "0xdfdb6739912a73542d90129bd7269a939dc8b2d47a869f56d9ab5e3a02e86c3b",
    block: 61_700_601,
    intentId: "0xdc06ec8e29767044d325cc10445a942d26a463a4ed08487b013c5fed2a59243c",
    allowed: false,
    rationaleHash: "0x0baa4c52e17e7acc5c7cc851e57a9df523c70b5a1530d77055bb2401370f57f6",
  },
  {
    txHash: "0x61622340a151c73c3f2b3bc910292a3e3136bd4aa7ecd55a92f59914953a23c8",
    block: 61_745_836,
    intentId: "0x475efb77a4242345466f42fc844ac578b99716db50eca20d0ffe27549a68ee3d",
    allowed: true,
    rationaleHash: "0x0baa4c52e17e7acc5c7cc851e57a9df523c70b5a1530d77055bb2401370f57f6",
  },
] as const;

describe("the committed export (content/generated/rationales.json)", () => {
  it("holds one row for each mainnet Decision, oldest first, and no other", () => {
    expect(rationales.map((r) => [r.intentId, r.txHash])).toEqual(MAINNET.map((m) => [m.intentId, m.txHash]));
  });

  for (const m of MAINNET) {
    it(`verifies the ${m.allowed ? "allowed" : "refused"} Decision in block ${m.block} against its onchain rationaleHash`, () => {
      const row = rationales.find((r) => r.intentId === m.intentId);
      expect(row?.rationaleHash).toBe(m.rationaleHash);
      expect(verifyRationale(row?.text, m.rationaleHash)).toBe("verified");
    });
  }

  it("is what exportRationales writes back from it, so the file holds no row the export would refuse", () => {
    const lines = rationales.map((r) => ({ kind: "intent", intentId: r.intentId, rationale: r.text, rationaleHash: r.rationaleHash, txHash: r.txHash, ts: r.ts }));
    expect(exportRationales(lines)).toEqual(rationales);
  });

  it("gives /ledger a verified text for both mainnet intent ids, as the page reads the file", async () => {
    const src = staticRationaleSource("/data/rationales.json", (async () => new Response(JSON.stringify(rationales), { status: 200 })) as typeof fetch);
    const found = await src.lookup(MAINNET.map((m) => m.intentId));
    expect(MAINNET.map((m) => verifyRationale(found.get(m.intentId), m.rationaleHash))).toEqual(["verified", "verified"]);
  });
});

describe("staticRationaleSource", () => {
  const body = [{ intentId: id(1).toUpperCase().replace("0X", "0x"), rationaleHash: hash(TEXT), text: TEXT, txHash: tx(1), ts: "t" }];
  const respond = (status: number, json: unknown) => async () => new Response(JSON.stringify(json), { status });

  it("maps the exported texts by intent id, case-insensitively", async () => {
    const src = staticRationaleSource("/data/rationales.json", respond(200, body) as typeof fetch);
    expect(src.name).toBe("/data/rationales.json");
    const found = await src.lookup([id(1), id(2)]);
    expect(found.get(id(1))).toBe(TEXT);
    expect(found.has(id(2))).toBe(false);
  });

  it("returns nothing when the file is missing or malformed", async () => {
    expect((await staticRationaleSource("/x", respond(404, {}) as typeof fetch).lookup([id(1)])).size).toBe(0);
    expect((await staticRationaleSource("/x", respond(200, { nope: 1 }) as typeof fetch).lookup([id(1)])).size).toBe(0);
  });
});
