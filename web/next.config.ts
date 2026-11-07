import type { NextConfig } from "next";

// W1 ships as a static site (spec §5.1). W2 drops `output: "export"` when the ledger reads mainnet server-side.
const config: NextConfig = {
  output: "export",
};

export default config;
