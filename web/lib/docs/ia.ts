/**
 * The docs center's pages in sidebar order (docs spec §3), with the exact title and description each page's
 * frontmatter must use. test/docs-ia.test.ts checks content/docs against it; nothing reads it at runtime.
 */
export interface IaPage {
  /** Path under content/docs without .mdx, e.g. "concepts/nine-checks"; the home page is "index". */
  readonly slug: string;
  readonly title: string;
  /** 50 to 160 characters (spec §5.1). */
  readonly description: string;
}

export interface IaSection {
  /** Folder under content/docs; "" for the home page. */
  readonly dir: string;
  /** The sidebar group title, as in the folder's meta.json. */
  readonly title: string;
  readonly pages: readonly IaPage[];
}

const page = (slug: string, title: string, description: string): IaPage => ({ slug, title, description });

export const DOCS_IA: readonly IaSection[] = [
  {
    dir: "",
    title: "Maat docs",
    pages: [
      page(
        "index",
        "Maat docs",
        "Understand Maat, verify every claim against the code, run it, and run your own vault. Pick the path that fits why you came.",
      ),
    ],
  },
  {
    dir: "get-started",
    title: "Get started",
    pages: [
      page(
        "get-started/what-is-maat",
        "What is Maat",
        "The problem with agents that trade tokenized stocks around the clock, and how a mandate onchain decides every trade they propose.",
      ),
      page(
        "get-started/how-a-decision-is-made",
        "How a decision is made",
        "Follow one trade from vault state to the Decision event: the policy, Claude's proposal, the preview, the send and the nine checks.",
      ),
      page(
        "get-started/quickstart",
        "Quickstart: verify Maat in five minutes",
        "Clone the repo and run the refusal test, the contract suites, the agent tests and the site build offline. No wallet, RPC or API key.",
      ),
      page(
        "get-started/read-a-decision",
        "Read a decision",
        "What each field of a Decision event means, how to read a refusal, and how to match a ledger row to its transaction and rationale.",
      ),
      page(
        "get-started/status",
        "Status and roadmap",
        "What is built and fork-tested today, what is next before mainnet, and what is planned but not built, with what each step needs.",
      ),
    ],
  },
  {
    dir: "concepts",
    title: "Concepts",
    pages: [
      page(
        "concepts/mandate",
        "The mandate",
        "Every field of the onchain mandate: what it limits, its default value and unit, why that value, and which check reads it.",
      ),
      page(
        "concepts/nine-checks",
        "The nine checks",
        "The order in which the vault checks a trade, what each check reads, and the reason code it returns when it fails.",
      ),
      page(
        "concepts/refusal-codes",
        "Refusal codes",
        "All refusal reasons the vault can record: what each means, which actions can return it, where it is raised and how the agent reacts.",
      ),
      page(
        "concepts/market-hours",
        "Market hours",
        "How the onchain calendar decides the NYSE session in New York time, with daylight saving, holidays, early closes and the feed edge.",
      ),
      page(
        "concepts/prices-and-premium",
        "Prices and premium",
        "How the vault reads Chainlink equity feeds and the Aerodrome pool TWAP, measures the premium between them and rejects stale prices.",
      ),
      page(
        "concepts/splits-and-multiplier",
        "Splits and the multiplier",
        "Why a change to a B20 token's uiMultiplier pauses trading in it, how the vault detects one, and why unreadable values fail closed.",
      ),
      page(
        "concepts/credit-and-health-factor",
        "Credit and the health factor",
        "How the vault supplies stock to Aave V4, borrows USDC against it, and keeps the health factor above its floor before weekends.",
      ),
      page(
        "concepts/timelock-and-roles",
        "Timelock and roles",
        "Who can do what: owner, executor and payees. How rule changes are queued, applied or cancelled, and what a leaked key can do.",
      ),
      page(
        "concepts/treasury-loop",
        "The treasury loop",
        "How the agent keeps its basket, supplies idle stock, borrows for runway and pays its own compute bill, and what is still planned.",
      ),
    ],
  },
  {
    dir: "guides",
    title: "Guides",
    pages: [
      page(
        "guides/run-the-tests",
        "Run the tests",
        "Run the contract unit and fork suites, the agent unit and fork tests, and the website checks, with what each one needs to run.",
      ),
      page(
        "guides/reproduce-the-fork-run",
        "Reproduce the fork run",
        "Rerun the end-to-end agent test on a Base mainnet fork and read its decisions, its trace and the gas log it writes.",
      ),
      page(
        "guides/deploy-your-own-vault",
        "Deploy your own vault",
        "Deploy a vault with the default mandate: dry-run it on a fork first, then broadcast to Base mainnet from your own wallet.",
      ),
      page(
        "guides/configure-a-mandate",
        "Configure a mandate",
        "Change the limits, tokens and payees before you deploy, and understand the validation errors the vault raises for a bad config.",
      ),
      page(
        "guides/run-the-agent",
        "Run the agent",
        "Configure and start the agent loop: dry-run and live modes, its settings, the CDP wallet, the Builder Code and its daily limits.",
      ),
      page(
        "guides/change-a-rule",
        "Change a rule",
        "Queue a mandate, token or payee change, wait out the timelock, then apply or cancel it and check the new policy hash.",
      ),
      page(
        "guides/pause-withdraw-recover",
        "Pause, withdraw and recover",
        "The emergency playbook: pause the vault, rotate the executor, withdraw funds and unwind a credit position, step by step.",
      ),
      page(
        "guides/watch-decisions-onchain",
        "Watch decisions onchain",
        "Read Decision events from a vault with cast or viem, decode the action and reason, and match them to the agent's journal.",
      ),
    ],
  },
  {
    dir: "reference",
    title: "Reference",
    pages: [
      page(
        "reference/mandate-vault",
        "MandateVault",
        "Every external and public function of MandateVault: its signature, who may call it, what it changes, and how it reverts or refuses.",
      ),
      page(
        "reference/events",
        "Events",
        "Every event the vault, the calendar and the adapters emit, with each parameter and when the event is emitted.",
      ),
      page(
        "reference/errors",
        "Errors",
        "Every custom error in Maat's contracts and adapters, with its parameters and the condition that raises it.",
      ),
      page(
        "reference/types",
        "Types",
        "The Intent, Mandate and TokenConfig structs and the Action, Reason and SessionMode enums, field by field and member by member.",
      ),
      page(
        "reference/market-calendar",
        "MarketCalendar",
        "The calendar contract's functions, the holidays and early closes it ships with, and the rule that it can only get stricter.",
      ),
      page(
        "reference/adapters",
        "Adapters",
        "The swap and credit adapter interfaces, and the Aerodrome Slipstream and Aave V4 adapters that implement them for Base.",
      ),
      page(
        "reference/agent-configuration",
        "Agent configuration",
        "Every environment variable the agent reads: whether it is required, its default, and what it changes in the loop.",
      ),
      page(
        "reference/agent-scripts",
        "Agent scripts",
        "The npm scripts in the agent package: what each runs, the modes they take, what they need and how they exit.",
      ),
      page(
        "reference/base-addresses",
        "Base addresses",
        "The Base mainnet tokens, Chainlink feeds, Aerodrome pools and Aave V4 contracts Maat uses, with links to Basescan.",
      ),
      page(
        "reference/default-parameters",
        "Default parameters",
        "Every default the vault, the calendar and the agent ship with, with its unit and the source file that sets it.",
      ),
    ],
  },
  {
    dir: "security",
    title: "Security",
    pages: [
      page(
        "security/model",
        "Security model",
        "What the vault enforces, in which code, and why neither Claude nor a stolen executor key can get around it.",
      ),
      page(
        "security/threat-model",
        "Threat model",
        "The assets, the actors and what each one could do with a leaked key, from the owner to the Claude API key, and the mitigations.",
      ),
      page(
        "security/not-claimed",
        "What Maat does not claim",
        "No audit, no mainnet deployment yet, and the known limitations: what can still go wrong and what is out of scope.",
      ),
      page(
        "security/testing",
        "How it is tested",
        "How each guarantee is tested: contract unit and fork suites, agent tests, parity tests between the site and the code.",
      ),
      page(
        "security/report-a-vulnerability",
        "Report a vulnerability",
        "How to report a security problem in Maat privately, what to include, and what to expect after you report it.",
      ),
    ],
  },
  {
    dir: "help",
    title: "Help",
    pages: [
      page(
        "help/faq",
        "FAQ",
        "Short answers to the questions people ask about Maat, from what it is to how it is tested, each linking to the page that proves it.",
      ),
      page(
        "help/troubleshooting",
        "Troubleshooting",
        "Fixes for problems that happened while building and testing Maat: line endings, Foundry versions, fork RPCs, submodules and gas.",
      ),
      page(
        "help/glossary",
        "Glossary",
        "Plain definitions of the terms used across the docs, from B20 and uiMultiplier to TWAP, health factor, Builder Code and the feed edge.",
      ),
      page(
        "help/changelog",
        "Changelog",
        "Maat's milestones, newest first: what each one added, when, and where to read the code and the spec behind it.",
      ),
    ],
  },
];

/** Every page slug, in sidebar order. */
export const IA_SLUGS: readonly string[] = DOCS_IA.flatMap((s) => s.pages.map((p) => p.slug));
