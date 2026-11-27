// @vitest-environment node
import { describe, expect, it } from "vitest";
import deployments from "@/content/generated/deployments.json";
import { hasAddress } from "@/lib/docs/reference-labels";
import { docsPages } from "./helpers/docs";

// The docs must not undercount Maat's deployed contracts. deployments.json, which docs:gen writes from the table in
// deployments/README.md, holds a row for each contract the owner deployed on Base mainnet. Once it holds five, a
// present-tense line such as "the four Maat contracts are deployed" leaves out MaatInbox: say "the four core Maat
// contracts and MaatInbox", or "five". A dated history line ("on 2026-11-24 the owner deployed the four Maat
// contracts") stays true, so a sentence that is past tense or names an earlier date is left alone.

const NUMBER_WORDS: Readonly<Record<string, number>> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };

const blank = (m: string) => m.replace(/[^\n]/g, " ");
const FRONTMATTER = /^---\n[\s\S]*?\n---\n/;
const FENCE = /^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm;

/**
 * "<number> Maat contracts" followed by a present-tense verb or a place: "are deployed", "is on", "are on Base",
 * "deployed on" (as in "the four Maat contracts deployed on Base mainnet") or "at the addresses". A count right after
 * "deployed" or "deployed the" is the past-tense deploy itself, so it is not matched.
 */
const PRESENT_COUNT = /(?<!\bdeployed )(?<!\bdeployed the )\b(one|two|three|four|five|six|seven|eight|nine) Maat contracts,?\s+(?:are|is|deployed on|at the address)/gi;

/** An ISO date earlier than `latest` ("2026-11-24" < "2026-11-27"): the sentence then dates what it says. */
const earlierDate = (sentence: string, latest: string) => (sentence.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? []).some((d) => d < latest);

/**
 * Each present-tense sentence of `source`, outside its frontmatter and fenced code, that gives Maat fewer contracts
 * than `deployed`, as "<line> <phrase>". A sentence that names MaatInbox already counts it, and one that names a date
 * earlier than `latest` is history.
 */
function undercounts(source: string, deployed: number, latest: string): string[] {
  const text = source.replace(FRONTMATTER, blank).replace(FENCE, blank);
  const out: string[] = [];
  text.split("\n").forEach((line, i) => {
    // A sentence ends at a full stop followed by a space; a dot inside a file name or a number does not end one.
    for (const sentence of line.split(/(?<=[.!?])\s+(?=[A-Z`[*])/)) {
      if (sentence.includes("MaatInbox") || earlierDate(sentence, latest)) continue;
      for (const m of sentence.matchAll(PRESENT_COUNT)) {
        const n = NUMBER_WORDS[(m[1] ?? "").toLowerCase()] ?? 0;
        if (n < deployed) out.push(`${i + 1} ${m[0]}`);
      }
    }
  });
  return out;
}

describe("the docs count every contract deployments.json records", () => {
  const rows = deployments.filter((d) => d.network === "Base mainnet" && hasAddress(d));
  const latest = rows.map((d) => d.date).sort().at(-1) ?? "";
  // Read once, when the suite is collected, as test/docs-content.test.ts does, so a slow disk does not eat the test's time.
  const pages = docsPages();

  it("reads the five Base mainnet rows the owner recorded, the latest on 2026-11-27", () => {
    expect(rows.map((d) => d.contract)).toEqual(["MarketCalendar", "AerodromeSwapAdapter", "AaveV4CreditAdapter", "MandateVault", "MaatInbox"]);
    expect(latest).toBe("2026-11-27");
  });

  it("flags a present-tense undercount, and leaves alone the full count, MaatInbox, a dated line and the past-tense deploy", () => {
    const source = [
      "---",
      "title: The four Maat contracts are deployed",
      "---",
      "The four Maat contracts are deployed to Base mainnet. The contracts are unaudited.",
      "The four Maat contracts are on Base mainnet.",
      "A report can cover the four Maat contracts at the addresses on Base addresses.",
      "Treat them as unaudited, including the four Maat contracts deployed on Base mainnet.",
      "The four Maat contracts are deployed on it.",
      "The four core Maat contracts and `MaatInbox` are deployed on Base mainnet.",
      "The four Maat contracts and `MaatInbox` are deployed, and Status lists them.",
      "The five Maat contracts are deployed on Base mainnet.",
      "On 2026-11-24 the four Maat contracts were deployed, and the four Maat contracts are verified since 2026-11-24.",
      "The owner deployed the four Maat contracts on Base mainnet: `MarketCalendar` and three more.",
      "```text",
      "the four Maat contracts are deployed",
      "```",
    ].join("\n");
    expect(undercounts(source, 5, "2026-11-27")).toEqual([
      "4 four Maat contracts are",
      "5 four Maat contracts are",
      "6 four Maat contracts at the address",
      "7 four Maat contracts deployed on",
      "8 four Maat contracts are",
    ]);
    // With four rows the four are every deployed contract, so nothing is short.
    expect(undercounts(source, 4, "2026-11-24")).toEqual([]);
  });

  it("finds no page in content/docs that gives Maat fewer contracts than deployments.json records", () => {
    const found = pages.flatMap((p) => undercounts(p.source, rows.length, latest).map((f) => `content/docs/${p.slug}.mdx:${f}`));
    expect(found).toEqual([]);
  });
});
