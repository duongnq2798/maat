import { FACTS } from "@/content/facts";
import { factFor } from "@/lib/docs/fact-text";

// Docs diagrams. Each one is real text in an ordered list or a labelled grid, so it reads the same to a
// screen reader, to search and to a reader on a 360 px phone; numbers come from FACTS through factFor.

const f = (name: Parameters<typeof factFor>[0]) => factFor(name).text;

export interface FlowStep {
  readonly title: string;
  readonly detail: string;
}

// Each variant is a complete literal class string, so Tailwind's scanner sees every class.
const FLOW_CLASSES = {
  // Up to 4 steps go side by side once the diagram itself is 42rem wide.
  narrow: {
    list: "grid gap-4 @2xl:auto-cols-fr @2xl:grid-flow-col",
    arrow:
      "absolute -bottom-4 left-1/2 z-10 -translate-x-1/2 text-fd-primary @2xl:-right-4 @2xl:bottom-auto @2xl:left-auto @2xl:top-1/2 @2xl:-translate-y-1/2 @2xl:translate-x-0",
    down: "@2xl:hidden",
    right: "hidden @2xl:inline",
  },
  // 5 or more steps need 48rem.
  wide: {
    list: "grid gap-4 @3xl:auto-cols-fr @3xl:grid-flow-col",
    arrow:
      "absolute -bottom-4 left-1/2 z-10 -translate-x-1/2 text-fd-primary @3xl:-right-4 @3xl:bottom-auto @3xl:left-auto @3xl:top-1/2 @3xl:-translate-y-1/2 @3xl:translate-x-0",
    down: "@3xl:hidden",
    right: "hidden @3xl:inline",
  },
} as const;

/**
 * Numbered steps with arrows between them: top to bottom, and side by side once the diagram itself is wide
 * enough (a container query on the figure, not the viewport, because the docs sidebar and table of contents
 * narrow the article well below the viewport width).
 */
export function Flow({ label, steps, caption }: { label: string; steps: readonly FlowStep[]; caption?: string }) {
  const classes = steps.length > 4 ? FLOW_CLASSES.wide : FLOW_CLASSES.narrow;
  return (
    <figure className="@container not-prose my-8">
      <ol aria-label={label} className={classes.list}>
        {steps.map((s, i) => (
          <li key={s.title} className="relative min-w-0 rounded-xl border border-fd-border bg-fd-card p-4">
            <span className="font-mono text-xs text-fd-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
            <p className="mt-1 wrap-break-word font-medium text-fd-card-foreground">{s.title}</p>
            <p className="mt-1 wrap-break-word text-sm leading-6 text-fd-muted-foreground">{s.detail}</p>
            {i < steps.length - 1 ? (
              <span aria-hidden="true" className={classes.arrow}>
                <span className={classes.down}>↓</span>
                <span className={classes.right}>→</span>
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      {caption ? <figcaption className="mt-3 text-sm text-fd-muted-foreground">{caption}</figcaption> : null}
    </figure>
  );
}

export function DecisionLoop() {
  return (
    <Flow
      label="How one round of the agent loop reaches a decision"
      steps={[
        { title: "Read the vault", detail: "Balances, prices, the mandate and the market, all at one block." },
        { title: "Policy, then Claude", detail: "Rules suggest trades. Claude proposes intents, each with a rationale." },
        { title: "Preview, then send", detail: "Each intent is previewed first, so the agent spends gas only on calls worth sending." },
        {
          title: "The vault decides",
          detail: `${f("checksPerTrade")} checks run in the contract. A Decision event records the verdict.`,
        },
      ]}
      caption={`The agent runs this every ${f("loopMinutes")} in session and every ${f("offSessionMinutes")} outside. Only the vault's checks are trusted.`}
    />
  );
}

export function Architecture() {
  return (
    <Flow
      label="Who does what, from Claude to the Base protocols"
      steps={[
        { title: "Claude", detail: "Proposes intents as JSON that must match a schema." },
        { title: "Agent", detail: "Validates, previews and sends only vault calls, with the Builder Code." },
        { title: "CDP wallet", detail: "Signs only zero-value transactions to the vault, on Base." },
        { title: "MandateVault", detail: "Runs the checks and records every decision." },
        { title: "Base protocols", detail: "Aerodrome swaps, Aave V4 credit, Chainlink prices." },
      ]}
      caption="Only the vault moves funds, and it runs every check itself. A stolen agent key faces the same rules."
    />
  );
}

export function TimelockFlow() {
  return (
    <Flow
      label="How a rule change goes through the timelock"
      steps={[
        { title: "Queue", detail: "The owner queues the new values. An event records their hash." },
        { title: "Wait", detail: `Nothing can apply it for ${f("timelockHours")}.` },
        { title: "Apply or cancel", detail: `Apply the exact queued values within ${f("gracePeriodDays")}, or cancel.` },
        { title: "Or expire", detail: "After that window, applying reverts and the change must be queued again." },
      ]}
      caption="Pausing, rotating the executor and withdrawing to the owner are instant. Changing a rule never is."
    />
  );
}

export function TreasuryLoop() {
  return (
    <Flow
      label="The treasury loop the agent runs"
      steps={[
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
      ]}
      caption="Earning from x402 safety checks is planned and not built."
    />
  );
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
type Segment = readonly [start: number, end: number];
const DAY_MIN = 1440;

/** Minutes after midnight ET when each session mode is open, Monday first. Holidays and early closes not shown. */
export function marketWeek(): Record<"REGULAR" | "FEED_24_5", readonly (readonly Segment[])[]> {
  const { open, close } = FACTS.nyseSessionMin.value;
  const edge = FACTS.feedEdgeMin.value;
  const weekday = (d: number) => d < 5;
  return {
    REGULAR: DAYS.map((_, d) => (weekday(d) ? [[open, close] as const] : [])),
    // Chainlink equity feeds run from Sunday at the feed edge to Friday at the feed edge.
    FEED_24_5: DAYS.map((_, d) =>
      d < 4 ? [[0, DAY_MIN] as const] : d === 4 ? [[0, edge] as const] : d === 6 ? [[edge, DAY_MIN] as const] : [],
    ),
  };
}

export function MarketWeek() {
  const week = marketWeek();
  const rows = [
    { mode: "REGULAR", text: `Monday to Friday, ${f("nyseOpen")} to ${f("nyseClose")}.`, days: week.REGULAR },
    { mode: "FEED_24_5", text: `Sunday ${f("feedEdge")} to Friday ${f("feedEdge")}, around the clock.`, days: week.FEED_24_5 },
  ];
  return (
    <figure className="not-prose my-8 rounded-xl border border-fd-border bg-fd-card p-4">
      <div aria-hidden="true" className="grid grid-cols-[5.5rem_repeat(7,1fr)] gap-1 text-center text-xs text-fd-muted-foreground">
        <span />
        {DAYS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      {rows.map((r) => (
        <div key={r.mode} className="mt-3">
          <div aria-hidden="true" className="grid grid-cols-[5.5rem_repeat(7,1fr)] items-center gap-1">
            <span className="font-mono text-xs text-fd-card-foreground">{r.mode}</span>
            {r.days.map((segments, d) => (
              <span key={DAYS[d]} className="relative h-3 rounded-sm bg-fd-muted" data-open-segments={segments.length}>
                {segments.map(([start, end]) => (
                  <span
                    key={start}
                    className="absolute inset-y-0 rounded-sm bg-fd-primary"
                    style={{ left: `${(start / DAY_MIN) * 100}%`, width: `${((end - start) / DAY_MIN) * 100}%` }}
                  />
                ))}
              </span>
            ))}
          </div>
          <p className="mt-1 text-sm text-fd-muted-foreground">
            <span className="font-mono text-fd-card-foreground">{r.mode}</span> is open {r.text}
          </p>
        </div>
      ))}
      <figcaption className="mt-3 text-sm text-fd-muted-foreground">
        New York time, one bar per day from midnight to midnight. Holidays and early closes are not shown.
      </figcaption>
    </figure>
  );
}
