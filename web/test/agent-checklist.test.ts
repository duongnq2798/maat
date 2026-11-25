// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHECKLIST_PATH, GUARD_CHECKLIST, REASON_RAISED_AT, type RaiseSite } from "@/content/reasons";
import { SITE } from "@/lib/site";
import { DOCS_DIR } from "./helpers/docs";
import { REPO_ROOT, readRepo } from "./helpers/solidity";

// concepts/agent-checklist.mdx is the category checklist: one row per refusal code with the check, the failure it
// stops, the reason and the contract line that returns it. Its rows are written out so search and the Markdown copy
// carry them; this file holds them to GUARD_CHECKLIST and REASON_RAISED_AT, which test/reasons-json.test.ts holds to
// contracts/src.

const SLUG = "concepts/agent-checklist";
const source = readFileSync(join(DOCS_DIR, `${SLUG}.mdx`), "utf8").replace(/\r\n/g, "\n");

/** The lines under a heading, up to the next heading at its level or above. */
function under(md: string, heading: string): string {
  const level = /^#+/.exec(heading)?.[0].length ?? 0;
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l === heading);
  if (start < 0) return "";
  const end = lines.findIndex((l, i) => i > start && (/^#+ /.exec(l)?.[0].length ?? Infinity) <= level);
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

/** The header and body rows of the first table in `text`, each as its trimmed cells. */
function table(text: string): { head: string[]; rows: string[][] } {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith("|"));
  if (start < 0) return { head: [], rows: [] };
  const end = lines.findIndex((l, i) => i > start && !l.startsWith("|"));
  const cells = (l: string) => l.split("|").slice(1, -1).map((c) => c.trim());
  return { head: cells(lines[start] ?? ""), rows: lines.slice(start + 2, end < 0 ? undefined : end).map(cells) };
}

/** The cell that links a raise site: its file name and line in code, linked to that line on GitHub. */
const siteCell = (s: RaiseSite) => `[\`${s.file.split("/").at(-1)}:${s.line}\`](${SITE.repoUrl}/blob/main/${s.file}#L${s.line})`;

/** Every link on the page to a line of a repo file: [path, line]. */
const lineLinks = (md: string): [string, number][] =>
  [...md.matchAll(new RegExp(`${SITE.repoUrl.replace(/[.]/g, "\\.")}/blob/main/([^)\\s#]+)#L(\\d+)\\)`, "g"))].map((m) => [m[1] ?? "", Number(m[2])]);

describe(`content/docs/${SLUG}.mdx`, () => {
  it("is the page /reasons.json names as the checklist", () => {
    expect(CHECKLIST_PATH).toBe(`/docs/${SLUG}`);
  });

  const checklist = table(under(source, "## The checklist"));

  it("tables the checklist: the check, what it stops, the reason and its source", () => {
    expect(checklist.head).toEqual(["Check", "What it stops", "Reason", "Source"]);
  });

  it("has one row per refusal code, in the checklist's order, with its check and the failure it stops", () => {
    expect(checklist.rows.map(([check, stops, reason]) => [check, stops, reason])).toEqual(
      GUARD_CHECKLIST.map((g) => [g.check, g.stops, `[\`${g.code}\`](/docs/concepts/refusal-codes#${g.code.toLowerCase()})`]),
    );
  });

  it("starts with the rows a BUY meets, in the order the vault runs them, and says how many", () => {
    // MandateVault._check runs its own checks around one call to GuardLib.checkMarket; a BUY meets each code first there.
    const vault = readRepo("contracts/src/MandateVault.sol").replace(/\r\n/g, "\n").split("\n");
    const call = vault.findIndex((l) => l.includes("GuardLib.checkMarket(")) + 1;
    expect(call).toBeGreaterThan(0);
    const order = (s: RaiseSite | undefined) =>
      s?.fn === "MandateVault._check" ? s.line : s?.fn === "GuardLib.checkMarket" ? call + s.line / 10_000 : undefined;
    const buy = GUARD_CHECKLIST.map((g) => ({ code: g.code, at: order(REASON_RAISED_AT[g.code][0]) })).filter((x) => x.at !== undefined);
    expect(GUARD_CHECKLIST.slice(0, buy.length).map((g) => g.code)).toEqual([...buy].sort((a, b) => (a.at ?? 0) - (b.at ?? 0)).map((x) => x.code));
    const WORDS: Record<number, string> = { 10: "ten", 11: "eleven", 12: "twelve", 13: "thirteen", 14: "fourteen" };
    expect(source).toContain(`A \`BUY\` meets the first ${WORDS[buy.length]} rows in this order`);
  });

  it("links each row to the first line that returns its code, on GitHub at main", () => {
    expect(checklist.rows.map((r) => r[3])).toEqual(
      GUARD_CHECKLIST.map((g) => {
        const [first] = REASON_RAISED_AT[g.code];
        if (!first) throw new Error(`${g.code} has no raise site`);
        return siteCell(first);
      }),
    );
  });

  it("links each pattern to the line that shows what Maat does instead", () => {
    const patterns = table(under(source, "## Four patterns and what they cannot show"));
    expect(patterns.head).toEqual(["Pattern", "What it cannot show", "Maat", "Source"]);
    // The text each pattern's source line must hold.
    const shows: Record<string, string> = {
      "A guard that reverts": "emit Decision(intent.id",
      "A testnet mirror": "NVDA_FEED = 0x",
      "An offchain rule engine": "(reason, price) = _check(intent);",
      "An agent that prices its own oracle": "PriceLib.readFeed(c.feed)",
    };
    expect(patterns.rows.map((r) => r[0])).toEqual(Object.keys(shows));
    for (const [pattern, , , cell = ""] of patterns.rows) {
      const links = lineLinks(cell);
      expect(links, pattern).toHaveLength(1);
      const [file = "", line = 0] = links[0] ?? [];
      const text = readRepo(file).replace(/\r\n/g, "\n").split("\n")[line - 1] ?? "";
      expect(text, `${pattern}: ${file}:${line}`).toContain(shows[pattern ?? ""]);
    }
  });

  it("links the swap adapter's line that reverts below the vault's floor, and the check 7 reads that revert execute", () => {
    // The vault passes minOut to the adapter and ignores what the swap returns, so the adapter enforces the floor.
    const adapter = lineLinks(source).filter(([file]) => file.endsWith("AerodromeSwapAdapter.sol"));
    expect(adapter).toHaveLength(1);
    const [file = "", line = 0] = adapter[0] ?? [];
    expect(readRepo(file).replace(/\r\n/g, "\n").split("\n")[line - 1]).toContain("if (amountOut < minOut) revert InsufficientOutput");
    expect(source).toContain("[check 7](/docs/concepts/nine-checks#7-pool-price-near-the-oracle)");
  });

  it("links only lines that exist", () => {
    const links = lineLinks(source);
    expect(links.length).toBeGreaterThan(GUARD_CHECKLIST.length);
    const missing = links.filter(([file, line]) => {
      const path = join(REPO_ROOT, file);
      return !existsSync(path) || (readRepo(file).replace(/\r\n/g, "\n").split("\n")[line - 1] ?? "").trim() === "";
    });
    expect(missing).toEqual([]);
  });

  it("links /reasons.json and the market-guard skill as plain anchors, never as Markdown links", () => {
    // A Markdown link goes through the docs' Link component, whose prefetch asks for a route under the file that the
    // static export does not have (/reasons.json/__next._tree.txt), a 404 in the console. A JSX <a> is left alone.
    expect(source).toContain('<a href="/reasons.json">/reasons.json</a>');
    expect(source).toContain('<a href="/skill.md">/skill.md</a>');
    expect(source).not.toMatch(/\]\(\/(?:reasons\.json|skill\.md)\)/);
  });
});
