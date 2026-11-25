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

  it("exports a row's maat:v1 blob, the bytes its rationaleHash commits to, and never its raw rationale", () => {
    const blob = 'maat:v1:{"b":1,"c":"unknown","j":"0x00","m":"fixed","r":"r1","s":[],"t":"Buy - see [url]."}';
    const sent = line({ kind: "sent", index: 0, intentId: id(5), rationale: "Buy - see https://example.com/x.", blob, rationaleHash: hash(blob), txHash: tx(5) });
    expect(exportRationales([sent])).toEqual([{ intentId: id(5), rationaleHash: hash(blob), text: blob, txHash: tx(5), ts: "2026-11-26T15:30:00.000Z" }]);
    expect(() => exportRationales([{ ...sent, blob: `${blob} ` }])).toThrow(`rationale hash mismatch for ${id(5)}`);
  });

  it("refuses a row whose text does not hash to its rationaleHash", () => {
    const bad = line({ kind: "intent", index: 0, intentId: id(4), rationale: "edited", rationaleHash: hash("original"), txHash: tx(4) });
    expect(() => exportRationales([bad])).toThrow(`rationale hash mismatch for ${id(4)}`);
  });

  it("starts empty in the repository, before any mainnet run", () => {
    expect(rationales).toEqual([]);
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
