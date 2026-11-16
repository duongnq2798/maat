import { mkdir, open, readFile, realpath, stat, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";

/** An unreadable lock younger than this may belong to an agent that has not written its pid yet. */
const UNREADABLE_STALE_MS = 60_000;

/** Lock files this process holds, by real path: a lock naming our pid that is not in here is a predecessor's. */
const held = new Set<string>();

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
  // The real path is one key per file, whatever case, symlink or junction spells the dir.
  const file = join(await realpath(dir), "agent.lock");
  // A restarted container keeps its host name; a second container on the same volume has another.
  const host = hostname();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const h = await open(file, "wx");
      // Mark it held before the pid lands, so a concurrent acquire in this process never reads our pid as stale.
      held.add(file);
      await h.writeFile(`${process.pid} ${host}`);
      await h.close();
      return async () => {
        await unlink(file).catch(() => {});
        held.delete(file);
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const text = (await readFile(file, "utf8")).trim();
      // "<pid> <host>", or a bare pid from before the host was recorded.
      const m = /^(\d+)(?: (.+))?$/.exec(text);
      const pid = m ? Number(m[1]) : NaN;
      const owner = m?.[2];
      if (Number.isSafeInteger(pid) && pid > 0) {
        // A pid written on another host lives in another pid namespace, so a probe here proves nothing: fail closed.
        if (owner !== undefined && owner !== host) {
          throw new Error(`another agent (pid ${pid} on ${owner}) may be running; delete ${file} if no other container uses this data dir`);
        }
        // A container restart often reuses the pid the crashed agent wrote, so our own pid alone proves nothing.
        if (pid === process.pid ? held.has(file) : alive(pid)) throw new Error(`another agent (pid ${pid}) is running; lock ${file}`);
      } else if (Date.now() - (await stat(file)).mtimeMs <= UNREADABLE_STALE_MS) {
        // Fail closed: empty or garbled content is treated as held unless it is clearly stale.
        throw new Error("lock file unreadable; delete if no agent runs");
      }
      await unlink(file).catch(() => {});
    }
  }
  throw new Error(`could not acquire ${file}`);
}
