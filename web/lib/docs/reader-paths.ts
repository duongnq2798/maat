// Relative imports only: source.config.ts loads this file through the fumadocs-mdx bundler, outside Next.

export interface ReaderPath {
  readonly reader: string;
  readonly want: string;
  /** Docs slug of the first page, as in content/docs. */
  readonly slug: string;
  readonly cta: string;
}

/** One path per reader in the docs spec section 1, each naming its first page. */
export const READER_PATHS: readonly ReaderPath[] = [
  { reader: "New to Maat", want: "Know what it is and why it matters.", slug: "get-started/what-is-maat", cta: "What is Maat" },
  { reader: "Watching the agent", want: "Understand a Decision, as shown in the fork ledger.", slug: "get-started/read-a-decision", cta: "Read a decision" },
  { reader: "Developer or judge", want: "Verify the claims and read the code.", slug: "get-started/quickstart", cta: "Verify it in five minutes" },
  { reader: "Builder", want: "Run your own vault and agent.", slug: "guides/deploy-your-own-vault", cta: "Deploy your own vault" },
  { reader: "Evaluator or partner", want: "Decide whether to trust it or build on it.", slug: "security/model", cta: "Security model" },
];
