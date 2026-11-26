// Renders the Weighing card of one vault Decision: a 1600x900 and a 1080x1350 PNG (lib/card/cli.ts, brand/card.tsx).
// A transaction hash is read from Base mainnet over the ledger's keyless RPCs, read-only; --fixture renders a fork,
// simulated or preview transaction from a file, with its band on the image. The cards go to the build-in-public image
// folder at the repo root, which git ignores, unless --out names another.
//
// Usage (in web/): npm run card -- <txhash> [--out DIR]
//                  npm run card -- --fixture FILE [--out DIR]
import deployments from "../content/generated/deployments.json";
import { CARD_USAGE, DEFAULT_OUT_DIR, runCard, UsageError } from "../lib/card/cli";
import { deploymentConfig } from "../lib/chain/config";
import { inboxDeployment } from "../lib/chain/inbox";
import { createLedgerClient, DEFAULT_RPCS } from "../lib/chain/rpc";

const vault = deploymentConfig(deployments);

runCard(process.argv.slice(2), {
  client: () => createLedgerClient(DEFAULT_RPCS),
  sources: vault && { vault: vault.vault, deployTx: vault.deployTx, inbox: inboxDeployment(deployments) },
  defaultOut: DEFAULT_OUT_DIR,
  log: (line) => console.log(line),
}).catch((e: unknown) => {
  console.error(`card: ${e instanceof Error ? e.message : String(e)}`);
  if (e instanceof UsageError) console.error(CARD_USAGE);
  process.exit(1);
});
