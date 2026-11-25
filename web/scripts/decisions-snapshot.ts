// Writes content/generated/decisions-snapshot.json: every log of the Base mainnet MandateVault in deployments/README.md
// from its deploy block to the RPC's finalized block N, with N's hash and each Decision's block time, gas and
// transaction. /ledger and the landing start a first read from it and scan only from N minus the reorg window. The
// script only reads Base, through one keyless RPC, and the build never runs it: a data PR commits the file it writes.
//
// Usage (in web/): npm run snapshot [-- --rpc <https URL>] [--fresh]
// The default RPC is https://mainnet.base.org. When the file already holds a snapshot of the vault whose block hash the
// RPC still gives, the run keeps its logs and scans only from its block minus the window; --fresh scans from the deploy.
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import deployments from "../content/generated/deployments.json";
import { BASE_CHAIN_ID, deploymentConfig } from "../lib/chain/config";
import { decodeVaultLogs } from "../lib/chain/events";
import { errorText, takeSnapshot, type LedgerClient } from "../lib/chain/load";
import { LOG_CHUNK, MIN_LOG_CHUNK } from "../lib/chain/scan";

const OUT = fileURLToPath(new URL("../content/generated/decisions-snapshot.json", import.meta.url));
const DEFAULT_RPC = "https://mainnet.base.org";
/** RPCs whose eth_getLogs range is capped far below LOG_CHUNK, by origin (lib/chain/scan.ts gives each limit). */
const LOG_SPAN: Readonly<Record<string, bigint>> = { "https://mainnet.base.org": MIN_LOG_CHUNK };

function usage(message: string): never {
  console.error(`snapshot: ${message}`);
  console.error("usage: npm run snapshot [-- --rpc <https URL>] [--fresh]");
  process.exit(1);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { rpc: { type: "string", default: DEFAULT_RPC }, fresh: { type: "boolean", default: false } },
    strict: true,
  });
  let rpc: URL;
  try {
    rpc = new URL(values.rpc);
  } catch {
    usage(`--rpc ${values.rpc} is not a URL`);
  }
  if (rpc.protocol !== "https:") usage("--rpc must be an https URL");
  const recorded = deploymentConfig(deployments);
  if (!recorded) usage("deployments/README.md records no Base mainnet MandateVault (run npm run docs:gen after the deploy)");

  // viem retries a rate-limited call with exponential backoff: 1 s, 2 s, ... 32 s.
  const client = createPublicClient({ chain: base, transport: http(rpc.href, { retryCount: 6, retryDelay: 1_000, timeout: 30_000 }) });
  const chainId = await client.getChainId();
  if (chainId !== BASE_CHAIN_ID) usage(`${rpc.origin} is chain ${chainId}, not Base mainnet (${BASE_CHAIN_ID})`);
  const finalized = await client.getBlock({ blockTag: "finalized" });
  if (finalized.number === null || finalized.hash === null) throw new Error(`${rpc.origin} gave a finalized block with no number or hash`);

  const previous = !values.fresh && existsSync(OUT) ? (JSON.parse(readFileSync(OUT, "utf8")) as unknown) : undefined;
  const span = LOG_SPAN[rpc.origin] ?? LOG_CHUNK;
  console.error(
    `snapshot: vault ${recorded.vault} on ${rpc.origin}, finalized block ${finalized.number}, ${span}-block chunks${previous ? ", building on the committed file" : ""}`,
  );
  let reported = -1;
  const started = Date.now();
  const snapshot = await takeSnapshot({
    client: client as unknown as LedgerClient,
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
