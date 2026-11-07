import { describe, expect, it } from "vitest";
import {
  docsLinks,
  excerpts,
  factNames,
  foreignCharacters,
  frontmatterOf,
  handTypedFacts,
  headingIds,
  isDistinctive,
  malformedExcerptTitles,
  prose,
  repoPaths,
} from "@/lib/docs/content-checks";

const PAGE = [
  "---",
  "title: The nine checks",
  "---",
  "",
  "Prose with `inline code` and <Fact name=\"forkBlock\" /> here.",
  "",
  "```text",
  "│ trace … 53,551,627",
  "```",
  "",
  "## Why the order matters",
].join("\n");

describe("frontmatterOf and prose", () => {
  it("reads the frontmatter block", () => {
    expect(frontmatterOf(PAGE)).toBe("title: The nine checks");
    expect(frontmatterOf("no frontmatter")).toBe("");
  });

  it("blanks frontmatter, fences, inline code and JSX but keeps every line", () => {
    const p = prose(PAGE);
    expect(p.split("\n")).toHaveLength(PAGE.split("\n").length);
    expect(p).not.toMatch(/title:|inline code|Fact|trace/);
    expect(p).toMatch(/Prose with/);
  });
});

describe("foreignCharacters", () => {
  it("flags accented letters, em dashes and curly quotes in prose and frontmatter", () => {
    const found = foreignCharacters("---\ntitle: Café\n---\nIt’s here — now.\n");
    expect(found).toEqual([
      { line: 2, text: "é" },
      { line: 4, text: "’" },
      { line: 4, text: "—" },
    ]);
  });

  it("allows the listed symbols and exempts fenced code", () => {
    expect(foreignCharacters("$20 ≤ $50 · up → down ≥ ↗ −1\n")).toEqual([]);
    expect(foreignCharacters(PAGE)).toEqual([]);
    expect(foreignCharacters("Counts as … in prose.")).toEqual([{ line: 1, text: "…" }]);
  });
});

describe("handTypedFacts", () => {
  const facts = { forkBlock: "53,551,627", "mandate.perTradeCapUsd": "$50", "premiumsBps.NVDAc": "53 bps", timelockHours: "24 hours" };

  it("only lints distinctive values", () => {
    expect(isDistinctive("53,551,627")).toBe(true);
    expect(isDistinctive("$50")).toBe(true);
    expect(isDistinctive("53 bps")).toBe(true);
    expect(isDistinctive("24 hours")).toBe(false);
    expect(isDistinctive("2026-11-07")).toBe(false);
  });

  it("flags a typed copy, with or without separators", () => {
    expect(handTypedFacts("The fork block is 53,551,627.", facts)).toEqual([{ line: 1, text: 'forkBlock: "53,551,627"' }]);
    expect(handTypedFacts("Block 53551627 it is.", facts)).toEqual([{ line: 1, text: 'forkBlock: "53551627"' }]);
    expect(handTypedFacts("A cap of $50.", facts)).toEqual([{ line: 1, text: 'mandate.perTradeCapUsd: "$50"' }]);
  });

  it("ignores code, JSX, longer numbers and non-distinctive facts", () => {
    expect(handTypedFacts(PAGE, facts)).toEqual([]);
    expect(handTypedFacts("A $500 trade waits 24 hours.", facts)).toEqual([]);
  });
});

describe("page parts", () => {
  it("factNames lists every <Fact> outside code", () => {
    expect(factNames('A <Fact name="timelockHours" /> wait.\n`<Fact name="x" />`\n')).toEqual([{ line: 1, text: "timelockHours" }]);
  });

  it("docsLinks finds markdown and JSX links", () => {
    expect(docsLinks('[a](/docs/concepts/mandate#fields) <a href="/docs/help/faq">b</a> [c](https://x.dev)')).toEqual([
      "/docs/concepts/mandate#fields",
      "/docs/help/faq",
    ]);
  });

  it("repoPaths finds blob and tree links without line anchors", () => {
    const src = "[v](https://github.com/o/r/blob/main/contracts/src/MandateVault.sol#L10) [t](https://github.com/o/r/tree/main/agent)";
    expect(repoPaths(src, "https://github.com/o/r")).toEqual(["contracts/src/MandateVault.sol", "agent"]);
  });

  it("headingIds gives the ids Fumadocs will use, skipping code", () => {
    const ids = headingIds("## Why the order matters\n### `queueMandate`\n### [Read](/docs) more\n```md\n## Not a heading\n```\n");
    expect([...ids]).toEqual(["why-the-order-matters", "queuemandate", "read-more"]);
  });

  it("excerpts reads the file, the line range and the body", () => {
    const src = 'Intro\n\n```solidity title="contracts/src/GuardLib.sol#L44-L45"\n    a;\n    b;\n```\n';
    expect(excerpts(src)).toEqual([{ line: 3, file: "contracts/src/GuardLib.sol", from: 44, to: 45, body: "    a;\n    b;" }]);
  });

  it("malformedExcerptTitles flags every excerpt title that excerpts() would skip", () => {
    const src = [
      '```solidity title="contracts/src/GuardLib.sol#L44-L45"',
      "    a;",
      "```",
      '```solidity title="contracts/src/GuardLib.sol#L44"',
      "```",
      '```solidity title="contracts/src/GuardLib.sol#L44-62"',
      "```",
      '```solidity title="contracts/src/GuardLib.sol#l44-l45"',
      "```",
      "```solidity title='contracts/src/GuardLib.sol#L44-L45'",
      "```",
      '  ```solidity title="contracts/src/GuardLib.sol#L44-L45"',
      "  ```",
    ].join("\n");
    const text = "excerpt title must read path#L<from>-L<to>, with the fence at the start of the line";
    expect(excerpts(src).map((e) => e.line)).toEqual([1]);
    expect(malformedExcerptTitles(src)).toEqual([4, 6, 8, 10, 12].map((line) => ({ line, text })));
  });
});
