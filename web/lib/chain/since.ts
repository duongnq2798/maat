import { isAddress, isHash, type Address, type Hash } from "viem";
import { z } from "zod";
import type { MainnetDecision } from "./ledger";
import type { ScanState } from "./load";

/**
 * The one localStorage key the ledger's "since your last look" uses. What it holds stays in this browser: no request
 * carries it and no cookie is set from it.
 */
export const LOOK_KEY = "maat:ledger:look:v1";

/** What this browser remembers of the viewer's last complete look at /ledger. */
export interface LastLook {
  v: 1;
  vault: Address;
  /** Milliseconds since the epoch: when the page last showed the ledger read up to the head. */
  at: number;
  /** The newest Decision the page showed then, or null when the vault had recorded none. */
  newest: { block: string; logIndex: number; txHash: Hash } | null;
}

/** The parts of a ledger read the model looks at. */
export interface LookInput {
  vault: Address;
  /** Newest first, as LedgerSnapshot.decisions. */
  decisions: readonly Pick<MainnetDecision, "key" | "blockNumber" | "txHash">[];
  scan: Pick<ScanState, "done" | "scannedFrom">;
}

/** The Decisions that came after the last look. */
export interface Since {
  /** MainnetDecision.key of each Decision after the last look. */
  fresh: ReadonlySet<string>;
  /** How many there are, once every block after the look's Decision has been read; null until then. */
  count: number | null;
  /** When the last look was, in milliseconds. */
  at: number;
}

const schema = z.object({
  v: z.literal(1),
  vault: z.string().refine((v) => isAddress(v, { strict: false })),
  at: z.number().int().nonnegative(),
  newest: z
    .object({
      block: z.string().regex(/^\d+$/),
      logIndex: z.number().int().nonnegative(),
      txHash: z.string().refine((v) => isHash(v)),
    })
    .nullable(),
});

/** The look this browser keeps, or null: none kept, one this page cannot read, or storage that is blocked. */
export function readLook(storage: Storage | null): LastLook | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(LOOK_KEY);
    if (raw === null) return null;
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data as LastLook) : null;
  } catch {
    return null;
  }
}

/** Keeps `look` in this browser; false when there is no storage or the browser refuses the write. */
export function saveLook(storage: Storage | null, look: LastLook): boolean {
  if (!storage) return false;
  try {
    storage.setItem(LOOK_KEY, JSON.stringify(look));
    return true;
  } catch {
    return false;
  }
}

/** A Decision's log index: its key is "txHash:logIndex" (lib/chain/ledger.ts, toMainnetDecisions). */
function logIndexOf(d: Pick<MainnetDecision, "key">): number {
  return Number(d.key.slice(d.key.lastIndexOf(":") + 1));
}

/**
 * The look to remember after a read: the newest Decision and `nowMs`. Null while the newest Decision is not known yet,
 * which is until every block from it to the head has been read (or every block, when there is none).
 */
export function nextLook(read: LookInput, nowMs: number): LastLook | null {
  const newest = read.decisions[0];
  const known = read.scan.done || (newest !== undefined && read.scan.scannedFrom !== null && newest.blockNumber >= read.scan.scannedFrom);
  if (!known) return null;
  return {
    v: 1,
    vault: read.vault,
    at: nowMs,
    newest: newest ? { block: newest.blockNumber.toString(), logIndex: logIndexOf(newest), txHash: newest.txHash } : null,
  };
}

/**
 * The Decisions after `look`, by place: a later block, or the same block and a later log index. A reorg that takes the
 * look's Decision away leaves its place, so the count stays exact and is never negative; a transaction the viewer saw
 * is never new again, even when a reorg mined it in a later block. Null on a first visit: no look, or a look of
 * another vault.
 */
export function sinceLastLook(look: LastLook | null, read: LookInput): Since | null {
  if (!look || look.vault.toLowerCase() !== read.vault.toLowerCase()) return null;
  const seen = look.newest;
  const after = (d: LookInput["decisions"][number]) => {
    if (!seen) return true;
    if (d.txHash.toLowerCase() === seen.txHash.toLowerCase()) return false;
    const block = BigInt(seen.block);
    return d.blockNumber > block || (d.blockNumber === block && logIndexOf(d) > seen.logIndex);
  };
  const fresh = new Set(read.decisions.filter(after).map((d) => d.key));
  const { done, scannedFrom } = read.scan;
  const exact = done || (seen !== null && scannedFrom !== null && scannedFrom <= BigInt(seen.block));
  return { fresh, count: exact ? fresh.size : null, at: look.at };
}
