import { FACTS } from "@/content/facts";

const X0 = 58; // bars start after the symbol labels
const LIMIT_X = 241.3; // where the limit line sits; bars scale so that the limit lands here
const ORDER = ["AAPLc", "GOOGLc", "NVDAc"] as const;
const r1 = (n: number) => Math.round(n * 10) / 10;

export function PremiumChart() {
  const limit = FACTS.mandate.value.maxPremiumBps;
  const premiums = FACTS.premiumsBps.value;
  const scale = (LIMIT_X - X0) / limit;
  const label = `Measured premiums of the DEX TWAP over the Chainlink price in session: ${ORDER.map(
    (s) => `${s} ${premiums[s]}`,
  ).join(", ")} basis points, against a ${limit} basis point limit`;

  return (
    <svg viewBox="0 0 320 112" className="h-auto w-full" role="img" aria-label={label}>
      {ORDER.map((s, i) => {
        const y = 13 + i * 30;
        const w = r1(premiums[s] * scale);
        return (
          <g key={s} data-symbol={s}>
            <text x="0" y={y + 11} fontSize="10" className="fill-ink font-mono">
              {s}
            </text>
            <rect x={X0} y={y} width={w} height="15" rx="3" className="fill-accent" />
            <text x={r1(X0 + w + 6)} y={y + 11} fontSize="10" className="fill-ink-2 font-mono">
              {premiums[s]} bps
            </text>
          </g>
        );
      })}
      <line x1={LIMIT_X} y1="6" x2={LIMIT_X} y2="96" strokeWidth="1.5" strokeDasharray="4 3" className="stroke-refuse" />
      <text x={LIMIT_X} y="108" fontSize="9" textAnchor="middle" className="fill-refuse font-mono">
        limit {limit} bps
      </text>
    </svg>
  );
}
