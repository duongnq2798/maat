import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { measureEdition } from "../lib/gap/edition";
import { createLogSource } from "../lib/gap/logs";
import { createLogReader } from "../lib/gap/rpc";
import { editionSchema } from "../lib/gap/schema";

const CACHE_DIR = fileURLToPath(new URL("../.cache/gap", import.meta.url));
const OUT_DIR = fileURLToPath(new URL("../content/gap-index/", import.meta.url));

function usage(message: string): never {
  console.error(`gap-index: ${message}`);
  console.error("usage: npm run gap-index -- --edition N [--window ID]... [--token SYM]... [--stdout] [--no-cache]");
  process.exit(1);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      edition: { type: "string" },
      window: { type: "string", multiple: true },
      token: { type: "string", multiple: true },
      stdout: { type: "boolean", default: false },
      "no-cache": { type: "boolean", default: false },
    },
    strict: true,
  });
  if (values.edition === undefined || !/^\d+$/.test(values.edition)) usage("--edition N is required");
  if ((values.window?.length || values.token?.length) && !values.stdout) usage("--window and --token filter a run, so they need --stdout");

  const reader = createLogReader();
  const edition = Number(values.edition);
  const file = await measureEdition(
    {
      reader,
      source: (headBlock) => createLogSource(reader, { cacheDir: values["no-cache"] ? null : CACHE_DIR, headBlock }),
      log: (line) => console.error(line),
    },
    { edition, windows: values.window, tokens: values.token },
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
