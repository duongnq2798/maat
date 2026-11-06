import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Journal } from "../src/ledger/journal.js";

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
