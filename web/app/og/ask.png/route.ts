import { renderAskOg } from "@/brand/render";

// /ask's link preview, out/og/ask.png, drawn with satori when the site is built (content/ask-card.ts), next to the docs
// pages' images of app/og/[...slug]/route.ts. A static segment, so it never reaches that route's docs lookup.
export const dynamic = "force-static";

export async function GET() {
  return new Response(new Uint8Array(await renderAskOg()), { headers: { "Content-Type": "image/png" } });
}
