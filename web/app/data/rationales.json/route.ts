import rationales from "@/content/generated/rationales.json";

// out/data/rationales.json: the agent's rationale texts (npm run rationales). /ledger checks each against the
// rationaleHash of its Decision log before it shows "Hash verified".
export const dynamic = "force-static";

export function GET() {
  return new Response(`${JSON.stringify(rationales, null, 2)}\n`, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
