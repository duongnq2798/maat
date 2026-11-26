import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, realpath, symlink, utimes, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { acquireLock, RoundLock } from "../src/loop/lock.js";

describe("acquireLock", () => {
  it("holds and releases", async () => {
    const d = await mkdtemp(join(tmpdir(), "maat-lock-"));
    const release = await acquireLock(d);
    expect(await readFile(join(d, "agent.lock"), "utf8")).toBe(`${process.pid} ${hostname()}`);
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
  it("takes over a lock left by a dead process on this host", async () => {
    const d = await mkdtemp(join(tmpdir(), "maat-lock-"));
    await writeFile(join(d, "agent.lock"), `2147483646 ${hostname()}`);
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
  it("takes over a lock that names this process's pid on this host", async () => {
    // A restarted container keeps its host name.
    const d = await mkdtemp(join(tmpdir(), "maat-lock-"));
    await writeFile(join(d, "agent.lock"), `${process.pid} ${hostname()}`);
    const release = await acquireLock(d);
    await release();
  });
  it("treats a lock that names this process's pid on another host as held", async () => {
    // A second container on the same volume runs the same image, so it gets the same pid in its own namespace.
    const d = await mkdtemp(join(tmpdir(), "maat-lock-"));
    const f = join(d, "agent.lock");
    await writeFile(f, `${process.pid} other-host`);
    await expect(acquireLock(d)).rejects.toThrow(`another agent (pid ${process.pid} on other-host) may be running`);
    expect(existsSync(f)).toBe(true);
  });
  it("treats a lock that names another pid on another host as held", async () => {
    // That pid lives in another pid namespace: a probe here finds nothing and would let a second agent in.
    const d = await mkdtemp(join(tmpdir(), "maat-lock-"));
    const f = join(d, "agent.lock");
    await writeFile(f, "2147483646 other-host");
    await expect(acquireLock(d)).rejects.toThrow(
      `another agent (pid 2147483646 on other-host) may be running; delete ${join(await realpath(d), "agent.lock")} if no other container uses this data dir`,
    );
    expect(existsSync(f)).toBe(true);
  });
  it("rejects a second acquire through another path to the same dir", async () => {
    const d = await mkdtemp(join(tmpdir(), "maat-lock-"));
    const real = join(d, "real");
    const link = join(d, "link");
    await mkdir(real);
    await symlink(real, link, "junction");
    const release = await acquireLock(real);
    await expect(acquireLock(link)).rejects.toThrow(/another agent \(pid \d+\) is running/);
    await release();
    expect(existsSync(join(real, "agent.lock"))).toBe(false);
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
