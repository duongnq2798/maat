// Where caption numbers come from. Each value is read from a committed file at render time (so a change to the file
// flows into the next render), or from the live site by the capture (CAPTURED). Nothing here is typed in by hand.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (root, rel) => readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n");
const grouped = (n) => n.toLocaleString("en-US");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-19" as "19 Nov 2026". */
const dayLabel = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

/** The frozen-feed figures of one token in one window of a Gap Index edition, as the site prints them. */
export function gapFigures(edition, windowId = "2026-11-06", symbol = "NVDAc") {
  const w = edition.windows.find((x) => x.id === windowId);
  const t = w?.tokens.find((x) => x.symbol === symbol);
  if (!w || !t?.freeze || !t.largestGap) throw new Error(`edition ${edition.edition} has no measured ${symbol} in window ${windowId}`);
  return {
    "gap.close": w.closeLabel,
    "gap.open": w.openLabel,
    "gap.hours": t.freeze.hours.toFixed(2),
    "gap.swaps": grouped(t.freeze.swapsWhileFrozen),
    "gap.gapBps": grouped(Math.abs(t.largestGap.bps)),
    "gap.side": t.largestGap.above ? "above" : "below",
  };
}

/** The rows of the address table at the top of deployments/README.md. */
export function deploymentRows(md) {
  const lines = md.split("\n");
  const head = lines.findIndex((l) => /^\|\s*Network\s*\|\s*Contract\s*\|/.test(l));
  if (head < 0) return [];
  const rows = [];
  for (const line of lines.slice(head + 2)) {
    if (!line.startsWith("|")) break;
    const [network = "", contract = "", address = "", tx = "", date = ""] = line.split("|").slice(1, -1).map((c) => c.trim());
    const hex = (cell, len) => new RegExp(`0x[0-9a-fA-F]{${len}}`).exec(cell)?.[0] ?? "";
    rows.push({ network, contract, address: hex(address, 40), tx: hex(tx, 64), date });
  }
  return rows;
}

/** How the verification note under the deployments table spells a count. */
export const COUNT_WORDS = Object.freeze(["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]);

/** The note under the deployments table: the day Basescan showed a count of contracts verified, and that count. */
const VERIFIED_NOTE = /On (\d{4}-\d{2}-\d{2}), Basescan showed the source of all (\w+) contracts as verified/;
/** A contract's own paragraph: the day Basescan showed its source verified. */
const VERIFIED_OWN = /\bon (\d{4}-\d{2}-\d{2}),? Basescan showed its source as verified/;

/**
 * The day deployments/README.md says Basescan showed each Base mainnet row's source verified, "" where it says none.
 * The note under the table covers the rows deployed on or before its day, and only while their number is exactly the
 * count it gives. A row it does not cover takes the day from its own paragraph: one that names that contract, and no
 * other row's, in backticks. A day before the row's deploy day counts as none.
 */
export function deploymentVerification(md) {
  const rows = deploymentRows(md).filter((r) => r.network === "Base mainnet" && r.address);
  const [, noteIso = "", noted = ""] = VERIFIED_NOTE.exec(md) ?? [];
  const early = noteIso ? rows.filter((r) => r.date !== "" && r.date <= noteIso) : [];
  const covered = new Set(early.length > 0 && COUNT_WORDS.indexOf(noted.toLowerCase()) === early.length ? early : []);
  const paragraphs = md.split(/\n\s*\n/);
  const names = rows.map((r) => r.contract);
  const ownDay = (contract) =>
    paragraphs
      .filter((p) => p.includes(`\`${contract}\``) && names.every((n) => n === contract || !p.includes(`\`${n}\``)))
      .map((p) => VERIFIED_OWN.exec(p)?.[1])
      .find(Boolean) ?? "";
  return rows.map((r) => {
    const iso = covered.has(r) ? noteIso : ownDay(r.contract);
    return { contract: r.contract, address: r.address, date: r.date, verifiedOn: iso !== "" && iso >= r.date ? iso : "" };
  });
}

/**
 * Which contracts Basescan showed verified on which day, in day order, once every row has a day; else "". `label`
 * spells a day. One day for every row reads "all on <day>"; otherwise each day names its contract, or a group's count.
 */
function verifiedPhrase(verified, label) {
  if (verified.length === 0 || verified.some((v) => v.verifiedOn === "")) return "";
  const days = [...new Set(verified.map((v) => v.verifiedOn))].sort();
  if (days.length === 1) return `all on ${label(days[0])}`;
  return days
    .map((day) => {
      const on = verified.filter((v) => v.verifiedOn === day);
      return `${on.length === 1 ? on[0].contract : COUNT_WORDS[on.length]} on ${label(day)}`;
    })
    .join(", ");
}

/** The line under the contracts card: the day each contract's source was shown verified, or "" while a row has none. */
export function verifiedNote(md) {
  const phrase = verifiedPhrase(deploymentVerification(md), (iso) => iso);
  return phrase === "" ? "" : `Basescan showed the source of every contract as verified: ${phrase}.`;
}

/**
 * The deployment figures: how many contracts are on Base mainnet; the day Basescan showed their source verified, only
 * while the note counts as many contracts as the table holds; the days it showed each one verified, only while
 * deployments/README.md gives one for every row; and the inbox's address once the table records it.
 */
export function deploymentFigures(md) {
  const rows = deploymentRows(md).filter((r) => r.network === "Base mainnet" && r.address);
  const [, verifiedOn, noted = ""] = VERIFIED_NOTE.exec(md) ?? [];
  /** @type {Record<string, string>} */
  const out = { "deployments.count": String(rows.length) };
  if (verifiedOn && COUNT_WORDS.indexOf(noted.toLowerCase()) === rows.length) {
    out["deployments.verifiedOnIso"] = verifiedOn;
    out["deployments.verifiedOn"] = dayLabel(verifiedOn);
  }
  const verified = verifiedPhrase(deploymentVerification(md), dayLabel);
  if (verified) out["deployments.verified"] = verified;
  const inbox = rows.find((r) => r.contract === "MaatInbox");
  if (inbox) out["deployments.inbox"] = inbox.address;
  return out;
}

/** Keys a source gives only in some states of its file; a caption tests them with when.present. */
export const OPTIONAL_KEYS = Object.freeze({
  "deployments.inbox": "deployments/README.md has a Base mainnet MaatInbox row",
  "deployments.verifiedOn": "the verification note under the deployments table counts every Base mainnet row",
  "deployments.verifiedOnIso": "the same, as an ISO date",
  "deployments.verified": "deployments/README.md gives the day Basescan showed each Base mainnet row's source verified",
  "ask.open": "the live /ask page, as the capture reads it on beat 7's /ask shot, takes briefs (askOpenValue)",
});

/** What /ask shows in place of the send-brief form until it is open (AskApp's NotOpen block). */
export const ASK_NOT_OPEN_SELECTOR = '[data-ask-state="not-open"]';

/**
 * Whether the live /ask takes briefs: "open" only when the page shows the send-brief form, not its notice "The inbox is
 * not open yet." (`notOpenShown`), and the site's /data/ask.json, the owner's switch (web/content/ask-open.ts at the
 * built commit), says open (`flag`); undefined otherwise, so the invitation caption never sits over a closed page.
 * When the two disagree, `warning` says so and the value claims less.
 * @param {{ notOpenShown: boolean, flag: unknown }} read
 * @returns {{ value: "open" | undefined, warning?: string }}
 */
export function askOpenValue({ notOpenShown, flag }) {
  if (!notOpenShown && flag === true) return { value: "open" };
  if (notOpenShown && flag === false) return { value: undefined };
  return {
    value: undefined,
    warning: `/ask ${notOpenShown ? "shows its not-open notice" : "shows no not-open notice"} while /data/ask.json says ${JSON.stringify(flag)}; beat 7 takes /ask as closed`,
  };
}

const CI_ROWS = {
  "readme.contractTests": "Contract unit tests",
  "readme.agentTests": "Agent unit tests",
  "readme.webUnitTests": "Website unit, component and parity tests",
  "readme.e2eTests": "Website end-to-end tests (Playwright)",
};

/** The CI figures of the README's "Tested, in numbers" table: each count, the run it was read from and that run's day. */
export function ciFigures(readme) {
  const lines = readme.split("\n");
  const start = lines.indexOf("## Tested, in numbers");
  const rows = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    if (line.startsWith("|") && !/^\|\s*-/.test(line)) rows.push(line.split("|").slice(1, -1).map((c) => c.trim()));
  }
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, what] of Object.entries(CI_ROWS)) {
    const row = rows.find((r) => r[0] === what);
    const n = row ? /^(\d[\d,]*) passed/.exec(row[1] ?? "")?.[1] : undefined;
    if (n) out[key] = n;
  }
  const first = rows.find((r) => r[0] === CI_ROWS["readme.contractTests"]);
  const iso = /\d{4}-\d{2}-\d{2}/.exec(first?.[2] ?? "")?.[0];
  const run = /\/actions\/runs\/(\d+)\//.exec(first?.[3] ?? "")?.[1];
  if (iso) {
    out["readme.ciDateIso"] = iso;
    out["readme.ciDate"] = dayLabel(iso);
  }
  if (run) out["readme.ciRun"] = run;
  return out;
}

/** Days the README's CI figures may trail the render before the capture warns. */
export const CI_MAX_AGE_DAYS = 3;

/** A warning when the README's CI figures are more than CI_MAX_AGE_DAYS older than `today` (an ISO date); else null. */
export function ciAgeWarning(values, today) {
  const iso = values["readme.ciDateIso"];
  if (!iso) return null;
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`)) / 86_400_000);
  if (!(days > CI_MAX_AGE_DAYS)) return null;
  return `beat 8 shows CI figures from ${iso}, ${days} days before this render: refresh the README's "Tested, in numbers" table from a current CI run on main, then render again`;
}

/** The per-stock cap the owner's reserve script queues, in percent, and the USDC floor it leaves across the basket. */
export function reserveFigures(queueSol, configSol) {
  const bps = Number(/uint16 constant RESERVE_CAP_BPS = (\d+);/.exec(queueSol)?.[1]);
  const stocks = Number(/function basket\(\)[^]*?toks = new address\[\]\((\d+)\);/.exec(configSol)?.[1]);
  if (!(bps > 0) || !(stocks > 0)) return {};
  const cap = bps / 100;
  return { "reserve.capPct": String(cap), "reserve.floorPct": String(100 - stocks * cap) };
}

/** Every value the committed files give, and the file (or files) each one is read from. */
export function fileSources(root) {
  /** @type {Record<string, string>} */
  const values = {};
  /** @type {Record<string, string>} */
  const origin = {};
  const add = (from, figures) => {
    for (const [k, v] of Object.entries(figures)) {
      values[k] = v;
      origin[k] = from;
    }
  };
  add("web/content/gap-index/edition-0.json", gapFigures(JSON.parse(read(root, "web/content/gap-index/edition-0.json"))));
  add("deployments/README.md", deploymentFigures(read(root, "deployments/README.md")));
  add("README.md", ciFigures(read(root, "README.md")));
  add(
    "contracts/script/QueueReserveCaps.s.sol, contracts/script/MaatConfig.sol",
    reserveFigures(read(root, "contracts/script/QueueReserveCaps.s.sol"), read(root, "contracts/script/MaatConfig.sol")),
  );
  return { values, origin };
}

/**
 * The values the capture reads from the live site: the cell it reads (a Playwright selector on the page the beat
 * opens) and the pattern whose first group is the value. A cell that does not match fails the render.
 */
export const CAPTURED = Object.freeze({
  "ledger.perTrade": { path: "/ledger", selector: 'section[aria-label="Mandate"] tr:has-text("perTradeCapUsd") td', pattern: /(\$\d[\d,]*(?:\.\d+)?)/ },
  "ledger.perDay": { path: "/ledger", selector: 'section[aria-label="Mandate"] tr:has-text("dailyCapUsd") td', pattern: /(\$\d[\d,]*(?:\.\d+)?)/ },
  "ledger.weightCapPct": { path: "/ledger", selector: 'section[aria-label="Mandate"] tr:has-text("maxWeightBps") td', pattern: /\d+ bps · (\d+(?:\.\d+)?)%/ },
});

/**
 * The value of captured `key` in the text of its cell; throws when the cell does not hold one, or holds the configured
 * default that /ledger shows when it could not read the vault (its cells are then tagged "configured").
 */
export function capturedValue(key, text) {
  const spec = CAPTURED[key];
  if (!spec) throw new Error(`${key} is not a captured value`);
  if (/configured/.test(text ?? "")) {
    throw new Error(`${key}: the cell ${spec.selector} on ${spec.path} shows the configured default, not the onchain mandate; the page could not read the vault`);
  }
  const value = spec.pattern.exec(text ?? "")?.[1];
  if (value === undefined) throw new Error(`${key}: the cell ${spec.selector} on ${spec.path} reads "${String(text).slice(0, 80)}", not ${spec.pattern}`);
  return value;
}
