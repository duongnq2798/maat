import { FACTS } from "@/content/facts";
import { clockLabel } from "@/content/format";

// One week on a 168-hour axis (Mon 00:00 to Sun 24:00, New York time), 300 units wide from x = 10.
const X0 = 10;
const WIDTH = 300;
const x = (hour: number) => X0 + (hour / 168) * WIDTH;
const r1 = (n: number) => Math.round(n * 10) / 10;

const SESSION = FACTS.nyseSessionMin.value;
const EDGE_MIN = FACTS.feedEdgeMin.value;
const FEED_STOP = 4 * 24 + EDGE_MIN / 60; // Fri: Chainlink equity feeds stop
const FEED_START = 6 * 24 + EDGE_MIN / 60; // Sun: they resume
const OPEN = SESSION.open / 60; // NYSE regular session
const CLOSE = SESSION.close / 60;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const SESSION_LABEL = `${clockLabel(SESSION.open)}–${clockLabel(SESSION.close)}`;
const ARIA_LABEL =
  `Weekly chart: Chainlink equity feed live from Sunday ${clockLabel(EDGE_MIN)} to Friday ${clockLabel(EDGE_MIN)} ET, ` +
  `frozen over the weekend; NYSE regular session ${clockLabel(SESSION.open)} to ${clockLabel(SESSION.close)} on weekdays`;

export function WeekChart() {
  return (
    <svg viewBox="0 0 320 112" className="h-auto w-full" role="img" aria-label={ARIA_LABEL}>
      <defs>
        <pattern id="maat-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" className="fill-refuse-tint" />
          <line x1="0" y1="0" x2="0" y2="6" strokeWidth="2" className="stroke-refuse-hatch" />
        </pattern>
      </defs>
      <rect data-part="feed" x={X0} y="22" width={r1(x(FEED_STOP) - X0)} height="16" rx="3" className="fill-accent-soft" />
      <rect
        data-part="frozen"
        x={r1(x(FEED_STOP))}
        y="22"
        width={r1(x(FEED_START) - x(FEED_STOP))}
        height="16"
        fill="url(#maat-hatch)"
      />
      <rect
        data-part="feed"
        x={r1(x(FEED_START))}
        y="22"
        width={r1(X0 + WIDTH - x(FEED_START))}
        height="16"
        rx="2"
        className="fill-accent-soft"
      />
      {DAYS.slice(0, 5).map((d, i) => (
        <rect
          key={d}
          data-part="session"
          x={r1(x(i * 24 + OPEN))}
          y="50"
          width={r1(x(CLOSE) - x(OPEN))}
          height="16"
          rx="2"
          className="fill-accent"
        />
      ))}
      <g fontSize="9" textAnchor="middle" className="fill-ink-2 font-mono">
        {DAYS.map((d, i) => (
          <text key={d} x={r1(x(i * 24 + 12))} y="90">
            {d}
          </text>
        ))}
      </g>
      <text x={r1((x(FEED_STOP) + x(FEED_START)) / 2)} y="15" fontSize="9" textAnchor="middle" className="fill-refuse font-mono">
        frozen
      </text>
      <text x={X0} y="15" fontSize="9" className="fill-ink-2 font-mono">
        feed live
      </text>
      <text x={X0} y="108" fontSize="9" className="fill-accent font-mono">
        {`NYSE ${SESSION_LABEL} ET`}
      </text>
    </svg>
  );
}
