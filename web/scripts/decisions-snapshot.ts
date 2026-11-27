// Writes content/generated/decisions-snapshot.json: every log of the Base mainnet MandateVault in deployments/README.md
// from its deploy block to the RPC's finalized block N, with N's hash. /ledger and the landing start a first read from
// it and scan only from N minus the reorg window; each browser checks the logs it takes against their receipts on Base.
// While the table records a MaatInbox, it also writes content/generated/briefs-snapshot.json at the same block N, the
// same way: every log of the inbox (its Brief logs) from its deploy block to N, which /ask and /proof start their read
// of the Brief logs from. With no brief sent, that file holds no log and still says that the blocks to N hold none.
// The script only reads Base, through keyless RPCs, and the build never runs it: a data PR commits the files it writes.
//
// Usage (in web/): npm run snapshot [-- --rpc <https URL>] [--check <https URL>] [--fresh]
// --rpc is where the logs are read, https://base-rpc.publicnode.com by default (mainnet.base.org refuses eth_getLogs).
// --check is a second RPC, https://mainnet.base.org by default, that must give the same hash for N and the same logs in
// every receipt, as a browser checks them, before a file is written; it writes neither file unless both pass. When a
// file already holds a snapshot of its contract that --rpc still confirms, the run keeps its logs and scans only from its
// block minus the window; --fresh scans from each deploy block.
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import deployments from "../content/generated/deployments.json";
import { BASE_CHAIN_ID, deploymentConfig } from "../lib/chain/config";
import { decodeVaultLogs } from "../lib/chain/events";
import { inboxDeployment } from "../lib/chain/inbox";
import { checkBriefsSnapshot, checkSnapshot, errorText, takeBriefsSnapshot, takeSnapshot, type LedgerClient } from "../lib/chain/load";
import { LOG_CHUNK, MIN_LOG_CHUNK } from "../lib/chain/scan";
import { SNAPSHOT_CHECK_RPC, SNAPSHOT_RPC } from "../lib/chain/snapshot";

const OUT = fileURLToPath(new URL("../content/generated/decisions-snapshot.json", import.meta.url));
const BRIEFS_OUT = fileURLToPath(new URL("../content/generated/briefs-snapshot.json", import.meta.url));
/** RPCs whose eth_getLogs range is capped far below LOG_CHUNK, by origin (lib/chain/scan.ts gives each limit). */
const LOG_SPAN: Readonly<Record<string, bigint>> = { "https://mainnet.base.org": MIN_LOG_CHUNK };

function usage(message: string): never {
  console.error(`snapshot: ${message}`);
  console.error("usage: npm run snapshot [-- --rpc <https URL>] [--check <https URL>] [--fresh]");
  process.exit(1);
}

function httpsUrl(flag: string, value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    usage(`--${flag} ${value} is not a URL`);
  }
  if (url.protocol !== "https:") usage(`--${flag} must be an https URL`);
  return url;
}

/** A read-only Base client; viem retries a rate-limited call with exponential backoff: 1 s, 2 s, ... 32 s. */
const client = (url: URL) => createPublicClient({ chain: base, transport: http(url.href, { retryCount: 6, retryDelay: 1_000, timeout: 30_000 }) });

async function onBase(url: URL): Promise<ReturnType<typeof client>> {
  const c = client(url);
  const chainId = await c.getChainId();
  if (chainId !== BASE_CHAIN_ID) usage(`${url.origin} is chain ${chainId}, not Base mainnet (${BASE_CHAIN_ID})`);
  return c;
}

/** The committed file at `path`, as parsed JSON, to build on; undefined with --fresh or when there is none. */
const committed = (path: string, fresh: boolean): unknown => (!fresh && existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as unknown) : undefined);

/**
 * Writes each value to a temporary file beside its path, and only once all are written renames them into place. So a
 * failed write leaves every committed file as it was, rather than one file at the new block and the other at the old.
 */
function writeJsonFiles(files: readonly (readonly [path: string, value: unknown])[]): void {
  const staged: string[] = [];
  try {
    for (const [path, value] of files) {
      const tmp = `${path}.tmp`;
      staged.push(tmp);
      writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
    }
  } catch (e) {
    for (const tmp of staged) rmSync(tmp, { force: true });
    throw e;
  }
  for (const [path] of files) renameSync(`${path}.tmp`, path);
}

/** After each chunk, a line every 10% of the blocks of [floor, N]. */
function progress(label: string): (read: bigint, total: bigint) => void {
  let reported = -1;
  return (read, total) => {
    const pct = Number((read * 100n) / total);
    if (pct >= reported + 10) {
      reported = pct - (pct % 10);
      console.error(`snapshot: ${label}: ${read} of ${total} blocks read (${pct}%)`);
    }
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      rpc: { type: "string", default: SNAPSHOT_RPC },
      check: { type: "string", default: SNAPSHOT_CHECK_RPC },
      fresh: { type: "boolean", default: false },
    },
    strict: true,
  });
  const rpc = httpsUrl("rpc", values.rpc);
  const checkRpc = httpsUrl("check", values.check);
  const recorded = deploymentConfig(deployments);
  if (!recorded) usage("deployments/README.md records no Base mainnet MandateVault (run npm run docs:gen after the deploy)");

  const reader = await onBase(rpc);
  const finalized = await reader.getBlock({ blockTag: "finalized" });
  if (finalized.number === null || finalized.hash === null) throw new Error(`${rpc.origin} gave a finalized block with no number or hash`);

  const previous = committed(OUT, values.fresh);
  const inbox = inboxDeployment(deployments);
  const previousBriefs = inbox ? committed(BRIEFS_OUT, values.fresh) : undefined;
  const span = LOG_SPAN[rpc.origin] ?? LOG_CHUNK;
  console.error(
    `snapshot: vault ${recorded.vault}${inbox ? ` and inbox ${inbox.inbox}` : ""} on ${rpc.origin}, finalized block ${finalized.number}, ${span}-block chunks${previous || previousBriefs ? ", building on the committed files" : ""}`,
  );
  const started = Date.now();
  const at = { number: finalized.number, hash: finalized.hash };
  const tuning = { block: at, span, minSpan: span < LOG_CHUNK ? span : undefined, concurrency: 2 };
  const snapshot = await takeSnapshot({
    ...tuning,
    client: reader as unknown as LedgerClient,
    vault: recorded.vault,
    deployTx: recorded.deployTx,
    previous,
    onProgress: progress("vault"),
  });
  const briefs = inbox
    ? await takeBriefsSnapshot({
        ...tuning,
        client: reader as unknown as LedgerClient,
        inbox: inbox.inbox,
        deployTx: inbox.deployTx,
        previous: previousBriefs,
        onProgress: progress("inbox"),
      })
    : null;

  const checker = (await onBase(checkRpc)) as unknown as LedgerClient;
  const checked = await checkSnapshot(checker, recorded.vault, snapshot);
  if (!checked.ok) throw new Error(`${checkRpc.origin} does not confirm the decisions snapshot: ${checked.reason}; no snapshot written`);
  const txs = new Set(snapshot.logs.map((l) => l.transactionHash.toLowerCase())).size;
  console.error(`snapshot: ${checkRpc.origin} gives the same hash for block ${snapshot.block} and the same vault logs in all ${txs} receipts`);
  if (briefs) {
    const ok = await checkBriefsSnapshot(checker, briefs.inbox, briefs);
    if (!ok.ok) throw new Error(`${checkRpc.origin} does not confirm the Brief snapshot: ${ok.reason}; no snapshot written`);
    const n = new Set(briefs.logs.map((l) => l.transactionHash.toLowerCase())).size;
    console.error(`snapshot: ${checkRpc.origin} gives the same hash for block ${briefs.block} and the same inbox logs in all ${n} receipts`);
  }

  writeJsonFiles(briefs ? [[OUT, snapshot], [BRIEFS_OUT, briefs]] : [[OUT, snapshot]]);
  const decisions = decodeVaultLogs(snapshot.logs).filter((e) => e.name === "Decision").length;
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(
    `wrote content/generated/decisions-snapshot.json: ${snapshot.logs.length} logs (${decisions} Decision${decisions === 1 ? "" : "s"}) of ${snapshot.vault}, blocks ${snapshot.floor} to ${snapshot.block}, block hash ${snapshot.blockHash}, in ${seconds} s`,
  );
  if (briefs) {
    console.log(
      `wrote content/generated/briefs-snapshot.json: ${briefs.logs.length} Brief log${briefs.logs.length === 1 ? "" : "s"} of ${briefs.inbox}, blocks ${briefs.floor} to ${briefs.block}, block hash ${briefs.blockHash}`,
    );
  } else {
    // A Brief snapshot left from an inbox the table no longer records would sit at another block than the decisions file.
    const stale = existsSync(BRIEFS_OUT);
    rmSync(BRIEFS_OUT, { force: true });
    console.log(`deployments/README.md records no Base mainnet MaatInbox: no Brief snapshot written${stale ? ", and the old one removed" : ""}`);
  }
}

main().catch((e: unknown) => {
  console.error(`snapshot: ${errorText(e)}`);
  process.exit(1);
});
