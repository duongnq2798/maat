import { ASK_OPEN } from "@/content/ask-open";

// out/data/ask.json: the owner's switch for /ask (content/ask-open.ts). The page reads it at runtime, as it reads
// /data/deployments.json, so the e2e suite can open the page on the real build.
export const dynamic = "force-static";

export function GET() {
  return new Response(`${JSON.stringify({ open: ASK_OPEN }, null, 2)}\n`, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
