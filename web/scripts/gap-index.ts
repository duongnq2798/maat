import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import deployments from "../content/generated/deployments.json";
import { deploymentConfig } from "../lib/chain/config";
import { measureEdition } from "../lib/gap/edition";
import { createLogSource } from "../lib/gap/logs";
import { createLogReader } from "../lib/gap/rpc";
import { editionSchema } from "../lib/gap/schema";
import { calendarAddress } from "../lib/live/snapshot";

const CACHE_DIR = fileURLToPath(new URL("../.cache/gap", import.meta.url));
const OUT_DIR = fileURLToPath(new URL("../content/gap-index/", import.meta.url));

function usage(message: string): never {
  console.error(`gap-index: ${message}`);
  console.error(
    "usage: npm run gap-index -- --edition N [--window ID]... [--token SYM]... [--head BLOCK] [--complete] [--stdout] [--no-cache]",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      edition: { type: "string" },
      window: { type: "string", multiple: true },
      token: { type: "string", multiple: true },
      head: { type: "string" },
      complete: { type: "boolean", default: false },
      stdout: { type: "boolean", default: false },
      "no-cache": { type: "boolean", default: false },
    },
    strict: true,
  });
  if (values.edition === undefined || !/^\d+$/.test(values.edition)) usage("--edition N is required");
  if ((values.window?.length || values.token?.length) && !values.stdout) usage("--window and --token filter a run, so they need --stdout");
  if (values.head !== undefined && !/^\d+$/.test(values.head)) usage("--head takes a block number");

  // The windows are checked against the deployed MarketCalendar, and Decisions are read from the deployed vault: both
  // from the table in deployments/README.md, as the site reads them.
  const calendar = calendarAddress(deployments);
  if (calendar === null) usage("deployments/README.md names no MarketCalendar on Base mainnet");
  const vault = deploymentConfig(deployments)?.vault;

  const reader = createLogReader();
  const edition = Number(values.edition);
  const file = await measureEdition(
    {
      reader,
      source: (headBlock) => createLogSource(reader, { cacheDir: values["no-cache"] ? null : CACHE_DIR, headBlock }),
      log: (line) => console.error(line),
      calendar,
      vault,
    },
    {
      edition,
      windows: values.window,
      tokens: values.token,
      head: values.head === undefined ? undefined : Number(values.head),
      complete: values.complete,
    },
  );
  const checked = editionSchema({ partial: Boolean(values.token?.length) }).parse(file);
  const text = `${JSON.stringify(checked, null, 2)}\n`;
  if (values.stdout) {
    process.stdout.write(text);
    return;
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const target = `${OUT_DIR}edition-${edition}.json`;
  const tmp = `${target}.tmp`;
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, target);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  console.error(`wrote ${target}`);
}

main().catch((e: unknown) => {
  console.error(`gap-index: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
