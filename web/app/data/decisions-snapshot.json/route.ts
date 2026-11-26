import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// out/data/decisions-snapshot.json: the committed snapshot of the vault's logs (npm run snapshot), which /ledger and
// the landing start a first read from. The build only copies the file and never asks Base for it, so an RPC that is
// down cannot fail a deploy. Without the file it serves null, and the page reads every block from the deploy.
export const dynamic = "force-static";

const FILE = join(process.cwd(), "content/generated/decisions-snapshot.json");

export function GET() {
  return new Response(existsSync(FILE) ? readFileSync(FILE, "utf8") : "null\n", {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
