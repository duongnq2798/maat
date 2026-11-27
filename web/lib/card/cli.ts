import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { isHash, type Hash } from "viem";
import { renderCard } from "@/brand/card";
import { renderGapCard } from "@/brand/gap-card";
import { EditionFileSchema } from "@/lib/gap/schema";
import { editionPath, gapCardModel, type GapCardModel } from "./gap";
import { cardModel, type CardModel } from "./model";
import { fixtureKindProblem, parseCardFile, readMainnetCard, type CardClient, type CardSources } from "./read";

// npm run card (scripts/card.ts): the Weighing card of one vault Decision, read from Base mainnet by its transaction
// hash, or of a fork, simulated or preview transaction from a file; or the card of one Gap Index window, read from its
// committed edition file. Each is written as two PNGs.

export const CARD_USAGE = [
  "usage: npm run card -- <txhash> [--out DIR]",
  "       npm run card -- --fixture FILE [--out DIR]",
  "       npm run card -- --gap-edition N --window ID [--token SYM] [--out DIR]",
].join("\n");

/** Where the cards go without --out: the build-in-public image folder at the repo root, which git ignores. */
export const DEFAULT_OUT_DIR = fileURLToPath(new URL("../../../.superpowers/build-in-public/img", import.meta.url));

/** Where the committed Gap Index edition files are: web/content/gap-index. */
export const DEFAULT_GAP_DIR = fileURLToPath(new URL("../../content/gap-index", import.meta.url));

/** A mistake in the command line: the script prints it with CARD_USAGE. */
export class UsageError extends Error {}

export interface CardDeps {
  /** The read-only Base client; only a txhash run asks for it. */
  client: () => CardClient;
  /** The vault (and inbox) of deployments/README.md, or null while it records no vault. */
  sources: CardSources | null;
  defaultOut: string;
  /** Where --gap-edition N reads edition-N.json: DEFAULT_GAP_DIR unless a test gives its own. */
  gapDir?: string;
  log: (line: string) => void;
}

/** The flags that draw a Gap Index card instead of a Decision's. */
const GAP_FLAGS = ["gap-edition", "window", "token"] as const;

function parse(argv: readonly string[]) {
  try {
    return parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        out: { type: "string" },
        fixture: { type: "string" },
        "gap-edition": { type: "string" },
        window: { type: "string", multiple: true },
        token: { type: "string", multiple: true },
      },
    });
  } catch (e) {
    throw new UsageError(e instanceof Error ? e.message : String(e));
  }
}

const asksForGap = (values: ReturnType<typeof parse>["values"]) => GAP_FLAGS.some((f) => values[f] !== undefined);

function args(argv: readonly string[]): { tx: Hash | null; fixture: string | null; out: string | null } {
  const { values, positionals } = parse(argv);
  if (asksForGap(values)) throw new UsageError("--gap-edition, --window and --token draw a Gap Index card, not a Decision's");
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

function gapArgs(argv: readonly string[]): { edition: number; window: string; token: string | null; out: string | null } {
  const { values, positionals } = parse(argv);
  const edition = values["gap-edition"];
  if (edition === undefined) throw new UsageError("--window and --token draw a Gap Index card: they need --gap-edition N");
  if (positionals.length > 0 || values.fixture !== undefined) throw new UsageError("give a transaction hash, --fixture or --gap-edition, not two of them");
  if (!/^\d+$/.test(edition)) throw new UsageError(`--gap-edition takes an edition number, not ${edition}`);
  const windows = values.window ?? [];
  if (windows.length === 0) throw new UsageError("--gap-edition needs --window ID: a window's close date, as its edition file lists it");
  if (windows.length > 1) throw new UsageError("--window takes one window: a card shows one");
  const tokens = values.token ?? [];
  if (tokens.length > 1) throw new UsageError("--token takes one token: a card shows one");
  return { edition: Number(edition), window: windows[0]!, token: tokens[0] ?? null, out: values.out ?? null };
}

/** "Gap Index · edition 0 · window 2026-11-13 · Fri 13 Nov 16:00 ET → Mon 16 Nov 09:30 ET · NVDAc · Largest gap +356 bps". */
function gapSummary(m: GapCardModel): string {
  const figure = m.figure.kind === "gap" ? `${m.figure.label} ${m.figure.value}` : m.figure.text;
  return [m.title, m.span, m.symbol, figure].join(" · ");
}

/**
 * `npm run card -- --gap-edition N --window ID [--token SYM]`: reads web/content/gap-index/edition-N.json, checks it with
 * the edition schema, and writes both sizes of the window's card. It reads nothing from Base.
 */
export async function runGapCard(argv: readonly string[], deps: CardDeps): Promise<{ model: GapCardModel; files: string[] }> {
  const { edition, window, token, out } = gapArgs(argv);
  const name = editionPath(edition);
  const path = join(deps.gapDir ?? DEFAULT_GAP_DIR, `edition-${edition}.json`);
  if (!existsSync(path)) throw new UsageError(`edition ${edition} has no file ${name}: only a committed edition is drawn`);
  const parsed = EditionFileSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) throw new Error(`${name} does not parse: ${parsed.error.message}`);
  if (parsed.data.edition !== edition) throw new Error(`${name} holds edition ${parsed.data.edition}, not ${edition}`);
  let model: GapCardModel;
  try {
    model = gapCardModel(parsed.data, window, token ?? undefined);
  } catch (e) {
    // A window or token the file does not hold, or a pending window: the message names what it holds.
    throw new UsageError(e instanceof Error ? e.message : String(e));
  }
  const dir = out ?? deps.defaultOut;
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  for (const card of await renderGapCard(model)) {
    const file = join(dir, card.file);
    writeFileSync(file, card.png);
    files.push(file);
  }
  deps.log(gapSummary(model));
  for (const f of files) deps.log(f);
  return { model, files };
}

/** `npm run card -- <argv>`: a Gap Index card when a Gap Index flag is given, else the Weighing card of a Decision. */
export async function runCardCommand(argv: readonly string[], deps: CardDeps): Promise<{ files: string[] }> {
  return asksForGap(parse(argv).values) ? runGapCard(argv, deps) : runCard(argv, deps);
}
