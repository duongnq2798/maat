const STACK = ["Base", "B20 stocks", "Chainlink", "Aerodrome", "Aave V4", "Coinbase CDP", "Claude"] as const;

/**
 * The stack Maat is built on, in text only. It closes the landing, just above the footer (spec 2026-11-27, landing
 * "explain in 10 seconds", section 3): credibility, not explanation. The rule under it is the footer's own top border.
 */
export function BuiltOn() {
  return (
    <section aria-label="Built with" className="border-t border-line">
      <div className="wrap flex flex-wrap items-center justify-between gap-x-8 gap-y-4 py-[26px]">
        <span className="font-mono text-xs text-ink-2">BUILT ON</span>
        {STACK.map((name) => (
          <span key={name} className="text-[17px] font-semibold tracking-[-0.02em] text-ink-body">
            {name}
          </span>
        ))}
      </div>
    </section>
  );
}
