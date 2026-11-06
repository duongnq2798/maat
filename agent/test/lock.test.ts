import { mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { acquireLock } from "../src/loop/lock.js";

describe("acquireLock", () => {
  it("holds and releases", async () => {
    const d = await mkdtemp(join(tmpdir(), "maat-lock-"));
    const release = await acquireLock(d);
    expect(existsSync(join(d, "agent.lock"))).toBe(true);
    await expect(acquireLock(d)).rejects.toThrow(/another agent \(pid \d+\) is running/);
    await release();
    expect(existsSync(join(d, "agent.lock"))).toBe(false);
    await (await acquireLock(d))();
  });
  it("takes over a lock left by a dead process", async () => {
    const d = await mkdtemp(join(tmpdir(), "maat-lock-"));
    await writeFile(join(d, "agent.lock"), "2147483646");
    const release = await acquireLock(d);
    await release();
  });
  it("treats a fresh lock file with unreadable content as held", async () => {
    const d = await mkdtemp(join(tmpdir(), "maat-lock-"));
    await writeFile(join(d, "agent.lock"), "");
    await expect(acquireLock(d)).rejects.toThrow("lock file unreadable; delete if no agent runs");
    expect(existsSync(join(d, "agent.lock"))).toBe(true);
  });
  it("takes over an unreadable lock file older than 60 s", async () => {
    const d = await mkdtemp(join(tmpdir(), "maat-lock-"));
    const f = join(d, "agent.lock");
    await writeFile(f, "garbage");
    const old = new Date(Date.now() - 61_000);
    await utimes(f, old, old);
    const release = await acquireLock(d);
    await release();
  });
});
