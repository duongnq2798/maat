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
});
