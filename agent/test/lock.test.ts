import { mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { acquireLock, RoundLock } from "../src/loop/lock.js";

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

describe("RoundLock", () => {
  it("runs one holder at a time, first come first served, and counts who waits", async () => {
    const lock = new RoundLock();
    const order: string[] = [];
    let release!: () => void;
    const first = lock.run(() => new Promise<string>((r) => (release = () => r("first"))));
    const second = lock.run(async () => (order.push("second"), "second"));
    const third = lock.run(async () => (order.push("third"), "third"));
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual([]);
    expect(lock.waiting).toBe(2);
    release();
    expect(await Promise.all([first, second, third])).toEqual(["first", "second", "third"]);
    expect(order).toEqual(["second", "third"]);
    expect(lock.waiting).toBe(0);
  });

  it("is released when its holder throws", async () => {
    const lock = new RoundLock();
    await expect(lock.run(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await lock.run(async () => 1)).toBe(1);
  });
});
