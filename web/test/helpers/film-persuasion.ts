import { readFileSync } from "node:fs";
import { join } from "node:path";
import { keccak256, toBytes, type Hash, type Hex } from "viem";
import { BRIEF_TOPIC } from "../../../film/lib/tx.mjs";
import { txInput, VECTORS } from "./maat-v1";

// Beat 7 of the film once both of its transactions are on Base: a brief to MaatInbox, then the vault's Decision on the
// intent that adopted it. Built from the film's fixture (the owner's first mainnet Decision, block 61,700,601) and the
// maat:v1 spec's V5 vector, whose blob adopts brief 7. Shared by web/test/film-identity.test.ts and
// web/e2e/film-cards.spec.ts.

// Vitest and Playwright both run from web/, as in ./maat-v1.
const REPO_ROOT = join(process.cwd(), "..");

export interface FilmReceipt {
  transactionHash: string;
  blockNumber: string;
  status: string;
  from: string;
  to: string;
  gasUsed: string;
  logs: { address: string; topics: string[]; data: string; logIndex: string }[];
}
export interface FilmTx {
  receipt: FilmReceipt;
  block: { number: string; timestamp: string };
}

/** The owner's first mainnet Decision, as film/lib/rpc.mjs trims it; its sender is the vault's owner. */
export const FILM_FIXTURE = JSON.parse(readFileSync(join(REPO_ROOT, "web/test/fixtures/film-tx-decision.json"), "utf8")) as FilmTx;
export const VAULT = FILM_FIXTURE.receipt.to;
/** The vault's owner, which sent the fixture Decision by hand. */
export const OWNER = FILM_FIXTURE.receipt.from;
/** A made-up inbox, an outside wallet, the brief's tx and a made-up executor wallet that is not the owner. */
export const INBOX = `0x${"cd".repeat(20)}`;
export const STRANGER = `0x${"ab".repeat(20)}`;
export const BRIEF_TX = `0x${"12".repeat(32)}`;
export const VERDICT_TX = `0x${"34".repeat(32)}`;
export const EXECUTOR = `0x${"00".repeat(19)}b2`;
export const BRIEF_ID = 7;
export const BRIEF_LOG_INDEX = 3;
/** The contracts the film names by deployments/README.md, here the fixture vault and the made-up inbox. */
export const CONTRACTS = { [VAULT]: "MandateVault", [INBOX]: "MaatInbox" };

const word = (n: number | bigint) => n.toString(16).padStart(64, "0");
const hexNumber = (n: number) => `0x${n.toString(16)}`;

/** A Brief receipt: brief `id` from `from` with `text`, at log index 3 of BRIEF_TX, in the fixture's block. */
export function briefData(text: string, opts: { id?: number; from?: string } = {}): FilmTx {
  const hex = Buffer.from(text, "utf8").toString("hex");
  const from = (opts.from ?? STRANGER).toLowerCase().slice(2);
  const log = {
    address: INBOX,
    topics: [BRIEF_TOPIC, `0x${word(opts.id ?? BRIEF_ID)}`, `0x${"0".repeat(24)}${from}`],
    data: `0x${word(32)}${word(Buffer.byteLength(text))}${hex.padEnd(Math.ceil(hex.length / 64) * 64, "0")}`,
    logIndex: hexNumber(BRIEF_LOG_INDEX),
  };
  return { ...FILM_FIXTURE, receipt: { ...FILM_FIXTURE.receipt, transactionHash: BRIEF_TX, to: INBOX, logs: [log] } };
}

/** The V5 blob with `ids` in place of its q = [7]. */
export const blobAdopting = (ids: readonly number[]) => VECTORS.V5.blob.replace('"q":[7]', `"q":[${ids.join(",")}]`);

/**
 * The vault's Decision on an intent whose maat:v1 blob adopts brief 7 (the spec's V5), sent by EXECUTOR to the vault 60
 * blocks (120 s) after the brief: the fixture Decision with its sender, block, hash and rationaleHash changed. `input`
 * is its calldata, execute(intent) and the blob. Each option changes one of them.
 */
export function verdict(opts: { from?: string; to?: string; blocksAfter?: number; blob?: string; rationaleHash?: Hash } = {}): { data: FilmTx; input: Hex } {
  const blob = opts.blob ?? VECTORS.V5.blob;
  const rationaleHash = opts.rationaleHash ?? keccak256(toBytes(blob));
  const after = opts.blocksAfter ?? 60;
  const block = Number(FILM_FIXTURE.receipt.blockNumber) + after;
  const time = Number(FILM_FIXTURE.block.timestamp) + after * 2;
  const logs = FILM_FIXTURE.receipt.logs.map((l) => ({ ...l, data: `${l.data.slice(0, 2 + 4 * 64)}${rationaleHash.slice(2)}` }));
  const receipt = { ...FILM_FIXTURE.receipt, transactionHash: VERDICT_TX, blockNumber: hexNumber(block), from: opts.from ?? EXECUTOR, to: opts.to ?? VAULT, logs };
  return { data: { receipt, block: { number: hexNumber(block), timestamp: hexNumber(time) } }, input: txInput(blob, { code: null, rationaleHash }) };
}

