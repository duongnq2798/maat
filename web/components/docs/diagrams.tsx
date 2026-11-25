import { FACTS } from "@/content/facts";
import {
  ARCHITECTURE,
  DECISION_LOOP,
  type FlowStep,
  HEALTH_FACTOR_SCALE,
  MARKET_WEEK_CAPTION,
  MARKET_WEEK_MODES,
  MULTIPLIER_FLOW,
  type ScaleBand,
  type ScaleData,
  TIMELOCK_FLOW,
  TREASURY_LOOP,
} from "@/lib/docs/flows";

export type { FlowStep };

// Docs diagrams. Each one is real text in an ordered list or a labelled grid, so it reads the same to a
// screen reader, to search and to a reader on a 360 px phone; numbers come from FACTS through factFor.
// The words of each diagram live in lib/docs/flows.ts, which the Markdown copies of the pages print too.

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
  return <Flow {...DECISION_LOOP} />;
}

export function Architecture() {
  return <Flow {...ARCHITECTURE} />;
}

export function TimelockFlow() {
  return <Flow {...TIMELOCK_FLOW} />;
}

export function TreasuryLoop() {
  return <Flow {...TREASURY_LOOP} />;
}

export function MultiplierFlow() {
  return <Flow {...MULTIPLIER_FLOW} />;
}

// Complete literal class strings, so Tailwind's scanner sees every class. Allowed takes the blue of an open session.
const TONE_CLASSES: Record<ScaleBand["tone"], string> = {
  refused: "bg-fd-error",
  conditional: "bg-fd-warning",
  allowed: "bg-fd-primary",
};

/**
 * Ranges of one value, highest first, each with what the vault does there: a ladder that reads the same from the top on
 * a 360 px phone and in a wide column. Each range's coloured edge repeats the verdict its title or detail gives, so no
 * verdict is told by colour alone.
 */
export function Scale({ label, bands, caption }: ScaleData) {
  return (
    <figure className="not-prose my-8">
      <ol aria-label={label} className="divide-y divide-fd-border overflow-hidden rounded-xl border border-fd-border bg-fd-card">
        {bands.map((b) => (
          <li key={b.range} className="flex">
            <span aria-hidden="true" data-tone={b.tone} className={`w-1.5 shrink-0 ${TONE_CLASSES[b.tone]}`} />
            <div className="min-w-0 p-4">
              <p className="font-mono text-xs text-fd-muted-foreground">{b.range}</p>
              <p className="mt-1 wrap-break-word font-medium text-fd-card-foreground">{b.title}</p>
              <p className="mt-1 wrap-break-word text-sm leading-6 text-fd-muted-foreground">{b.detail}</p>
            </div>
          </li>
        ))}
      </ol>
      <figcaption className="mt-3 text-sm text-fd-muted-foreground">{caption}</figcaption>
    </figure>
  );
}

export function HealthFactorScale() {
  return <Scale {...HEALTH_FACTOR_SCALE} />;
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
  const rows = MARKET_WEEK_MODES.map((m) => ({ ...m, days: week[m.mode] }));
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
      <figcaption className="mt-3 text-sm text-fd-muted-foreground">{MARKET_WEEK_CAPTION}</figcaption>
    </figure>
  );
}
