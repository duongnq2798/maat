import { fileURLToPath } from "node:url";
import deployments from "../content/generated/deployments.json";
import { deploymentConfig } from "../lib/chain/config";
import { runGapIndex, USAGE, UsageError } from "../lib/gap/cli";
import { createLogReader } from "../lib/gap/rpc";
import { calendarAddress } from "../lib/live/snapshot";

const CACHE_DIR = fileURLToPath(new URL("../.cache/gap", import.meta.url));
const OUT_DIR = fileURLToPath(new URL("../content/gap-index/", import.meta.url));

// The windows are checked against the deployed MarketCalendar, and Decisions are read from the deployed vault: both
// from the table in deployments/README.md, as the site reads them.
runGapIndex(process.argv.slice(2), {
  reader: createLogReader(),
  cacheDir: CACHE_DIR,
  outDir: OUT_DIR,
  calendar: calendarAddress(deployments),
  vault: deploymentConfig(deployments)?.vault,
  stdout: (text) => process.stdout.write(text),
  log: (line) => console.error(line),
}).catch((e: unknown) => {
  console.error(`gap-index: ${e instanceof Error ? e.message : String(e)}`);
  if (e instanceof UsageError) console.error(USAGE);
  process.exit(1);
});
