import { mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

/** An unreadable lock younger than this may belong to an agent that has not written its pid yet. */
const UNREADABLE_STALE_MS = 60_000;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** One agent per data dir: a second one would double-pay bills and double-log refusals. */
export async function acquireLock(dir: string): Promise<() => Promise<void>> {
  await mkdir(dir, { recursive: true });
  const file = join(dir, "agent.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const h = await open(file, "wx");
      await h.writeFile(String(process.pid));
      await h.close();
      return async () => {
        await unlink(file).catch(() => {});
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const text = (await readFile(file, "utf8")).trim();
      const pid = /^\d+$/.test(text) ? Number(text) : NaN;
      if (Number.isSafeInteger(pid) && pid > 0) {
        if (alive(pid)) throw new Error(`another agent (pid ${pid}) is running; lock ${file}`);
      } else if (Date.now() - (await stat(file)).mtimeMs <= UNREADABLE_STALE_MS) {
        // Fail closed: empty or garbled content is treated as held unless it is clearly stale.
        throw new Error("lock file unreadable; delete if no agent runs");
      }
      await unlink(file).catch(() => {});
    }
  }
  throw new Error(`could not acquire ${file}`);
}
