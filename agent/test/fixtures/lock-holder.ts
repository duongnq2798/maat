// A stand-in for `npm run agent` in test/lockRestart.test.ts: it takes the data-dir lock as src/main.ts does, prints
// "locked <pid>" and holds the lock until it is killed. A start that cannot take it prints main.ts's line and exits 1.
//   node --import tsx test/fixtures/lock-holder.ts <data dir>      (from agent/)
import { acquireLock } from "../../src/loop/lock.js";
import { oneLine } from "../../src/redact.js";

const dir = process.argv[2];
if (dir === undefined) throw new Error("usage: lock-holder.ts <data dir>");
try {
  await acquireLock(dir);
  console.log(`locked ${process.pid}`);
  setInterval(() => {}, 60_000);
} catch (e) {
  console.error(`maat agent stopped: ${oneLine(e)}`);
  process.exitCode = 1;
}
