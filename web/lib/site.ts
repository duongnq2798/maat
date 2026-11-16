const REPO = "https://github.com/duongnq2798/maat";

/** Site-wide strings shared by the page, its metadata and the export check. */
export const SITE = {
  name: "Maat",
  title: "Maat · The AI agent that knows when not to trade",
  description:
    "Claude proposes every move. An onchain mandate weighs it against market hours, live prices and hard limits. One failed check and the vault says no, on the record.",
  xHandle: "@maatonbase",
  xUrl: "https://x.com/maatonbase",
  repoUrl: REPO,
  /** The docs center, and its offline five-minute check. Plain links: /docs has its own root layout. */
  docsUrl: "/docs",
  quickstartUrl: "/docs/get-started/quickstart",
  /** README anchor: the fork run behind the ledger rows. */
  forkEvidenceUrl: `${REPO}#base-mainnet-fork-evidence`,
  licenseUrl: `${REPO}/blob/main/LICENSE`,
  disclaimer:
    "Maat is an experiment built for Base Stocks Maxxing. It holds only its own treasury, gives no investment advice, confers no shareholder rights and is not offered to US persons.",
  tagline: "Every trade is weighed.",
} as const;

type Env = Record<string, string | undefined>;

/** Absolute base for OG/Twitter URLs: NEXT_PUBLIC_SITE_URL, then the Vercel production domain, then localhost. */
export function siteUrl(env: Env = process.env): URL {
  const explicit = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return new URL(explicit);
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return new URL(`https://${vercel}`);
  return new URL("http://localhost:3000");
}
