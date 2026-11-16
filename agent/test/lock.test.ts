import { spawn } from "node:child_process";
import { once } from "node:events";
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
  it("takes over a lock that names this process's pid but is not held by it", async () => {
    // A restarted container often hands the new agent the pid its predecessor wrote.
    const d = await mkdtemp(join(tmpdir(), "maat-lock-"));
    const f = join(d, "agent.lock");
    await writeFile(f, String(process.pid));
    const release = await acquireLock(d);
    await expect(acquireLock(d)).rejects.toThrow(`another agent (pid ${process.pid}) is running`);
    await release();
    expect(existsSync(f)).toBe(false);
    await (await acquireLock(d))();
    expect(existsSync(f)).toBe(false);
  });
  it("respects a lock held by another live process", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    const exited = once(child, "exit");
    try {
      const d = await mkdtemp(join(tmpdir(), "maat-lock-"));
      const f = join(d, "agent.lock");
      await writeFile(f, String(child.pid));
      await expect(acquireLock(d)).rejects.toThrow(`another agent (pid ${child.pid}) is running`);
      expect(existsSync(f)).toBe(true);
    } finally {
      child.kill();
      await exited;
    }
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
