import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// out/data/briefs-snapshot.json: the committed snapshot of MaatInbox's Brief logs (npm run snapshot), which /ask and
// /proof start their read of the Brief logs from. The build only copies the file and never asks Base for it, so an RPC
// that is down cannot fail a deploy. Without the file it serves null, and the pages read every block from the deploy.
export const dynamic = "force-static";

const FILE = join(process.cwd(), "content/generated/briefs-snapshot.json");

export function GET() {
  return new Response(existsSync(FILE) ? readFileSync(FILE, "utf8") : "null\n", {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
