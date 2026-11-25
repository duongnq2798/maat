// Writes content/generated/decisions-snapshot.json: every log of the Base mainnet MandateVault in deployments/README.md
// from its deploy block to the RPC's finalized block N, with N's hash. /ledger and the landing start a first read from
// it and scan only from N minus the reorg window; each browser checks the logs it takes against their receipts on Base.
// The script only reads Base, through keyless RPCs, and the build never runs it: a data PR commits the file it writes.
//
// Usage (in web/): npm run snapshot [-- --rpc <https URL>] [--check <https URL>] [--fresh]
// --rpc is where the logs are read, https://base-rpc.publicnode.com by default (mainnet.base.org refuses eth_getLogs).
// --check is a second RPC, https://mainnet.base.org by default, that must give the same hash for N and the same logs in
// every receipt, as a browser checks them, before the file is written. When the file already holds a snapshot of the
// vault that --rpc still confirms, the run keeps its logs and scans only from its block minus the window; --fresh scans
// from the deploy block.
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import deployments from "../content/generated/deployments.json";
import { BASE_CHAIN_ID, deploymentConfig } from "../lib/chain/config";
import { decodeVaultLogs } from "../lib/chain/events";
import { checkSnapshot, errorText, takeSnapshot, type LedgerClient } from "../lib/chain/load";
import { LOG_CHUNK, MIN_LOG_CHUNK } from "../lib/chain/scan";
import { SNAPSHOT_CHECK_RPC, SNAPSHOT_RPC } from "../lib/chain/snapshot";

const OUT = fileURLToPath(new URL("../content/generated/decisions-snapshot.json", import.meta.url));
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

  const previous = !values.fresh && existsSync(OUT) ? (JSON.parse(readFileSync(OUT, "utf8")) as unknown) : undefined;
  const span = LOG_SPAN[rpc.origin] ?? LOG_CHUNK;
  console.error(
    `snapshot: vault ${recorded.vault} on ${rpc.origin}, finalized block ${finalized.number}, ${span}-block chunks${previous ? ", building on the committed file" : ""}`,
  );
  let reported = -1;
  const started = Date.now();
  const snapshot = await takeSnapshot({
    client: reader as unknown as LedgerClient,
    vault: recorded.vault,
    deployTx: recorded.deployTx,
    block: { number: finalized.number, hash: finalized.hash },
    previous,
    span,
    minSpan: span < LOG_CHUNK ? span : undefined,
    concurrency: 2,
    onProgress: (read, total) => {
      const pct = Number((read * 100n) / total);
      if (pct >= reported + 10) {
        reported = pct - (pct % 10);
        console.error(`snapshot: ${read} of ${total} blocks read (${pct}%)`);
      }
    },
  });

  const checked = await checkSnapshot((await onBase(checkRpc)) as unknown as LedgerClient, recorded.vault, snapshot);
  if (!checked.ok) throw new Error(`${checkRpc.origin} does not confirm the snapshot: ${checked.reason}; no snapshot written`);
  const txs = new Set(snapshot.logs.map((l) => l.transactionHash.toLowerCase())).size;
  console.error(`snapshot: ${checkRpc.origin} gives the same hash for block ${snapshot.block} and the same logs in all ${txs} receipts`);

  const tmp = `${OUT}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(snapshot, null, 2)}\n`);
    renameSync(tmp, OUT);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  const decisions = decodeVaultLogs(snapshot.logs).filter((e) => e.name === "Decision").length;
  console.log(
    `wrote content/generated/decisions-snapshot.json: ${snapshot.logs.length} logs (${decisions} Decision${decisions === 1 ? "" : "s"}) of ${snapshot.vault}, blocks ${snapshot.floor} to ${snapshot.block}, block hash ${snapshot.blockHash}, in ${Math.round((Date.now() - started) / 1000)} s`,
  );
}

main().catch((e: unknown) => {
  console.error(`snapshot: ${errorText(e)}`);
  process.exit(1);
});
