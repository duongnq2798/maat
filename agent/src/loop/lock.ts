import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

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
      const pid = Number((await readFile(file, "utf8")).trim());
      if (Number.isInteger(pid) && pid > 0 && alive(pid)) throw new Error(`another agent (pid ${pid}) is running; lock ${file}`);
      await unlink(file).catch(() => {});
    }
  }
  throw new Error(`could not acquire ${file}`);
}
