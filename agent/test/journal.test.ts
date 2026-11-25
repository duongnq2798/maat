import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isDryRunRow, isLiveRow, Journal } from "../src/ledger/journal.js";

describe("Journal", () => {
  it("appends one JSON line per entry with bigints as strings", async () => {
    const d = await mkdtemp(join(tmpdir(), "maat-journal-"));
    const j = new Journal(d);
    await j.append({ kind: "error", runId: "r1", message: "rpc down" });
    await j.append({ kind: "run", runId: "r2", block: 5n, day: 20_763n, mode: "dry-run", ok: true, summary: "hold", costUsd6: 30_000n, suggestions: 0, proposals: 0 });
    const lines = (await readFile(join(d, "journal.jsonl"), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    const run = JSON.parse(lines[1]!);
    expect(run).toMatchObject({ kind: "run", block: "5", costUsd6: "30000" });
    expect(typeof run.ts).toBe("string");
    expect((await j.read()).map((e) => e.kind)).toEqual(["error", "run"]);
  });
  it("stamps every row with the commit it was given, and no commit without one", async () => {
    const d = await mkdtemp(join(tmpdir(), "maat-journal-"));
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const j = new Journal(d, { commit: sha });
    await j.append({ kind: "error", runId: "r1", message: "rpc down" });
    await j.append({ kind: "skip", runId: "r1", index: 0, symbol: "NVDAc", action: "SUPPLY", error: "credit actions are off: SUPPLY dropped before the preview" });
    await new Journal(d).append({ kind: "error", runId: "r2", message: "x" });
    const rows = await j.read();
    expect(rows.map((r) => r.commit)).toEqual([sha, sha, undefined]);
    expect(Object.keys(rows[0]!).slice(0, 3)).toEqual(["ts", "commit", "kind"]);
  });
  it("finds the first dry-run row, whatever code wrote it, and passes over a line cut short", async () => {
    const d = await mkdtemp(join(tmpdir(), "maat-journal-"));
    const j = new Journal(d);
    expect(await j.firstDryRunRow()).toBeNull();
    await j.append({ kind: "run", runId: "live-1", block: 1n, day: 2n, mode: "live", ok: true, summary: "s", costUsd6: 0n, suggestions: 0, proposals: 0 });
    await j.append({ kind: "intent", runId: "live-1", index: 0, intentId: "0x01", action: "BUY", symbol: "NVDAc", amountUsd6: 1n, rationale: "r", rationaleHash: "0x02", preview: "OK", gate: "execute" });
    await writeFile(join(d, "journal.jsonl"), '{"kind":"run","mode":"dry', { flag: "a" });
    await writeFile(join(d, "journal.jsonl"), "\n", { flag: "a" });
    expect(await j.firstDryRunRow()).toBeNull();
    await j.append({ kind: "housekeeping", runId: "dry-1", call: "syncMultiplier", token: "0x0000000000000000000000000000000000000001", note: "dry-run" });
    expect(await j.firstDryRunRow()).toMatchObject({ kind: "housekeeping", runId: "dry-1" });
  });
  it("finds the first live row: a live round or a send", async () => {
    const d = await mkdtemp(join(tmpdir(), "maat-journal-"));
    const j = new Journal(d);
    expect(await j.firstLiveRow()).toBeNull();
    await j.append({ kind: "run", runId: "dry-1", block: 1n, day: 2n, mode: "dry-run", ok: true, summary: "s", costUsd6: 0n, suggestions: 0, proposals: 0 });
    expect(await j.firstLiveRow()).toBeNull();
    await j.append({ kind: "sent", runId: "live-1", index: 0, intentId: "0x01", action: "BUY", symbol: "NVDAc", amountUsd6: 1n, rationale: "r", rationaleHash: "0x02", preview: "OK", gate: "execute", txHash: "0x03", gas: 1n });
    expect(await j.firstLiveRow()).toMatchObject({ kind: "sent", runId: "live-1" });
    expect(isLiveRow({ kind: "run", mode: "live" })).toBe(true);
    expect(isLiveRow({ kind: "run", mode: "dry-run" })).toBe(false);
    expect(isLiveRow({ kind: "intent", gate: "execute" })).toBe(false);
  });
  it("tells dry-run rows from live ones", () => {
    expect(isDryRunRow({ kind: "run", mode: "dry-run" })).toBe(true);
    expect(isDryRunRow({ kind: "intent", gate: "dry-run: would log-refusal" })).toBe(true);
    expect(isDryRunRow({ kind: "housekeeping", note: "dry-run" })).toBe(true);
    expect(isDryRunRow({ kind: "run", mode: "live" })).toBe(false);
    expect(isDryRunRow({ kind: "intent", gate: "execute" })).toBe(false);
    expect(isDryRunRow({ kind: "intent", gate: "MARKET_CLOSED already logged for NYSE date 2026-11-26 (holiday)", rationale: "dry-run" })).toBe(false);
    expect(isDryRunRow({ kind: "error", message: "dry-run" })).toBe(false);
  });
  it("reads an empty journal as []", async () => {
    const d = await mkdtemp(join(tmpdir(), "maat-journal-"));
    expect(await new Journal(d).read()).toEqual([]);
  });
  it("types read-back rows with string bigints and a ts", async () => {
    const d = await mkdtemp(join(tmpdir(), "maat-journal-"));
    const j = new Journal(d);
    await j.append({ kind: "run", runId: "r1", block: 7n, day: 20_763n, mode: "live", ok: true, summary: "ok", costUsd6: 30_000n, suggestions: 1, proposals: 1 });
    await j.append({ kind: "intent", runId: "r1", index: 0, intentId: "0x01", action: "BUY", symbol: "TSLA", amountUsd6: 250_000_000n, rationale: "why", rationaleHash: "0x02", preview: "OK", gate: "pass" });
    const rows = await j.read();
    const run = rows.find((r) => r.kind === "run");
    if (run?.kind !== "run") throw new Error("missing run row");
    expect(run.costUsd6).toBe("30000");
    expect(run.block).toBe("7");
    expect(typeof run.ts).toBe("string");
    const intent = rows.find((r) => r.kind === "intent");
    if (intent?.kind !== "intent") throw new Error("missing intent row");
    expect(typeof intent.amountUsd6).toBe("string");
    expect(intent.amountUsd6).toBe("250000000");
  });
});
