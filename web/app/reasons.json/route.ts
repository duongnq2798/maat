import { reasonsFile } from "@/content/reasons";
import { siteUrl } from "@/lib/site";

// out/reasons.json: every refusal reason a MandateVault can record in a Decision, with its enum id, meaning, group,
// checklist line and the contract lines that return it, for agents and tools that decode a Decision. Exported once at
// build time from content/reasons.ts; test/reasons-json.test.ts holds the lines to contracts/src.
export const dynamic = "force-static";

export function GET() {
  return new Response(`${JSON.stringify(reasonsFile(siteUrl()), null, 2)}\n`, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
