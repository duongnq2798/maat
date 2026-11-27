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
      detail: `Up to ${f("checksPerTrade")} checks run in the contract for a BUY or a SELL. A Decision event records the verdict.`,
    },
  ],
  caption: `The agent is built to run this every ${f("loopMinutes")} in session and every ${f("offSessionMinutes")} outside. Only the vault's checks are trusted.`,
};

export const ARCHITECTURE: FlowData = {
  label: "Who does what, from Claude to the Base protocols",
  steps: [
    { title: "Claude", detail: "Proposes intents as JSON that must match a schema." },
    { title: "Agent", detail: "Validates, previews and sends only vault calls, with the Builder Code." },
    { title: "CDP wallet", detail: "Live-mode signer. Its policy allows only zero-value transactions to the vault, and sends only on Base." },
    { title: "MandateVault", detail: "Runs the checks and records its verdict on every execute that does not revert." },
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
  caption:
    "Pausing, rotating the executor, withdrawing to the owner, and adding a holiday or an earlier close to the calendar are instant. Changing the mandate, a stock's settings or a payee never is.",
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
      detail: `USDC, when cash covers less than ${f("runwayDays")} of compute plus unpaid bills. Only in session, and only if the projected health factor stays at or above ${f("mandate.minHealthFactor")}, or ${f("mandate.targetHealthFactor")} in the de-risk window.`,
    },
    { title: "Pay", detail: "Its own Claude bill in USDC, to an allowlisted payee, at any hour." },
  ],
  caption: "Earning from x402 safety checks is not built, and was dropped for this season.",
};

// The order of GuardLib.multiplierBlocked: the snapshot check blocks before anything is recorded, and the cooldown
// counts from the recording (MandateVault._recordMultiplier) and from effectiveAt(). The long names, MULTIPLIER_COOLDOWN
// and MultiplierChangeDetected, are left to the caption and the page: in a card of a four-column flow they break in two.
export const MULTIPLIER_FLOW: FlowData = {
  label: "How a multiplier change blocks a stock",
  steps: [
    {
      title: "The token changes",
      detail:
        "Its uiMultiplier no longer matches the vault's snapshot, or it schedules a change with an effectiveAt() in the future. The stock is blocked at once, before anything is recorded.",
    },
    {
      title: "The vault records it",
      detail:
        "When the value has changed, a syncMultiplier from anyone, an execute that names the stock, or an applyTokenConfig for it stores the new value and emits an event. The cooldown counts from this recording.",
    },
    {
      title: "The cooldown",
      detail: `The stock stays blocked until the cooldown, ${f("mandate.multiplierCooldownSec")} by default, has passed since the recording and, for a scheduled change, since effectiveAt().`,
    },
    { title: "Allowed again", detail: "The multiplier check passes. Every other check still applies." },
  ],
  caption:
    "The block covers BUY and SELL of the stock, and BORROW and WITHDRAW_COLLATERAL against debt while the stock is supplied as collateral. Those actions return MULTIPLIER_COOLDOWN once every check before the multiplier check passes.",
};

/** One range of a scale: its bounds, what the vault does there, and how the diagram colours that verdict. */
export interface ScaleBand {
  readonly range: string;
  readonly title: string;
  readonly detail: string;
  /**
   * Refused, refused only some of the time, or allowed. The colour repeats the verdict its title or detail gives; it
   * never stands alone.
   */
  readonly tone: "refused" | "conditional" | "allowed";
}

export interface ScaleData {
  readonly label: string;
  /** Highest first, as the scale reads from the top. */
  readonly bands: readonly ScaleBand[];
  readonly caption: string;
}

const hfBound = f("healthFactorBound");
const hfFloor = f("mandate.minHealthFactor");
const hfTarget = f("mandate.targetHealthFactor");

// MandateVault._healthReason, and _requireValidCredit for the lowest floor a mandate with a credit adapter may set.
// A withdrawal has no projection: AaveV4CreditAdapter.withdraw calls the spoke before its own check, MockSpoke refuses
// below 1.0, and _creditFailure makes any revert but a 68-byte HealthFactorTooLow CREDIT_FAILED; below 1.0, a spoke
// that lets it through leaves the adapter's HealthFactorTooLow, which _healthReason makes HEALTH_FACTOR_LOW.
export const HEALTH_FACTOR_SCALE: ScaleData = {
  label: "What the vault returns for the health factor a BORROW, or a WITHDRAW_COLLATERAL against debt, would leave",
  bands: [
    {
      range: `${hfTarget} and above`,
      title: "Allowed",
      detail:
        "At or above the target, targetHealthFactor: allowed, inside the de-risk window too. The action's other checks still apply.",
      tone: "allowed",
    },
    {
      range: `${hfFloor} to under ${hfTarget}`,
      title: "DERISK_WINDOW in the window",
      detail: "From the floor up to the target: allowed outside the de-risk window, DERISK_WINDOW inside it.",
      tone: "conditional",
    },
    {
      range: `${hfBound} to under ${hfFloor}`,
      title: "HEALTH_FACTOR_LOW",
      detail: "Below the floor, minHealthFactor: refused, inside the de-risk window or not.",
      tone: "refused",
    },
    {
      range: `Below ${hfBound}`,
      title: "Below the lowest floor allowed",
      detail: `A mandate with a credit adapter cannot set its floor here: the vault rejects it with InvalidConfig. A BORROW projected to land here returns HEALTH_FACTOR_LOW. A WITHDRAW_COLLATERAL is not projected, and the adapter asks the spoke to withdraw before it checks the health factor. If the spoke refuses first, as the mock Aave spoke in the unit tests does below ${hfBound}, the vault returns CREDIT_FAILED. If the spoke lets it through, the adapter's own check refuses it and the vault returns HEALTH_FACTOR_LOW.`,
      tone: "refused",
    },
  ],
  caption: `Shown with the default floor and target. A mandate with a credit adapter can set others, as long as the floor is at least ${hfBound} and the target is at least the floor. SUPPLY and REPAY are never refused for the health factor.`,
};

/** When each session mode is open, in words, one entry per bar of the market-week diagram. */
export const MARKET_WEEK_MODES = [
  { mode: "REGULAR", text: `Monday to Friday, ${f("nyseOpen")} to ${f("nyseClose")}.` },
  { mode: "FEED_24_5", text: `Sunday ${f("feedEdge")} to Friday ${f("feedEdge")}, around the clock.` },
] as const;

export const MARKET_WEEK_CAPTION = "New York time, one bar per day from midnight to midnight. Holidays and early closes are not shown.";
