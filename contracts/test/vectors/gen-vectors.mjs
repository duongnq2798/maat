// Writes the JSON vectors that contracts/test/MarketCalendarVectors.t.sol checks MarketCalendar against.
//
// Regenerate from the repository root with Node 24 (no dependencies):
//
//   node contracts/test/vectors/gen-vectors.mjs
//
// then run `forge test --match-path test/MarketCalendarVectors.t.sol` in contracts/. Times come from
// Intl.DateTimeFormat with timeZone America/New_York, that is the IANA time zone data in Node's ICU, so the
// vectors do not share any date logic with the contract. The output is deterministic: rerunning it on the same
// Node must leave both files unchanged.
//
//   us-eastern-dst.json   every US Eastern DST start and end from 2007 (the current rule) to 2100, to the second
//   nyse-calendar.json    the NYSE closures MarketCalendar's constructor preloads, with isOpen expectations at
//                         fixed ET times on each date
import { writeFileSync } from "node:fs";

const OUT = new URL("./", import.meta.url);
const ZONE = "America/New_York";
const DAY = 86_400;
const EDT = 4 * 3600; // seconds New York is behind UTC during daylight saving time
const EST = 5 * 3600;

const wallClock = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Seconds New York's wall clock is behind UTC at Unix time t. */
function behindUtc(t) {
  const p = Object.fromEntries(wallClock.formatToParts(new Date(t * 1000)).map((x) => [x.type, x.value]));
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return t - wall / 1000;
}

const iso = (t) => new Date(t * 1000).toISOString().replace(".000Z", "Z");

/** The first second in (lo, hi] whose offset differs from lo's. */
function firstChange(lo, hi) {
  const before = behindUtc(lo);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (behindUtc(mid) === before) lo = mid;
    else hi = mid;
  }
  return hi;
}

function dstTransitions(year) {
  const changes = [];
  const end = Date.UTC(year + 1, 0, 1) / 1000;
  for (let t = Date.UTC(year, 0, 1) / 1000; t < end; t += DAY) {
    if (behindUtc(t) !== behindUtc(t + DAY)) changes.push(firstChange(t, t + DAY));
  }
  const [start, stop] = changes;
  if (changes.length !== 2 || behindUtc(start) !== EDT || behindUtc(stop) !== EST || behindUtc(start - 1) !== EST) {
    throw new Error(`${year}: expected one DST start and one end, got ${changes.map(iso).join(", ")}`);
  }
  // Keys in alphabetical order, the order vm.parseJson decodes them into a struct.
  return { end: stop, endUtc: iso(stop), start, startUtc: iso(start), year };
}

// ------------------------------------------------------------------ NYSE closures

// As MarketCalendar's constructor encodes them, names from its comments. A change to the contract's list must
// change this list too, or the test fails.
const HOLIDAYS = [
  ["2026-11-26", "Thanksgiving"],
  ["2026-12-25", "Christmas"],
  ["2027-01-01", "New Year"],
  ["2027-01-18", "Martin Luther King Jr. Day"],
  ["2027-02-15", "Washington's Birthday"],
  ["2027-03-26", "Good Friday"],
  ["2027-05-31", "Memorial Day"],
  ["2027-06-18", "Juneteenth (observed)"],
  ["2027-07-05", "Independence Day (observed)"],
  ["2027-09-06", "Labor Day"],
  ["2027-11-25", "Thanksgiving"],
  ["2027-12-24", "Christmas (observed)"],
];
const EARLY_CLOSES = [
  ["2026-11-27", 780], // 13:00 ET
  ["2026-12-24", 780],
  ["2027-11-26", 780],
];
// The window the test scans day by day: no other day in it may be a holiday or an early close.
const FIRST_DATE = "2026-01-01";
const LAST_DATE = "2027-12-31";
const CHECK_TIMES = ["09:29", "09:30", "10:30", "12:59", "13:00", "15:59", "16:00"];
const OPEN_MIN = 570;
const CLOSE_MIN = 960;
const FEED_EDGE_MIN = 1200; // Chainlink equity feeds: Sun 20:00 ET to Fri 20:00 ET

const etDay = (date) => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 1000 / DAY;
};

/** Unix time of an ET wall-clock minute (not one inside a DST gap or overlap). */
function etToUtc(date, minute) {
  const wall = etDay(date) * DAY + minute * 60;
  const t = wall + behindUtc(wall + EST);
  if (t - behindUtc(t) !== wall) throw new Error(`${date} minute ${minute} is not a single ET instant`);
  return t;
}

function sessionCheck(date, et) {
  const [h, m] = et.split(":").map(Number);
  const minute = h * 60 + m;
  const holiday = HOLIDAYS.some(([d]) => d === date);
  const close = EARLY_CLOSES.find(([d]) => d === date)?.[1] ?? CLOSE_MIN;
  const wd = new Date(etDay(date) * DAY * 1000).getUTCDay(); // 0 = Sunday
  const regularOpen = !holiday && wd >= 1 && wd <= 5 && minute >= OPEN_MIN && minute < close;
  const feedOpen = !holiday && wd !== 6 && (wd !== 0 || minute >= FEED_EDGE_MIN) && (wd !== 5 || minute < FEED_EDGE_MIN);
  return { date, et, etDay: etDay(date), feedOpen, minute, regularOpen, ts: etToUtc(date, minute) };
}

const dates = [...HOLIDAYS.map(([d]) => d), ...EARLY_CLOSES.map(([d]) => d)].sort();

const dst = {
  description: `US Eastern (${ZONE}) daylight saving time: start is the first second of EDT (UTC-4), end the first second back on EST (UTC-5).`,
  generator: "contracts/test/vectors/gen-vectors.mjs",
  transitions: Array.from({ length: 2100 - 2007 + 1 }, (_, i) => dstTransitions(2007 + i)),
};

const nyse = {
  description: "NYSE closures preloaded by MarketCalendar's constructor, and the expected isOpen at fixed ET times on each date.",
  generator: "contracts/test/vectors/gen-vectors.mjs",
  firstDay: etDay(FIRST_DATE),
  firstDate: FIRST_DATE,
  lastDay: etDay(LAST_DATE),
  lastDate: LAST_DATE,
  holidays: HOLIDAYS.map(([date, name]) => ({ date, etDay: etDay(date), name })),
  earlyCloses: EARLY_CLOSES.map(([date, closeMin]) => ({ closeMin, date, etDay: etDay(date) })),
  sessionChecks: dates.flatMap((date) => CHECK_TIMES.map((et) => sessionCheck(date, et))),
};

writeFileSync(new URL("us-eastern-dst.json", OUT), `${JSON.stringify(dst, null, 2)}\n`);
writeFileSync(new URL("nyse-calendar.json", OUT), `${JSON.stringify(nyse, null, 2)}\n`);
console.log(`${dst.transitions.length} DST years, ${nyse.holidays.length} holidays, ${nyse.earlyCloses.length} early closes, ${nyse.sessionChecks.length} session checks`);
