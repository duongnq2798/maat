import { describe, expect, it } from "vitest";
import {
  codedTestTitles,
  docsLinks,
  excerptHref,
  excerpts,
  factNames,
  foreignCharacters,
  frontmatterOf,
  handTypedFacts,
  headingIds,
  isDistinctive,
  malformedExcerptTitles,
  notDeployedClaims,
  prose,
  quotedTestTitles,
  repoPaths,
  testNameLinks,
  unknownTestNames,
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

  it("excerptHref links an excerpt title to its lines on main, and no other title", () => {
    const repo = "https://github.com/o/r";
    expect(excerptHref("contracts/src/GuardLib.sol#L44-L62", repo)).toBe(`${repo}/blob/main/contracts/src/GuardLib.sol#L44-L62`);
    for (const title of ["agent/.env.example", "contracts/src/GuardLib.sol#L44", "contracts/src/GuardLib.sol#L44-62", "a#b#L1-L2"]) {
      expect(excerptHref(title, repo), title).toBeNull();
    }
  });
});

describe("cited tests", () => {
  const repo = "https://github.com/o/r";
  const names = new Set([
    "test_replayReverts",
    "test_revertingIsPausedFailsClosed",
    "test_revertingCalendarFailsClosed",
    "test_priceFromSqrt_stockIsToken0",
    "test_priceFromSqrt_stockIsToken1",
  ]);

  it("unknownTestNames flags a test name in inline code that no test has, and skips fences and plain prose", () => {
    const src = [
      "`test_replayReverts` refuses a replay, `test_replayRevert` does not exist.",
      "The output reads `[PASS] test_replayReverts()`, then `forge test --match-test \"test_replayReverts|test_gone\"`.",
      "```bash",
      "forge test --match-test test_inFence",
      "```",
      "Plain test_inProse is not code.",
    ].join("\n");
    expect(unknownTestNames(src, names)).toEqual([
      { line: 1, text: "test_replayRevert" },
      { line: 2, text: "test_gone" },
    ]);
  });

  it("unknownTestNames reads `*` as any letters, which must match a test, and 'the two `test_x` tests' as that many tests starting so", () => {
    expect(unknownTestNames("the other `test_reverting*FailsClosed` tests in the same file", names)).toEqual([]);
    expect(unknownTestNames("`test_reverting*Closes`", names)).toEqual([{ line: 1, text: "test_reverting*Closes: no test matches" }]);
    expect(unknownTestNames("and the two `test_priceFromSqrt` tests cover it", names)).toEqual([]);
    expect(unknownTestNames("the three `test_priceFromSqrt` tests", names)).toEqual([
      { line: 1, text: "test_priceFromSqrt: 2 tests start so, not 3" },
    ]);
    // Without "the two ... tests" around it, a prefix is a misspelt name.
    expect(unknownTestNames("`test_priceFromSqrt`", names)).toEqual([{ line: 1, text: "test_priceFromSqrt" }]);
  });

  it("quotedTestTitles reads the quoted titles in a line or table cell that links a test file under agent/test", () => {
    const url = (file: string) => `${repo}/blob/main/agent/test/${file}`;
    const src = [
      `| Row | [\`runOnce.test.ts\`](${url("runOnce.test.ts")}): "halts", "drops" | The README calls this row "Exactly-once sends" |`,
      `See "a title" in [\`sender.test.ts\`](${url("sender.test.ts")}), and [\`lock.test.ts\`](${url("lock.test.ts")}).`,
      `A quote "elsewhere", and [the fakes](${repo}/tree/main/agent/test/fakes) "not a file".`,
      "```ts",
      `it("in a fence", () => {}); // ${url("x.test.ts")}`,
      "```",
      `<Callout title="An attribute">See [\`a.test.ts\`](${url("a.test.ts")}) and \`"inline code"\`.</Callout>`,
    ].join("\n");
    expect(quotedTestTitles(src, repo)).toEqual([
      { line: 1, text: "halts", files: ["agent/test/runOnce.test.ts"] },
      { line: 1, text: "drops", files: ["agent/test/runOnce.test.ts"] },
      { line: 2, text: "a title", files: ["agent/test/sender.test.ts", "agent/test/lock.test.ts"] },
    ]);
  });

  it("codedTestTitles reads each code span with a space in a line or table cell that names a test file under agent/test", () => {
    const files = ["agent/test/policy.test.ts", "agent/test/runOnce.test.ts", "agent/test/integration/agent.fork.test.ts"];
    const fork = `${repo}/blob/main/agent/test/integration/agent.fork.test.ts`;
    const src = [
      "---",
      "description: `in frontmatter` in `agent/test/policy.test.ts`",
      "---",
      "The test `all cash: buys` in `agent/test/policy.test.ts` pins `BUY` and `BORROW` (`caps a buy`).",
      "Billed anyway (`bills a failed call` in `runOnce.test.ts`).",
      `See [\`agent.fork.test.ts\`](${fork}): \`use as collateral\`, run by \`npm run test:integration\`.`,
      "| `in another cell` | `runOnce.test.ts`: `halts now` |",
      "`no agent test here` beside `web/test/facts.test.ts` and `lock.test.ts`.",
      "```ts",
      "`in a fence` in `agent/test/policy.test.ts`",
      "```",
    ].join("\n");
    expect(codedTestTitles(src, repo, files)).toEqual([
      { line: 4, text: "all cash: buys", files: ["agent/test/policy.test.ts"] },
      { line: 4, text: "caps a buy", files: ["agent/test/policy.test.ts"] },
      { line: 5, text: "bills a failed call", files: ["agent/test/runOnce.test.ts"] },
      { line: 6, text: "use as collateral", files: ["agent/test/integration/agent.fork.test.ts"] },
      { line: 7, text: "halts now", files: ["agent/test/runOnce.test.ts"] },
    ]);
  });

  it("testNameLinks reads every link whose text is a test name, with the file it opens", () => {
    const src = [
      `[\`test_replayReverts\`](${repo}/blob/main/contracts/test/MandateVault.t.sol) and [the file](${repo}/blob/main/contracts/test/GuardLib.t.sol).`,
      "```md",
      `[\`test_inFence\`](${repo}/blob/main/contracts/test/MandateVault.t.sol)`,
      "```",
      `[\`test_concentration\`](${repo}/blob/main/contracts/test/MandateVault.t.sol#L9), [\`test_x\`](https://github.com/other/repo/blob/main/a.t.sol)`,
    ].join("\n");
    expect(testNameLinks(src, repo)).toEqual([
      { line: 1, name: "test_replayReverts", file: "contracts/test/MandateVault.t.sol" },
      { line: 5, name: "test_concentration", file: "contracts/test/MandateVault.t.sol" },
    ]);
  });
});

describe("notDeployedClaims", () => {
  it("finds each phrase that says nothing is deployed, in any case, one finding per line, in frontmatter, JSX, tables and prose", () => {
    const src = [
      "---",
      'description: "No audit, no mainnet deployment yet."',
      "---",
      '<Callout type="fork" title="Not deployed yet">',
      "Nothing is deployed, and no Maat vault is deployed.",
      "| Deployment | None. No Maat contract is deployed |",
      "No vault is deployed. No Maat calendar is deployed. The team has deployed no vault; it has deployed none.",
      "The owner has not broadcast it. Nothing was broadcast, and nothing has been broadcast.",
      "## Not on mainnet yet",
      "It is fork-tested, not live, and none is live: there is no live vault and no live system to probe.",
      "The address table is empty today. No mainnet deploy has been run.",
      "| Is Maat deployed to [Base](/docs/help/glossary#base) mainnet? | No | x |",
    ].join("\n");
    expect(notDeployedClaims(src)).toEqual([
      { line: 2, text: "no mainnet deployment" },
      { line: 4, text: "Not deployed" },
      { line: 5, text: "Nothing is deployed, no Maat vault is deployed" },
      { line: 6, text: "No Maat contract is deployed" },
      { line: 7, text: "No vault is deployed, No Maat calendar is deployed, has deployed no, has deployed none" },
      { line: 8, text: "has not broadcast, Nothing was broadcast, nothing has been broadcast" },
      { line: 9, text: "Not on mainnet" },
      { line: 10, text: "not live, none is live, no live vault, no live system" },
      { line: 11, text: "empty today, No mainnet deploy" },
      { line: 12, text: "deployed to [Base](/docs/help/glossary#base) mainnet? | No" },
    ]);
  });

  it("leaves out what stays true after a deploy: a fork run broadcasts nothing, the agent's own mode, what a deployed vault does, a question answered otherwise", () => {
    const src = [
      "Nothing is broadcast: Foundry forks the chain locally.",
      "The agent has not run live.",
      "Once a vault is deployed on Base mainnet, the same steps read it.",
      "On a Saturday the DEX price has no live reference.",
      "| Has a third party audited the contracts? | No | x |",
      "| Is Maat deployed to Base mainnet? | Yes | x |",
    ].join("\n");
    expect(notDeployedClaims(src)).toEqual([]);
  });
});
