const STACK = ["Base", "B20 stocks", "Chainlink", "Aerodrome", "Aave V4", "Coinbase CDP", "Claude"] as const;

export function BuiltOn() {
  return (
    <section aria-label="Built with" className="border-y border-line">
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
