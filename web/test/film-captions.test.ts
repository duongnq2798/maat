// @vitest-environment node
import { describe, expect, it } from "vitest";
import { captionIds } from "../../film/lib/beats.mjs";
import { captionProblems, pickCaption, renderCaption } from "../../film/lib/captions.mjs";
import { CAPTURED, capturedValue, ciFigures, deploymentRows, fileSources, gapFigures, reserveFigures } from "../../film/lib/sources.mjs";
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
    const known = new Set([...Object.keys(files.values), ...Object.keys(CAPTURED)]);
    expect(ids.flatMap((id) => captionProblems(id, captionsFile.captions[id], known))).toEqual([]);
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

  it("counts the Base mainnet rows of the deployments table and reads the date Basescan showed them verified", () => {
    const md = lf("deployments/README.md");
    const rows = deploymentRows(md);
    expect(rows.map((r) => r.contract)).toEqual(["MarketCalendar", "AerodromeSwapAdapter", "AaveV4CreditAdapter", "MandateVault"]);
    expect(files.values["deployments.count"]).toBe(String(rows.length));
    const iso = files.values["deployments.verifiedOnIso"] ?? "";
    expect(md).toContain(`On ${iso}, Basescan showed the source of all`);
    const [y, m, d] = iso.split("-").map(Number);
    expect(files.values["deployments.verifiedOn"]).toBe(`${d} ${new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d)).toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${y}`);
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
});
