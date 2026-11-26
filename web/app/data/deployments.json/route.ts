import { deploymentsFile } from "@/lib/chain/config";
import { docsData } from "@/lib/docs/generated";

// out/data/deployments.json: the table of deployments/README.md and the vault the /ledger page reads. The page fetches
// it at runtime rather than baking the address into its bundle, so the e2e suite can serve a vault to the real build.
export const dynamic = "force-static";

export function GET() {
  return new Response(`${JSON.stringify(deploymentsFile(docsData.deployments), null, 2)}\n`, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
