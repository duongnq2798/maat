// @vitest-environment node
import { describe, expect, it } from "vitest";
import { captionIds } from "../../film/lib/beats.mjs";
import { captionProblems, pickCaption, renderCaption } from "../../film/lib/captions.mjs";
import {
  CAPTURED,
  CI_MAX_AGE_DAYS,
  COUNT_WORDS,
  OPTIONAL_KEYS,
  capturedValue,
  ciAgeWarning,
  ciFigures,
  deploymentFigures,
  deploymentRows,
  fileSources,
  gapFigures,
  reserveFigures,
} from "../../film/lib/sources.mjs";
import { REPO_ROOT, readRepo } from "./helpers/solidity";

// Every number in a film caption is read from a source at render time: a committed file (the frozen Gap Index edition,
// the deployments table, the README's CI table, the reserve-cap script) or a value the capture read from the live site.
// A digit typed into a caption is an invented number, and these tests fail on it.

const lf = (rel: string) => readRepo(rel).replace(/\r\n/g, "\n");
const captionsFile = JSON.parse(lf("film/captions.json")) as { captions: Record<string, unknown> };
const files = fileSources(REPO_ROOT);
/** What the capture read from /ledger on a day the default mandate was onchain, as the render feeds it in. */
const CAPTURED_DEFAULTS = { "ledger.perTrade": "$50", "ledger.perDay": "$100", "ledger.weightCapPct": "40" };
const CAPTURED_RESERVE = { ...CAPTURED_DEFAULTS, "ledger.weightCapPct": "25" };
/** Every key a caption may name: what the files give today, what the capture reads, and what a file gives only in some states. */
const KNOWN = new Set([...Object.keys(files.values), ...Object.keys(CAPTURED), ...Object.keys(OPTIONAL_KEYS)]);
/** The deployments table with a Base mainnet MaatInbox row added under the MandateVault's. */
function withInboxRow(md: string): string {
  const vault = md.split("\n").find((l) => /^\| Base mainnet \| MandateVault \|/.test(l)) ?? "";
  const inbox = vault.replace("MandateVault", "MaatInbox").replace(/0x[0-9a-fA-F]{40}/g, `0x${"cd".repeat(20)}`);
  return md.replace(vault, `${vault}\n${inbox}`);
}

/** The body rows of the first Markdown table under `heading`, as trimmed cells. */
function tableUnder(md: string, heading: string): string[][] {
  const lines = md.split("\n");
  const start = lines.indexOf(heading);
  const first = lines.findIndex((l, i) => i > start && l.startsWith("|"));
  const end = lines.findIndex((l, i) => i > first && !l.startsWith("|"));
  return lines.slice(first + 2, end).map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));
}

describe("film/captions.json", () => {
  const ids = Object.keys(captionsFile.captions);

  it("holds every caption the beat plan shows, and none it does not", () => {
    const shown = new Set(captionIds());
    const reached = new Set(shown);
    for (const id of shown) {
      const c = captionsFile.captions[id] as { else?: string } | undefined;
      if (c?.else) reached.add(c.else);
    }
    expect([...shown].filter((id) => !ids.includes(id))).toEqual([]);
    expect(ids.filter((id) => !reached.has(id))).toEqual([]);
  });

  it("types no number into a caption: every digit comes from a {source} placeholder", () => {
    expect(ids.flatMap((id) => captionProblems(id, captionsFile.captions[id], KNOWN))).toEqual([]);
  });

  it("renders every caption from the repository files and a capture, with nothing left unresolved", () => {
    for (const captured of [CAPTURED_DEFAULTS, CAPTURED_RESERVE]) {
      const values = { ...files.values, ...captured };
      for (const id of ids) {
        const picked = pickCaption(captionsFile.captions, id, values);
        const out = renderCaption(picked.text, values);
        expect(out.missing, `caption ${id}`).toEqual([]);
        expect(out.text).not.toMatch(/[{}]/);
      }
    }
  });

  it("fails a number typed into a caption, an unknown source and a malformed placeholder", () => {
    const known = new Set(Object.keys(files.values));
    expect(captionProblems("x", "We ran 9,999 tests on {readme.contractTests} cases.", known)).toEqual([
      'caption x: "9,999" is typed into the text; read it from a source with a {placeholder}',
    ]);
    expect(captionProblems("y", "The feed held for {gap.minutes} min.", known)).toEqual(["caption y: {gap.minutes} is not a known source"]);
    expect(captionProblems("z", "Held for {gap.hours h.", known)).toEqual(['caption z: an unclosed "{"']);
    expect(captionProblems("w", "Up 25% since {gap.close}.", known)).toEqual([
      'caption w: "25" is typed into the text; read it from a source with a {placeholder}',
    ]);
  });

  it("shows the reserve line only when the vault's cap equals the reserve script's, and the timelock line otherwise", () => {
    const withDefaults = pickCaption(captionsFile.captions, "mandate-reserve", { ...files.values, ...CAPTURED_DEFAULTS });
    const withReserve = pickCaption(captionsFile.captions, "mandate-reserve", { ...files.values, ...CAPTURED_RESERVE });
    expect(withDefaults.id).toBe("mandate-timelock");
    expect(withReserve.id).toBe("mandate-reserve");
    expect(renderCaption(withReserve.text, { ...files.values, ...CAPTURED_RESERVE }).text).toContain("25%");
  });

  it("says the inbox takes briefs only once deployments/README.md records it on Base, and that it will until then", () => {
    const noInbox = Object.fromEntries(Object.entries(files.values).filter(([k]) => k !== "deployments.inbox"));
    const before = pickCaption(captionsFile.captions, "brief-ask", noInbox);
    const after = pickCaption(captionsFile.captions, "brief-ask", { ...noInbox, "deployments.inbox": `0x${"cd".repeat(20)}` });
    expect(before.id).toBe("brief-ask-soon");
    expect(before.text).toMatch(/^Once the inbox contract is on Base/);
    expect(after.id).toBe("brief-ask");
    expect(files.values["deployments.inbox"] !== undefined).toBe(
      deploymentRows(lf("deployments/README.md")).some((r) => r.network === "Base mainnet" && r.contract === "MaatInbox" && r.address !== ""),
    );
  });

  it("says one transaction of a pair is missing while the other is already on Base", () => {
    const partial = pickCaption(captionsFile.captions, "pair-partial", files.values);
    expect(partial.text).toMatch(/^Placeholder: /);
    expect(partial.text).toMatch(/one of the two/);
  });

  it("fails a when that names no known source, or tests nothing", () => {
    expect(captionProblems("p", { text: "Open.", when: { present: "deployments.nope" }, else: "q" }, KNOWN)).toEqual([
      "caption p: when.present must name a known source",
    ]);
    expect(captionProblems("p", { text: "Open.", when: {}, else: "q" }, KNOWN)).toEqual(["caption p: when needs equal or present"]);
    expect(captionProblems("p", { text: "Open.", when: { present: "deployments.inbox" }, else: "q" }, KNOWN)).toEqual([]);
  });
});

describe("the caption sources read the committed files", () => {
  it("reads the frozen-feed figures of edition 0 (NVDAc, the 6 Nov window)", () => {
    const edition = JSON.parse(lf("web/content/gap-index/edition-0.json")) as {
      windows: { id: string; closeLabel: string; openLabel: string; tokens: { symbol: string; freeze: { hours: number; swapsWhileFrozen: number }; largestGap: { bps: number; above: boolean } }[] }[];
    };
    const w = edition.windows.find((x) => x.id === "2026-11-06");
    const t = w?.tokens.find((x) => x.symbol === "NVDAc");
    expect(t).toBeDefined();
    if (!w || !t) return;
    expect(gapFigures(edition)).toEqual({
      "gap.close": w.closeLabel,
      "gap.open": w.openLabel,
      "gap.hours": t.freeze.hours.toFixed(2),
      "gap.swaps": t.freeze.swapsWhileFrozen.toLocaleString("en-US"),
      "gap.gapBps": Math.abs(t.largestGap.bps).toLocaleString("en-US"),
      "gap.side": t.largestGap.above ? "above" : "below",
    });
    // The three figures the win plan quotes for this beat.
    expect([files.values["gap.hours"], files.values["gap.swaps"], files.values["gap.gapBps"], files.values["gap.side"]]).toEqual(["51.35", "10,138", "490", "below"]);
  });

  it("counts the Base mainnet rows of the deployments table, and reads the date Basescan showed them verified only while the note counts every row", () => {
    const md = lf("deployments/README.md");
    const rows = deploymentRows(md).filter((r) => r.network === "Base mainnet" && r.address);
    expect(rows.map((r) => r.contract)).toContain("MandateVault");
    expect(files.values["deployments.count"]).toBe(String(rows.length));
    // The caption claims the verification for every row, so it may name the date only while the note counts them all.
    const [, iso = "", noted = ""] = /On (\d{4}-\d{2}-\d{2}), Basescan showed the source of all (\w+) contracts as verified/.exec(md) ?? [];
    const counted = COUNT_WORDS.indexOf(noted);
    expect(counted, "the note's count").toBeGreaterThan(0);
    expect(counted, "the note's count").toBeLessThanOrEqual(rows.length);
    if (counted < rows.length) {
      // Today: the note counts the four contracts Basescan showed verified on 2026-11-24. MaatInbox's own paragraph gives
      // its later date, 2026-11-27, so no one date covers every row and the caption names none.
      expect(files.values["deployments.verifiedOn"]).toBeUndefined();
      expect(files.values["deployments.verifiedOnIso"]).toBeUndefined();
      return;
    }
    expect(files.values["deployments.verifiedOnIso"]).toBe(iso);
    const [y, m, d] = iso.split("-").map(Number);
    expect(files.values["deployments.verifiedOn"]).toBe(`${d} ${new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d)).toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${y}`);
  });

  it("drops the verification date once the table has a row the note does not count, and the caption claims less", () => {
    // The table as it was before the inbox's deploy, with the note counting every row: the date is there.
    const real = lf("deployments/README.md");
    const recount = (md: string, n: number) => md.replace(/(source of all )\w+( contracts)/, `$1${COUNT_WORDS[n]}$2`);
    const noInbox = real
      .split("\n")
      .filter((l) => !/^\| Base mainnet \| MaatInbox \|/.test(l))
      .join("\n");
    const before = deploymentRows(noInbox).filter((r) => r.network === "Base mainnet" && r.address).length;
    const verified = deploymentFigures(recount(noInbox, before));
    const iso = /On (\d{4}-\d{2}-\d{2}), Basescan showed/.exec(real)?.[1] ?? "";
    const [y, m, d] = iso.split("-").map(Number);
    expect(verified["deployments.verifiedOnIso"]).toBe(iso);
    expect(verified["deployments.verifiedOn"]).toBe(`${d} ${new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d)).toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${y}`);
    expect(verified["deployments.inbox"]).toBeUndefined();
    // An inbox row the note does not count: no date, and the receipts card falls back to the caption that claims less.
    const md = withInboxRow(recount(noInbox, before));
    const n = deploymentRows(md).filter((r) => r.network === "Base mainnet" && r.address).length;
    expect(n).toBe(before + 1);
    const stale = deploymentFigures(md);
    expect(stale["deployments.count"]).toBe(String(n));
    expect(stale["deployments.verifiedOn"]).toBeUndefined();
    expect(stale["deployments.inbox"]).toBe(`0x${"cd".repeat(20)}`);
    const values = Object.fromEntries(Object.entries({ ...files.values, ...stale }).filter(([k]) => !k.startsWith("deployments.verifiedOn")));
    const picked = pickCaption(captionsFile.captions, "receipts-contracts", values);
    expect(picked.id).toBe("receipts-contracts-listed");
    expect(renderCaption(picked.text, values).text).not.toMatch(/verified/);
    // Once the note counts the new row too, the date is back.
    expect(deploymentFigures(recount(md, n))["deployments.verifiedOn"]).toBe(verified["deployments.verifiedOn"]);
  });

  it("reads each CI figure from its row of the README's Tested, in numbers table", () => {
    const readme = lf("README.md");
    const rows = tableUnder(readme, "## Tested, in numbers");
    const row = (what: string) => rows.find((r) => r[0] === what) ?? [];
    const ci = ciFigures(readme);
    expect(row("Contract unit tests")[1]).toMatch(new RegExp(`^${ci["readme.contractTests"]} passed`));
    expect(row("Agent unit tests")[1]).toMatch(new RegExp(`^${ci["readme.agentTests"]} passed`));
    expect(row("Website unit, component and parity tests")[1]).toMatch(new RegExp(`^${ci["readme.webUnitTests"]} passed`));
    expect(row("Website end-to-end tests (Playwright)")[1]).toMatch(new RegExp(`^${ci["readme.e2eTests"]} passed`));
    expect(row("Contract unit tests")[2]).toContain(ci["readme.ciDateIso"]);
    expect(row("Contract unit tests")[3]).toContain(`/actions/runs/${ci["readme.ciRun"]}/`);
  });

  it("reads the reserve cap from QueueReserveCaps.s.sol and the basket size from MaatConfig.sol", () => {
    const sol = lf("contracts/script/QueueReserveCaps.s.sol");
    const config = lf("contracts/script/MaatConfig.sol");
    const bps = Number(/uint16 constant RESERVE_CAP_BPS = (\d+);/.exec(sol)?.[1]);
    expect(reserveFigures(sol, config)).toEqual({ "reserve.capPct": String(bps / 100), "reserve.floorPct": String(100 - 3 * (bps / 100)) });
    expect(config).toMatch(/function basket\(\)[^]*?toks = new address\[\]\(3\);/);
  });

  it("names the files each value comes from", () => {
    const known = ["web/content/gap-index/edition-0.json", "deployments/README.md", "README.md", "contracts/script/QueueReserveCaps.s.sol", "contracts/script/MaatConfig.sol"];
    for (const key of Object.keys(files.values)) {
      const from = files.origin[key]?.split(", ") ?? [];
      expect(from.length, key).toBeGreaterThan(0);
      expect(from.filter((f) => !known.includes(f)), key).toEqual([]);
    }
  });
});

describe("the values the capture reads from the live site", () => {
  it("takes the per-trade cap, the daily cap and the weight cap from the mandate panel's cells", () => {
    expect(capturedValue("ledger.perTrade", "$50")).toBe("$50");
    expect(capturedValue("ledger.perDay", "$100")).toBe("$100");
    expect(capturedValue("ledger.weightCapPct", "4000 bps · 40%")).toBe("40");
    // After the owner's change the cell also names the default it replaced; the first figure is the onchain one.
    expect(capturedValue("ledger.weightCapPct", "2500 bps · 25%changed · default 4000 bps · 40%")).toBe("25");
  });

  it("refuses a cell it cannot read rather than guessing", () => {
    expect(() => capturedValue("ledger.perTrade", "loading…")).toThrow(/ledger\.perTrade/);
    expect(() => capturedValue("ledger.nope", "$50")).toThrow(/not a captured value/);
  });

  it("refuses the configured defaults the panel shows when it could not read the vault", () => {
    expect(() => capturedValue("ledger.weightCapPct", "4000 bps · 40%configured")).toThrow(/configured default, not the onchain mandate/);
    expect(() => capturedValue("ledger.perDay", "$100configured")).toThrow(/configured default, not the onchain mandate/);
  });
});

describe("the age of the README's CI figures", () => {
  it(`warns when they are more than ${CI_MAX_AGE_DAYS} days older than the render`, () => {
    const values = { "readme.ciDateIso": "2026-11-19" };
    const late = new Date(Date.UTC(2026, 10, 19 + CI_MAX_AGE_DAYS + 1)).toISOString().slice(0, 10);
    const inTime = new Date(Date.UTC(2026, 10, 19 + CI_MAX_AGE_DAYS)).toISOString().slice(0, 10);
    expect(ciAgeWarning(values, inTime)).toBeNull();
    expect(ciAgeWarning(values, late)).toBe(
      `beat 8 shows CI figures from 2026-11-19, ${CI_MAX_AGE_DAYS + 1} days before this render: refresh the README's "Tested, in numbers" table from a current CI run on main, then render again`,
    );
    expect(ciAgeWarning({}, late)).toBeNull();
  });
});
