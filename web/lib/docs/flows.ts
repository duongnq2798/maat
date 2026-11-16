import { factFor } from "./fact-text";

// Relative imports only: source.config.ts loads this file through the fumadocs-mdx bundler, outside Next.

// The words of the docs diagrams. components/docs/diagrams.tsx draws them; lib/docs/component-text.ts prints the
// same words in the Markdown copies. Numbers come from FACTS through factFor, so a page and the site never disagree.

const f = (name: Parameters<typeof factFor>[0]) => factFor(name).text;

export interface FlowStep {
  readonly title: string;
  readonly detail: string;
}

export interface FlowData {
  readonly label: string;
  readonly steps: readonly FlowStep[];
  readonly caption: string;
}

export const DECISION_LOOP: FlowData = {
  label: "How one round of the agent loop reaches a decision",
  steps: [
    { title: "Read the vault", detail: "Balances, prices, the mandate and the market, all at one block." },
    { title: "Policy, then Claude", detail: "Rules suggest trades. Claude proposes intents, each with a rationale." },
    { title: "Preview, then send", detail: "Each intent is previewed first, so the agent spends gas only on calls worth sending." },
    {
      title: "The vault decides",
      detail: `${f("checksPerTrade")} checks run in the contract. A Decision event records the verdict.`,
    },
  ],
  caption: `The agent is built to run this every ${f("loopMinutes")} in session and every ${f("offSessionMinutes")} outside. Only the vault's checks are trusted.`,
};

export const ARCHITECTURE: FlowData = {
  label: "Who does what, from Claude to the Base protocols",
  steps: [
    { title: "Claude", detail: "Proposes intents as JSON that must match a schema." },
    { title: "Agent", detail: "Validates, previews and sends only vault calls, with the Builder Code." },
    { title: "CDP wallet", detail: "Live-mode signer: only zero-value transactions to the vault, on Base." },
    { title: "MandateVault", detail: "Runs the checks and records every decision." },
    { title: "Base protocols", detail: "Aerodrome swaps, Aave V4 credit, Chainlink prices." },
  ],
  caption: "Only the vault moves funds, and it runs every check itself. A stolen agent key faces the same rules.",
};

export const TIMELOCK_FLOW: FlowData = {
  label: "How a rule change goes through the timelock",
  steps: [
    { title: "Queue", detail: "The owner queues the new values. An event records their hash." },
    { title: "Wait", detail: `Nothing can apply it for ${f("timelockHours")}.` },
    { title: "Apply or cancel", detail: `Apply the exact queued values within ${f("gracePeriodDays")}, or cancel.` },
    { title: "Or expire", detail: "After that window, applying reverts and the change must be queued again." },
  ],
  caption: "Pausing, rotating the executor and withdrawing to the owner are instant. Changing a rule never is.",
};

export const TREASURY_LOOP: FlowData = {
  label: "The treasury loop the agent is built to run",
  steps: [
    {
      title: "Buy",
      detail: `An equal-weight stock basket with ${f("cashReservePct")} kept in USDC, rebalanced past a drift of ${f("rebalanceDriftPct")}.`,
    },
    { title: "Supply", detail: "Idle stock goes to Aave V4 as collateral." },
    {
      title: "Borrow",
      detail: `USDC, when cash covers less than ${f("runwayDays")} of compute. Only in session, and only if the projected health factor stays at or above ${f("mandate.minHealthFactor")}.`,
    },
    { title: "Pay", detail: "Its own Claude bill in USDC, to an allowlisted payee, at any hour." },
  ],
  caption: "Earning from x402 safety checks is planned and not built.",
};

/** When each session mode is open, in words, one entry per bar of the market-week diagram. */
export const MARKET_WEEK_MODES = [
  { mode: "REGULAR", text: `Monday to Friday, ${f("nyseOpen")} to ${f("nyseClose")}.` },
  { mode: "FEED_24_5", text: `Sunday ${f("feedEdge")} to Friday ${f("feedEdge")}, around the clock.` },
] as const;

export const MARKET_WEEK_CAPTION = "New York time, one bar per day from midnight to midnight. Holidays and early closes are not shown.";
