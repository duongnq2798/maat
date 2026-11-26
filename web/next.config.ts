import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";

// A static site (web spec §5.1). The W2 ledger reads Base from the visitor's browser, so it stays one (W2 spec).
const config: NextConfig = {
  output: "export",
  // Two root layouts, (site) and (docs), so the 404 for unmatched URLs comes from app/global-not-found.tsx.
  experimental: { globalNotFound: true },
  // The docs' link preview images (app/og/[...slug]/route.ts) are drawn with resvg, a native Node addon that Turbopack
  // cannot bundle, so the build loads it from node_modules.
  serverExternalPackages: ["@resvg/resvg-js"],
};

export default createMDX()(config);
