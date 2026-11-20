import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";

// W1 ships as a static site (spec §5.1). W2 drops `output: "export"` when the ledger reads mainnet server-side.
const config: NextConfig = {
  output: "export",
  // Two root layouts, (site) and (docs), so the 404 for unmatched URLs comes from app/global-not-found.tsx.
  experimental: { globalNotFound: true },
  // The docs' link preview images (app/og/[...slug]/route.ts) are drawn with resvg, a native Node addon that Turbopack
  // cannot bundle, so the build loads it from node_modules.
  serverExternalPackages: ["@resvg/resvg-js"],
};

export default createMDX()(config);
