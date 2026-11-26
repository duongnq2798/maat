import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { isHash, type Hash } from "viem";
import { renderCard } from "@/brand/card";
import { cardModel, type CardModel } from "./model";
import { fixtureKindProblem, parseCardFile, readMainnetCard, type CardClient, type CardSources } from "./read";

// npm run card (scripts/card.ts): the Weighing card of one vault Decision, read from Base mainnet by its transaction
// hash, or of a fork, simulated or preview transaction from a file, written as two PNGs.

export const CARD_USAGE = "usage: npm run card -- <txhash> [--out DIR]\n       npm run card -- --fixture FILE [--out DIR]";

/** Where the cards go without --out: the build-in-public image folder at the repo root, which git ignores. */
export const DEFAULT_OUT_DIR = fileURLToPath(new URL("../../../.superpowers/build-in-public/img", import.meta.url));

/** A mistake in the command line: the script prints it with CARD_USAGE. */
export class UsageError extends Error {}

export interface CardDeps {
  /** The read-only Base client; only a txhash run asks for it. */
  client: () => CardClient;
  /** The vault (and inbox) of deployments/README.md, or null while it records no vault. */
  sources: CardSources | null;
  defaultOut: string;
  log: (line: string) => void;
}

function args(argv: readonly string[]): { tx: Hash | null; fixture: string | null; out: string | null } {
  let parsed;
  try {
    parsed = parseArgs({ args: [...argv], allowPositionals: true, options: { out: { type: "string" }, fixture: { type: "string" } } });
  } catch (e) {
    throw new UsageError(e instanceof Error ? e.message : String(e));
  }
  const { values, positionals } = parsed;
  const fixture = values.fixture ?? null;
  if (positionals.length > 1) throw new UsageError("give one transaction hash");
  const [tx] = positionals;
  if (tx !== undefined && fixture !== null) throw new UsageError("give a transaction hash or --fixture, not both");
  if (tx === undefined && fixture === null) throw new UsageError("give a transaction hash, or --fixture FILE");
  if (tx !== undefined && !isHash(tx)) throw new UsageError(`${tx} is not a transaction hash`);
  return { tx: (tx?.toLowerCase() as Hash | undefined) ?? null, fixture, out: values.out ?? null };
}

/** The card's one-line summary: "Weighing № 1 · Refused · Market closed (MARKET_CLOSED) · BUY · NVDAc · $5.00 · owner, by hand". */
function summary(m: CardModel): string {
  return [m.band, m.title, m.verdict, m.bill?.line ?? m.intent, m.sender].filter((p) => p !== null).join(" · ");
}

/** Reads the Decision, writes both sizes of its card, and logs a summary line and each file's path. */
export async function runCard(argv: readonly string[], deps: CardDeps): Promise<{ model: CardModel; files: string[] }> {
  const { tx, fixture, out } = args(argv);
  let read;
  if (fixture !== null) {
    const raw: unknown = JSON.parse(readFileSync(fixture, "utf8"));
    const problem = fixtureKindProblem(raw);
    if (problem) throw new UsageError(problem);
    read = parseCardFile(raw);
  } else {
    if (!deps.sources) throw new Error("deployments/README.md records no Base mainnet MandateVault, so there is no Decision to read");
    read = await readMainnetCard(deps.client(), tx!, deps.sources);
  }
  const model = cardModel(read);
  const dir = out ?? deps.defaultOut;
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  for (const card of await renderCard(model)) {
    const file = join(dir, card.file);
    writeFileSync(file, card.png);
    files.push(file);
  }
  deps.log(summary(model));
  for (const f of files) deps.log(f);
  return { model, files };
}
