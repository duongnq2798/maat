import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { EditionDef } from "@/content/gap-index/editions";
import { measureEdition, warmEdition } from "./edition";
import { createLogSource } from "./logs";
import type { LogReader } from "./rpc";
import { editionSchema } from "./schema";

export const USAGE =
  "usage: npm run gap-index -- --edition N [--window ID]... [--token SYM]... [--head BLOCK] [--complete] [--stdout] [--no-cache] [--warm]";

/** --warm only reads logs into the cache: each of these flags asks for something it does not do, so it refuses them. */
const NOT_WITH_WARM = [
  ["complete", "--complete measures every window and writes the edition file, and --warm measures nothing; run --warm first, then --complete on its own"],
  ["stdout", "--warm measures nothing and writes no edition, so it has nothing to print"],
  ["no-cache", "--warm only fills the log cache, and --no-cache would keep nothing it reads"],
] as const;

/** A command line refused before anything is read: the script prints its message and the usage line. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export interface GapCliDeps {
  reader: LogReader;
  /** Where the logs are cached: web/.cache/gap for the script. */
  cacheDir: string;
  /** Where the edition file is written: web/content/gap-index/ for the script. */
  outDir: string;
  /** MarketCalendar on Base, from deployments/README.md: null when the table names none. */
  calendar: string | null;
  /** MandateVault on Base, from the same table. */
  vault?: string;
  stdout: (text: string) => void;
  log: (line: string) => void;
  /** Where the edition number is looked up: EDITIONS, unless a test gives its own. */
  editions?: readonly EditionDef[];
}

/**
 * `npm run gap-index -- <argv>`: measures an edition and writes its file under deps.outDir, or prints it with --stdout.
 * With --warm it measures nothing and writes nothing there: it reads the logs the measuring run will need into the cache.
 */
export async function runGapIndex(argv: readonly string[], deps: GapCliDeps): Promise<void> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      edition: { type: "string" },
      window: { type: "string", multiple: true },
      token: { type: "string", multiple: true },
      head: { type: "string" },
      complete: { type: "boolean", default: false },
      stdout: { type: "boolean", default: false },
      "no-cache": { type: "boolean", default: false },
      warm: { type: "boolean", default: false },
    },
    strict: true,
  });
  if (values.edition === undefined || !/^\d+$/.test(values.edition)) throw new UsageError("--edition N is required");
  if (values.warm) for (const [flag, why] of NOT_WITH_WARM) if (values[flag]) throw new UsageError(`--warm refuses --${flag}: ${why}`);
  // A filtered run writes no edition file: it prints, or with --warm only fills the cache.
  if ((values.window?.length || values.token?.length) && !values.stdout && !values.warm) {
    throw new UsageError("--window and --token filter a run, so they need --stdout");
  }
  if (values.head !== undefined && !/^\d+$/.test(values.head)) throw new UsageError("--head takes a block number");
  if (deps.calendar === null) throw new UsageError("deployments/README.md names no MarketCalendar on Base mainnet");

  const { reader } = deps;
  const edition = Number(values.edition);
  const head = values.head === undefined ? undefined : Number(values.head);
  if (values.warm) {
    const opts = { edition, windows: values.window, tokens: values.token, head };
    const warmed = await warmEdition({ reader, cacheDir: deps.cacheDir, log: deps.log, calendar: deps.calendar, editions: deps.editions }, opts);
    // The cache is all --warm is for: a settled span it could not keep fails the run, so the owner sees it before the deadline.
    if (warmed.failed > 0) {
      throw new Error(`--warm could not write ${warmed.failed} span files to ${deps.cacheDir}, so a later run reads them from Base again: ${warmed.writeError}`);
    }
    deps.log(`wrote nothing under ${deps.outDir}: --warm only fills ${deps.cacheDir}`);
    return;
  }
  const file = await measureEdition(
    {
      reader,
      source: (headBlock) => createLogSource(reader, { cacheDir: values["no-cache"] ? null : deps.cacheDir, headBlock }),
      log: deps.log,
      calendar: deps.calendar,
      vault: deps.vault,
      editions: deps.editions,
    },
    {
      edition,
      windows: values.window,
      tokens: values.token,
      head,
      complete: values.complete,
    },
  );
  const checked = editionSchema({ partial: Boolean(values.token?.length) }).parse(file);
  const text = `${JSON.stringify(checked, null, 2)}\n`;
  if (values.stdout) {
    deps.stdout(text);
    return;
  }
  mkdirSync(deps.outDir, { recursive: true });
  const target = path.join(deps.outDir, `edition-${edition}.json`);
  const tmp = `${target}.tmp`;
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, target);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  deps.log(`wrote ${target}`);
}
