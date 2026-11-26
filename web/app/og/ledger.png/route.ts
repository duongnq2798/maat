import { renderPageOg } from "@/brand/render";

// /ledger's link preview, out/og/ledger.png, drawn with satori when the site is built (content/page-cards.ts),
// as /ask's is. A static segment, so it never reaches the docs lookup of app/og/[...slug]/route.ts.
export const dynamic = "force-static";

export async function GET() {
  return new Response(new Uint8Array(await renderPageOg("/ledger")), { headers: { "Content-Type": "image/png" } });
}
