import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  describeAge,
  describeHeartbeat,
  heartbeatAgeMs,
  heartbeatOf,
  HEARTBEAT_FILE,
  readHeartbeat,
  STALE_AFTER_MS,
  writeHeartbeat,
} from "../src/loop/heartbeat.js";
import type { RunReport } from "../src/loop/runOnce.js";
import { agentDataDir, main } from "../scripts/heartbeat.js";

const AT = new Date("2026-11-25T12:00:00.000Z");
const report: RunReport = { runId: "r-1", status: "done", sent: ["0x01"], skipped: 0, proposals: 1 };
const tmp = () => mkdtemp(join(tmpdir(), "maat-beat-"));
const minutes = (n: number) => AT.getTime() + n * 60_000;

describe("heartbeat", () => {
  it("records a round's end, its status and what it sent, or the one-line error of a failed round", () => {
    expect(heartbeatOf({ report, error: null }, AT, 7)).toEqual({ ts: AT.toISOString(), pid: 7, status: "done", runId: "r-1", sent: 1 });
    expect(heartbeatOf({ report: { ...report, status: "halted", sent: [], haltReason: "daily tx cap 20 reached" }, error: null }, AT, 7)).toMatchObject({
      status: "halted",
      error: "daily tx cap 20 reached",
    });
    expect(heartbeatOf({ report: null, error: "HTTP request failed." }, AT, 7)).toEqual({ ts: AT.toISOString(), pid: 7, status: "failed", error: "HTTP request failed." });
  });

  it("writes the file whole and reads it back; no file reads as null", async () => {
    const dir = await tmp();
    expect(await readHeartbeat(dir)).toBeNull();
    await writeHeartbeat(dir, heartbeatOf({ report, error: null }, AT, 7));
    await writeHeartbeat(dir, heartbeatOf({ report: { ...report, runId: "r-2" }, error: null }, AT, 7));
    expect(await readHeartbeat(dir)).toMatchObject({ runId: "r-2", status: "done" });
    expect(JSON.parse(await readFile(join(dir, HEARTBEAT_FILE), "utf8")).runId).toBe("r-2");
  });

  it("refuses a file without a valid ts", async () => {
    const dir = await tmp();
    await writeFile(join(dir, HEARTBEAT_FILE), JSON.stringify({ pid: 1, status: "done", ts: "soon" }));
    await expect(readHeartbeat(dir)).rejects.toThrow(/no valid ts/);
  });

  it("says how old it is", () => {
    const beat = heartbeatOf({ report, error: null }, AT, 7);
    expect(heartbeatAgeMs(beat, minutes(12))).toBe(12 * 60_000);
    expect([describeAge(45_000), describeAge(12 * 60_000), describeAge(125 * 60_000)]).toEqual(["45 s", "12 min", "2 h 5 min"]);
    expect(describeHeartbeat(beat, minutes(12))).toBe("last round ended 12 min ago at 2026-11-25T12:00:00.000Z: round r-1 done, sent 1, agent pid 7");
    expect(STALE_AFTER_MS).toBe(90 * 60_000);
  });
});

describe("scripts/heartbeat.ts", () => {
  const run = async (argv: string[], o: { now?: number; env?: NodeJS.ProcessEnv; agentDir: string }) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await main(argv, { now: () => o.now ?? minutes(0), env: o.env ?? {}, agentDir: o.agentDir, out: (s) => out.push(s), err: (s) => err.push(s) });
    return { code, out: out.join("\n"), err: err.join("\n") };
  };

  it("exits 0 with the age while the last round is at most 90 min old, and 1 past it", async () => {
    const agentDir = await tmp();
    await writeHeartbeat(join(agentDir, "data"), heartbeatOf({ report, error: null }, AT, 7));
    const fresh = await run([], { agentDir, now: minutes(90) });
    expect(fresh).toMatchObject({ code: 0, err: "" });
    expect(fresh.out).toBe(`OK: last round ended 1 h 30 min ago at 2026-11-25T12:00:00.000Z: round r-1 done, sent 1, agent pid 7 (limit 90 min, ${join(agentDir, "data")})`);
    const stale = await run([], { agentDir, now: minutes(91) });
    expect(stale.code).toBe(1);
    expect(stale.out).toMatch(/^STALE: last round ended 1 h 31 min ago/);
    expect((await run(["--max-age-min", "120"], { agentDir, now: minutes(91) })).code).toBe(0);
  });

  it("exits 2 with no heartbeat yet, an unreadable one, or a bad limit", async () => {
    const agentDir = await tmp();
    const none = await run([], { agentDir });
    expect(none.code).toBe(2);
    expect(none.err).toMatch(/no heartbeat\.json in .* yet; the agent writes it after its first round/);
    await writeFile(join(agentDir, HEARTBEAT_FILE), "{");
    expect((await run(["--data-dir", "."], { agentDir })).code).toBe(2);
    expect((await run(["--max-age-min", "0"], { agentDir })).code).toBe(2);
    expect((await run(["--bogus"], { agentDir })).code).toBe(2);
  });

  it("finds the data dir as the agent does: --data-dir, then the environment, then agent/.env, then ./data", async () => {
    const agentDir = await tmp();
    expect(await agentDataDir({}, agentDir)).toBe(join(agentDir, "data"));
    await writeFile(join(agentDir, ".env"), "ANTHROPIC_API_KEY=fake-key-for-test\nMAAT_DATA_DIR=./data-dryrun\n");
    expect(await agentDataDir({}, agentDir)).toBe(join(agentDir, "data-dryrun"));
    expect(await agentDataDir({ MAAT_DATA_DIR: "./data-live" }, agentDir)).toBe(join(agentDir, "data-live"));
    await writeHeartbeat(join(agentDir, "elsewhere"), heartbeatOf({ report, error: null }, AT, 7));
    expect((await run(["--data-dir", "elsewhere"], { agentDir })).code).toBe(0);
    expect((await run([], { agentDir })).code).toBe(2); // ./data-dryrun has none
  });
});
