// Relative imports only: source.config.ts loads the modules behind it through the fumadocs-mdx bundler, outside Next.

/**
 * The self-closing MDX components that print data: reference entries, tables, diagrams. They render real
 * components in the HTML, and lib/docs/remark-component-text.ts gives each one its text in the Markdown copies.
 * Callout, Steps and Step are not here: their tags wrap real Markdown text, which a reader still follows.
 */
export const DATA_COMPONENTS = [
  "Fn",
  "FunctionIndex",
  "EventEntry",
  "ErrorEntry",
  "TypeEntry",
  "EnvTable",
  "EnvVar",
  "ScriptEntry",
  "ScriptFile",
  "AddressTable",
  "FactTable",
  "ReasonTable",
  "MandateTable",
  "EventSignature",
  "ForkLedger",
  "RouterCards",
  "SectionIndex",
  "StatusBadge",
  "DecisionLoop",
  "Architecture",
  "TimelockFlow",
  "TreasuryLoop",
  "MultiplierFlow",
  "HealthFactorScale",
  "MarketWeek",
] as const;

export type DataComponent = (typeof DATA_COMPONENTS)[number];
