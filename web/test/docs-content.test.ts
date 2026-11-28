// @vitest-environment node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { ABI_NOTE } from "@/lib/docs/abi";
import {
  codedTestTitles,
  docsLinks,
  excerpts,
  factNames,
  foreignCharacters,
  foreignGithubLinks,
  frontmatterOf,
  handTypedFacts,
  headingIds,
  malformedExcerptTitles,
  notDeployedClaims,
  quotedTestTitles,
  repoPaths,
  testNameLinks,
  unknownTestNames,
} from "@/lib/docs/content-checks";
import { type Deployment, parseDeployments } from "@/lib/docs/docs-data";
import { FACT_TEXT_MAP, isFactName } from "@/lib/docs/fact-text";
import { docsFrontmatter } from "@/lib/docs/frontmatter";
import { DOCS_IA } from "@/lib/docs/ia";
import { docsSlug, headingId, urlSlug } from "@/lib/docs/links";
import { hasAddress } from "@/lib/docs/reference-labels";
import { collectTestLines } from "@/lib/docs/remark-test-anchors";
import { SITE } from "@/lib/site";
import { docsPages } from "./helpers/docs";
import { REPO_ROOT, readRepo } from "./helpers/solidity";

// The content gates (docs spec §8, gates 1, 2, 5, 6 and the excerpt rule) over every page in content/docs.
// A failure names the file, the line and what is wrong: fix the page, not the gate.

const pages = docsPages();
const bySlug = new Map(pages.map((p) => [p.slug, p.source]));
const ia = new Map(DOCS_IA.flatMap((s) => s.pages).map((p) => [p.slug, p]));
const at = (slug: string, f: { line: number; text: string }) => `content/docs/${slug}.mdx:${f.line} ${f.text}`;

/**
 * The IA page a docs link opens, or undefined if it opens none. Fumadocs serves a folder's index.mdx at the folder's
 * URL: /docs/concepts is concepts/index, and /docs/concepts/index is no page at all.
 */
const byUrl = new Map([...ia.keys()].map((slug) => [urlSlug(slug).join("/"), slug]));
const linkedPage = (href: string) => byUrl.get((docsSlug(href) ?? []).join("/"));

describe("a docs link opens the IA page Fumadocs serves at its URL (gate 2)", () => {
  it.each([
    ["/docs", "index"],
    ["/docs/concepts", "concepts/index"],
    ["/docs/concepts#x", "concepts/index"],
    ["/docs/concepts/nine-checks#why-the-order-matters", "concepts/nine-checks"],
    ["/docs/concepts/index", undefined],
    ["/docs/index", undefined],
    ["/docs/concepts/not-a-page", undefined],
  ])("%s", (href, slug) => {
    expect(linkedPage(href)).toBe(slug);
  });
});

/** The tests in contracts/test and agent/test, with the line each starts on, read from the sources now. */
const TESTS = collectTestLines(REPO_ROOT);
const SOLIDITY_TESTS = new Set(
  Object.entries(TESTS)
    .filter(([file]) => file.startsWith("contracts/"))
    .flatMap(([, tests]) => Object.keys(tests)),
);

const testSources = new Map<string, string>();
/** Whether the test file holds `text` as a double-quoted string, as a title or as a value such as a rationale. */
const quotes = (file: string, text: string) => {
  if (!testSources.has(file)) testSources.set(file, readRepo(file));
  return testSources.get(file)?.includes(JSON.stringify(text)) ?? false;
};

/**
 * Every test a page cites that does not exist (test gate): a Solidity test name in inline code, a quoted Vitest title
 * beside a link to its file, a phrase in inline code beside an agent test file that is neither a title nor a string of
 * that file, and a link whose text is a test name but whose file does not define that test, which remarkTestAnchors
 * could then not point at the test's line.
 */
function missingTests(slug: string, source: string): string[] {
  const bad = unknownTestNames(source, SOLIDITY_TESTS).map((f) => at(slug, f));
  for (const q of quotedTestTitles(source, SITE.repoUrl)) {
    if (!q.files.some((file) => TESTS[file]?.[q.text] !== undefined)) {
      bad.push(at(slug, { line: q.line, text: `"${q.text}" is no it() or describe() title in ${q.files.join(" or ")}` }));
    }
  }
  for (const c of codedTestTitles(source, SITE.repoUrl, Object.keys(TESTS))) {
    if (!c.files.some((file) => TESTS[file]?.[c.text] !== undefined || quotes(file, c.text))) {
      bad.push(at(slug, { line: c.line, text: `\`${c.text}\` is no it() or describe() title, nor a string, in ${c.files.join(" or ")}` }));
    }
  }
  for (const l of testNameLinks(source, SITE.repoUrl)) {
    if (TESTS[l.file]?.[l.name] === undefined) bad.push(at(slug, { line: l.line, text: `${l.name} is not defined in ${l.file}` }));
  }
  return bad;
}

describe("the test gate", () => {
  const vault = `${SITE.repoUrl}/blob/main/contracts/test/MandateVault.t.sol`;
  const runOnce = `${SITE.repoUrl}/blob/main/agent/test/runOnce.test.ts`;

  it("passes the tests the pages cite today, in each of the forms they use", () => {
    const page = [
      `[\`test_replayReverts\`](${vault}) and the other \`test_reverting*FailsClosed\` tests, and the two \`test_priceFromSqrt\` tests.`,
      `[\`runOnce.test.ts\`](${runOnce}): "halts when the preview said OK but the vault refused"`,
      "The test `all cash: buys each token toward 23.33%, capped by spendable cash` in `agent/test/policy.test.ts`, then `npm test`.",
      "(`bills a failed Claude call and still settles bills` in `runOnce.test.ts`)",
      // A string the test holds, not a title: the fork test's rationales.
      "`NVDAc underweight` and `use as collateral` (`agent/test/integration/agent.fork.test.ts`)",
    ].join("\n");
    expect(missingTests("x", page)).toEqual([]);
  });

  it("catches a misspelt test name, a misspelt title and a test linked to the wrong file", () => {
    const page = [
      "A replay reverts (`test_replayRevert`).",
      `[\`runOnce.test.ts\`](${runOnce}): "halts when the preview said ok but the vault refused"`,
      `[\`test_executorCannotUseOwnerFunctions\`](${vault})`,
      "The policy caps a buy (`caps a buy at perTradeCap` in `agent/test/policy.test.ts`).",
    ].join("\n");
    expect(missingTests("x", page)).toEqual([
      "content/docs/x.mdx:1 test_replayRevert",
      'content/docs/x.mdx:2 "halts when the preview said ok but the vault refused" is no it() or describe() title in agent/test/runOnce.test.ts',
      "content/docs/x.mdx:4 `caps a buy at perTradeCap` is no it() or describe() title, nor a string, in agent/test/policy.test.ts",
      "content/docs/x.mdx:3 test_executorCannotUseOwnerFunctions is not defined in contracts/test/MandateVault.t.sol",
    ]);
  });
});

const FENCED = /^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm;

/** The agent's code: every .ts file under agent/src and agent/scripts, by repo path, read from the sources now. */
function agentCode(): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const e of readdirSync(join(REPO_ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (e.name.endsWith(".ts")) out.set(rel, readRepo(rel));
    }
  };
  walk("agent/src");
  walk("agent/scripts");
  return out;
}

/** The id of the H2 on Agent scripts that lists the agent's messages. */
const MESSAGES_ID = "messages-the-agent-prints-from-the-code-and-unit-tests-none-seen-in-a-live-run";

/**
 * The inline code in the table rows under the H2 whose id is `id`, up to the next H2, with its line and the cell it
 * is in (1 is the first cell).
 */
function sectionCode(source: string, id: string): { line: number; cell: number; text: string }[] {
  const out: { line: number; cell: number; text: string }[] = [];
  let inside = false;
  source
    .replace(FENCED, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .forEach((line, i) => {
      const h2 = /^##\s+(.+?)\s*$/.exec(line)?.[1];
      if (h2 !== undefined) inside = headingId(h2) === id;
      else if (inside && line.startsWith("|")) {
        line
          .split(/(?<!\\)\|/)
          .slice(1)
          .forEach((cell, c) => {
            for (const [, text = ""] of cell.matchAll(/`([^`\n]+)`/g)) out.push({ line: i + 1, cell: c + 1, text });
          });
      }
    });
  return out;
}

/**
 * The messages a page quotes under the H2 whose id is `id`, up to the next H2: the inline code in the first cell of
 * each table row. A placeholder such as <FILE> stands for a value the code puts in.
 */
function quotedMessages(source: string, id: string): { line: number; text: string }[] {
  return sectionCode(source, id)
    .filter((c) => c.cell === 1)
    .map(({ line, text }) => ({ line, text }));
}

const isPlaceholder = (token: string) => /^<[A-Z][A-Z_]*>$/.test(token);
/** A message split into its literal pieces and its placeholders, in order. */
const tokensOf = (text: string) => text.split(/(<[A-Z][A-Z_]*>)/).filter((t) => t !== "");
/** One template expression, `${...}`, with at most one level of braces inside it. */
const EXPRESSION = String.raw`\$\{(?:[^{}]|\{[^{}]*\})*\}`;

/**
 * A whole string literal in the code that reads `tokens`, opened and closed by the same quote: the pieces in order and
 * next to each other, each placeholder one `${...}`.
 */
function literalPattern(tokens: readonly string[]): RegExp {
  const body = tokens.map((t) => (isPlaceholder(t) ? EXPRESSION : t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("");
  return new RegExp("([`\"'])" + body + "\\1");
}

/**
 * Whether `src` holds the message `tokens` as one string literal. A message may also be a literal that ends in one
 * `${...}` standing for the rest of the message from a placeholder on, when that rest is itself a literal in `src`:
 * `invalid agent config: ${msg}`, where `msg` is built from `${...}: ${...}`.
 */
function holds(src: string, tokens: readonly string[]): boolean {
  if (literalPattern(tokens).test(src)) return true;
  return tokens.some(
    (t, k) =>
      k > 0 &&
      isPlaceholder(t) &&
      tokens.slice(k).some((u) => !isPlaceholder(u)) &&
      literalPattern([...tokens.slice(0, k), t]).test(src) &&
      holds(src, tokens.slice(k)),
  );
}

/** The quoted messages that no file of `code` holds word for word, as one string literal (see holds()). */
function unknownMessages(messages: readonly { line: number; text: string }[], code: ReadonlyMap<string, string>) {
  return messages.filter((m) => ![...code.values()].some((src) => holds(src, tokensOf(m.text))));
}

/**
 * The examples of `invalid agent config` that the section gives after the first cell of a row, with the setting
 * and the problem filled in.
 */
function configExamples(source: string, id: string): { line: number; text: string; setting: string; problem: string }[] {
  return sectionCode(source, id).flatMap((c) => {
    const m = c.cell > 1 ? /^invalid agent config: ([A-Z][A-Z0-9_]*): (.+)$/.exec(c.text) : null;
    return m ? [{ line: c.line, text: c.text, setting: m[1] ?? "", problem: m[2] ?? "" }] : [];
  });
}

/** The examples whose setting `config` does not name, or whose problem is not one string literal in `config`. */
function unknownConfigExamples(examples: ReturnType<typeof configExamples>, config: string) {
  return examples.filter((e) => !new RegExp(`\\b${e.setting}\\b`).test(config) || !holds(config, tokensOf(e.problem)));
}

describe("the agent's messages on Agent scripts (quoted-message gate)", () => {
  const code = agentCode();
  const page = [
    "## Messages the agent prints (from the code and unit tests; none seen in a live run)",
    "",
    "| Message | What it means |",
    "| --- | --- |",
    "| `lock file unreadable; delete if no agent runs` | x |",
    "| `another agent (pid <PID>) is running; lock <FILE>` | `not a message` |",
    "| `lock file is unreadable; delete if no agent runs` | x |",
    "",
    "## Related",
    "",
    "| `not a message either` | x |",
  ].join("\n");

  it("are each still in agent/src or agent/scripts, word for word", () => {
    const messages = quotedMessages(bySlug.get("reference/agent-scripts") ?? "", MESSAGES_ID);
    expect(messages.length, `reference/agent-scripts has no message table under #${MESSAGES_ID}`).toBeGreaterThan(0);
    expect(unknownMessages(messages, code).map((f) => at("reference/agent-scripts", f))).toEqual([]);
  });

  it("are where Troubleshooting sends a reader whose agent stopped or printed an error", () => {
    expect(docsLinks(bySlug.get("help/troubleshooting") ?? "")).toContain(`/docs/reference/agent-scripts#${MESSAGES_ID}`);
  });

  it("reads the first cell of each row in the section, with a placeholder for each value the code puts in", () => {
    expect(quotedMessages(page, MESSAGES_ID).map((m) => m.text)).toEqual([
      "lock file unreadable; delete if no agent runs",
      "another agent (pid <PID>) is running; lock <FILE>",
      "lock file is unreadable; delete if no agent runs",
    ]);
  });

  it("fails a message reworded on the page, and one reworded in the code", () => {
    const messages = quotedMessages(page, MESSAGES_ID);
    expect(unknownMessages(messages, code).map((f) => at("x", f))).toEqual(["content/docs/x.mdx:7 lock file is unreadable; delete if no agent runs"]);
    const reworded = new Map(code);
    reworded.set("agent/src/loop/lock.ts", (code.get("agent/src/loop/lock.ts") ?? "").replace("lock file unreadable", "lock file not readable"));
    expect(unknownMessages(messages, reworded).map((f) => f.line)).toEqual([5, 7]);
  });

  it("fails a message whose words now occur only inside another message, or only as a fragment", () => {
    const messages = [
      { line: 1, text: "claude: <ERROR>" },
      { line: 2, text: "invalid agent config: <SETTING>: <PROBLEM>" },
      { line: 3, text: "agent (pid <PID>) is running" },
      // Cut at a quote inside the message: `CDP account "${...}" is ${...}, ...` opens with a backtick, not that quote.
      { line: 4, text: 'CDP account "<NAME>' },
    ];
    expect(unknownMessages(messages, code).map((f) => f.line)).toEqual([3, 4]);
    const reworded = new Map(code);
    reworded.set("agent/src/llm/proposer.ts", (code.get("agent/src/llm/proposer.ts") ?? "").replace("`claude: ${", "`anthropic: ${"));
    reworded.set("agent/src/config.ts", (code.get("agent/src/config.ts") ?? "").replace('${i.path.join(".")}: ${i.message}', '${i.path.join(".")} - ${i.message}'));
    expect(unknownMessages(messages, reworded).map((f) => f.line)).toEqual([1, 2, 3, 4]);
  });

  it("has each example of invalid agent config name a setting and a problem that agent/src/config.ts gives", () => {
    const config = code.get("agent/src/config.ts") ?? "";
    const examples = configExamples(bySlug.get("reference/agent-scripts") ?? "", MESSAGES_ID);
    expect(examples.length, "reference/agent-scripts gives no filled-in example of invalid agent config").toBeGreaterThan(0);
    expect(unknownConfigExamples(examples, config).map((f) => at("reference/agent-scripts", f))).toEqual([]);
  });

  it("reads the examples of invalid agent config after the first cell, and fails one whose problem is reworded in the code", () => {
    const examplePage = [
      "## Messages the agent prints (from the code and unit tests; none seen in a live run)",
      "",
      "| Message | What it means |",
      "| --- | --- |",
      "| `invalid agent config: <SETTING>: <PROBLEM>` | Live mode gives `invalid agent config: MAAT_BUILDER_CODE: MAAT_BUILDER_CODE is required in live mode`. |",
      "| `invalid agent config: MAAT_VAULT: not an example` | x |",
    ].join("\n");
    const examples = configExamples(examplePage, MESSAGES_ID);
    expect(examples.map((e) => [e.line, e.setting, e.problem])).toEqual([[5, "MAAT_BUILDER_CODE", "MAAT_BUILDER_CODE is required in live mode"]]);
    const config = code.get("agent/src/config.ts") ?? "";
    expect(unknownConfigExamples(examples, config)).toEqual([]);
    const reworded = config.replace('"MAAT_BUILDER_CODE is required in live mode"', '"MAAT_BUILDER_CODE must be set in live mode"');
    expect(unknownConfigExamples(examples, reworded).map((f) => f.line)).toEqual([5]);
  });
});

/**
 * Code whose words a reader gets and no test ties to a page, so the launch list reads it too: lib/docs/abi.ts holds
 * ABI_NOTE, the note in every /data/abi/<name>.json. The status lines of the Markdown copies and of the labels are tied
 * to the pages that say them (test/docs-page.test.tsx), and reference-labels.ts holds the deployments table's own
 * sentence for a table with no address, which the site shows only while no row has one.
 */
const LAUNCH_CODE = ["lib/docs/abi.ts"] as const;

/** A file the launch list reads, by its path in web/, and its text with LF line endings. */
interface LaunchFile {
  readonly file: string;
  readonly source: string;
}

/** Every docs page, as content/docs/<slug>.mdx, then every file of LAUNCH_CODE. */
const launchFiles = (): LaunchFile[] => [
  ...pages.map((p) => ({ file: `content/docs/${p.slug}.mdx`, source: p.source })),
  ...LAUNCH_CODE.map((file) => ({ file, source: readRepo(`web/${file}`).replace(/\r\n/g, "\n") })),
];

/**
 * Every line of `files` that says nothing is deployed (notDeployedClaims), by file and line, once a row of the table in
 * deployments/README.md has an address (docs:gen accepts only Base mainnet rows, each with an empty Address cell or a
 * full address); nothing while no row has one.
 */
function launchList(deployments: readonly Deployment[], files: readonly LaunchFile[] = launchFiles()): string[] {
  if (!deployments.some(hasAddress)) return [];
  return files.flatMap(({ file, source }) => notDeployedClaims(source).map((f) => `${file}:${f.line} ${f.text}`));
}

describe("the launch list: once deployments/README.md records Maat's Base mainnet addresses, no page may say nothing is deployed", () => {
  const readme = readRepo("deployments/README.md").replace(/\r\n/g, "\n");
  /** Each Base mainnet row of the table, whatever its Address, Tx and Date cells hold; $1 is the contract. */
  const ROW = /^\| Base mainnet \| (\w+) \|.*$/gm;
  /** The table as it was before the deploy: the same rows, each with empty Address, Tx and Date cells. */
  const emptied = readme.replace(ROW, "| Base mainnet | $1 | | | |");
  /** A row with test values: the address and the deploy transaction are the digit repeated, linked as the table links them. */
  const filledRow = (contract: string, digit: number) => {
    const address = `0x${String(digit).repeat(40)}`;
    const tx = `0x${String(digit).repeat(64)}`;
    return `| Base mainnet | ${contract} | [\`${address}\`](https://basescan.org/address/${address}) | [\`${tx}\`](https://basescan.org/tx/${tx}) | |`;
  };
  /** The table with every row filled with test values. Parsed inside each test, so a bad table fails that test only. */
  const recorded = () => {
    let digit = 0;
    return parseDeployments(readme.replace(ROW, (_row, contract: string) => filledRow(contract, ++digit)));
  };
  /** `table` with the Base mainnet row of `contract` replaced by `row`. */
  const withRow = (table: string, contract: string, row: string) =>
    table.replace(new RegExp(`^\\| Base mainnet \\| ${contract} \\|.*$`, "m"), row);
  /** The line number of the first line of `source` that holds `text`; 0 when none does. */
  const lineOf = (source: string, text: string) => source.split("\n").findIndex((l) => l.includes(text)) + 1;

  it("tests with the five rows of the table filled with test values, and with all of them empty", () => {
    // The four contracts of Deploy.s.sol and the inbox of DeployMaatInbox.s.sol (test/docs-gen.test.ts reads them).
    const five = ["MarketCalendar", "AerodromeSwapAdapter", "AaveV4CreditAdapter", "MandateVault", "MaatInbox"];
    expect(recorded().filter(hasAddress).map((d) => d.contract)).toEqual(five);
    expect(parseDeployments(emptied).map((d) => [d.contract, hasAddress(d)])).toEqual(five.map((c) => [c, false]));
  });

  it("reads every docs page and the ABI files' note, and lists a line that says nothing is deployed by its file and line", () => {
    expect(launchFiles().map((f) => f.file)).toEqual(
      expect.arrayContaining(["content/docs/index.mdx", "content/docs/get-started/status.mdx", "content/docs/security/not-claimed.mdx", ...LAUNCH_CODE]),
    );
    // Copies of real files, each with one line put back as it was before the deploy: a table cell, a component's
    // attribute and a string in code.
    const status = bySlug.get("get-started/status") ?? "";
    const notClaimed = bySlug.get("security/not-claimed") ?? "";
    const abi = readRepo("web/lib/docs/abi.ts").replace(/\r\n/g, "\n");
    const LIVE_ROW = /^(\| <StatusBadge status="live" \/> \|[^|]*\|).*$/m;
    const WARNING = /^<Callout type="warning" title="[^"]*">$/m;
    expect(status).toMatch(LIVE_ROW);
    expect(notClaimed).toMatch(WARNING);
    expect(abi).toContain(ABI_NOTE);
    const stale: LaunchFile[] = [
      { file: "content/docs/get-started/status.mdx", source: status.replace(LIVE_ROW, "$1 None. No Maat contract is deployed. |") },
      { file: "content/docs/security/not-claimed.mdx", source: notClaimed.replace(WARNING, '<Callout type="warning" title="Unaudited and not on mainnet">') },
      { file: "lib/docs/abi.ts", source: abi.replace(ABI_NOTE, `Not deployed. ${ABI_NOTE}`) },
    ];
    expect(launchList(recorded(), stale)).toEqual([
      `content/docs/get-started/status.mdx:${lineOf(status, '| <StatusBadge status="live" />')} No Maat contract is deployed`,
      `content/docs/security/not-claimed.mdx:${lineOf(notClaimed, '<Callout type="warning"')} not on mainnet`,
      `lib/docs/abi.ts:${lineOf(abi, ABI_NOTE)} Not deployed`,
    ]);
  });

  it("lists nothing while no row has an address and starts once any row has one; docs:gen refuses a row on another network or a placeholder", () => {
    const stale: LaunchFile = { file: "content/docs/x.mdx", source: "Nothing is deployed yet." };
    expect(launchList(parseDeployments(emptied), [stale])).toEqual([]);
    expect(launchList(parseDeployments(withRow(emptied, "MandateVault", filledRow("MandateVault", 1))), [stale])).toEqual([
      "content/docs/x.mdx:1 Nothing is deployed",
    ]);
    expect(launchList(recorded(), [stale])).toEqual(["content/docs/x.mdx:1 Nothing is deployed"]);
    const vault = `0x${"1".repeat(40)}`;
    expect(() => parseDeployments(withRow(readme, "MandateVault", `| Base Sepolia | MandateVault | ${vault} | | |`))).toThrow("not Base mainnet");
    expect(() => parseDeployments(withRow(readme, "MandateVault", "| Base mainnet | MandateVault | TBD | | |"))).toThrow("not an empty cell");
  });

  it("finds no line, on a docs page or in the ABI files' note, that says nothing is deployed, with the table deployments/README.md holds", () => {
    expect(launchList(parseDeployments(readme))).toEqual([]);
  });

  it("finds none either with all five rows of the table filled with test values", () => {
    expect(launchList(recorded())).toEqual([]);
  });
});

/** The repository's owner on GitHub, read from SITE.repoUrl. */
const REPO_OWNER = new URL(SITE.repoUrl).pathname.split("/")[1] ?? "";
/** The outside repositories the docs and READMEs cite, each checked to resolve on 2026-11-28. */
const CITED_REPOS = new Set(["base/base-anvil", "Cyfrin/aderyn", "ethereum/solidity"]);

describe("GitHub links in the docs and the READMEs", () => {
  it("reads the owner from SITE.repoUrl", () => {
    expect(REPO_OWNER).toBe("duongnq2798");
  });

  it("go to this repository's owner, or to an outside repository the pages cite", () => {
    const readmes = tracked().filter((p) => /(^|\/)(README|SECURITY)\.md$/.test(p) && !p.startsWith("docs/superpowers/"));
    expect(readmes).toContain("README.md");
    const files = [...pages.map((p) => [`web/content/docs/${p.slug}.mdx`, p.source] as const), ...readmes.map((p) => [p, readRepo(p)] as const)];
    const bad = files.flatMap(([file, source]) => foreignGithubLinks(source, REPO_OWNER, CITED_REPOS).map((f) => `${file}:${f.line} ${f.text}`));
    expect(bad).toEqual([]);
  });
});

let trackedPaths: readonly string[] | undefined;
/** Every path the repository tracks, as `git ls-files` lists it: a submodule is one path, its folder's. */
const tracked = () =>
  (trackedPaths ??= execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n")
    .filter((p) => p !== ""));

/** A body row of a table: the repo path its first cell names, and the docs pages its last cell links. */
interface MapRow {
  /** Which table of the page the row is in, from 0. */
  readonly table: number;
  readonly line: number;
  /** As the cell shows it, a folder with a trailing "/"; undefined when the cell is not one such path linked to itself. */
  readonly path?: string;
  readonly readFirst: readonly string[];
}

/**
 * The body rows of every table on a page, outside fenced code. A first cell names its path in code, linked to that path
 * on GitHub: [`agent/src/ledger/`](<repo>/tree/main/agent/src/ledger) for a folder, and
 * [`agent/src/policy.ts`](<repo>/blob/main/agent/src/policy.ts) for a file.
 */
function mapRows(source: string, repoUrl: string): MapRow[] {
  const cell = new RegExp(`^\\[\`([^\`]+)\`\\]\\(${repoUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/(tree|blob)/main/([^)\\s#]+)\\)$`);
  const out: MapRow[] = [];
  let table = -1;
  let row = 0;
  source
    .replace(FENCED, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .forEach((line, i) => {
      if (!line.startsWith("|")) {
        row = 0;
        return;
      }
      if (row++ === 0) table++;
      // The header row and the separator under it.
      if (row <= 2) return;
      const cells = line.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
      const [, shown, kind, target] = cell.exec(cells[0] ?? "") ?? [];
      const linked = shown !== undefined && (kind === "tree" ? shown === `${target}/` : shown === target);
      out.push({ table, line: i + 1, path: linked ? shown : undefined, readFirst: docsLinks(cells.at(-1) ?? "") });
    });
  return out;
}

/** The paths the repository does not track, or that name a folder as a file or a file as a folder (its trailing "/"). */
function misnamedPaths(paths: readonly string[], files: readonly string[]): string[] {
  return paths.filter((path) => {
    const bare = path.replace(/\/$/, "");
    const known = files.some((p) => p === bare || p.startsWith(`${bare}/`));
    return !known || !existsSync(join(REPO_ROOT, bare)) || statSync(join(REPO_ROOT, bare)).isDirectory() !== path.endsWith("/");
  });
}

describe("the repository map maps folders that exist to the pages that explain them", () => {
  const MAP = "reference/repository-map";
  const repo = SITE.repoUrl;
  const rows = mapRows(bySlug.get(MAP) ?? "", repo);

  it("reads each row's linked path and its Read first links, and no path from a cell that does not link it to itself", () => {
    const page = [
      "| Folder | What is in it | Read first |",
      "| --- | --- | --- |",
      `| [\`agent/\`](${repo}/tree/main/agent) | x | [Run the agent](/docs/guides/run-the-agent) |`,
      `| [\`agent/src/policy.ts\`](${repo}/blob/main/agent/src/policy.ts) | x | [A](/docs/a), then [B](/docs/b#c) |`,
      "| `agent/` | not linked | [Run the agent](/docs/guides/run-the-agent) |",
      `| [\`agent/src/\`](${repo}/tree/main/agent) | linked to another folder | none |`,
      "",
      "| File | What is in it | Read first |",
      "| --- | --- | --- |",
      `| [\`web/\`](${repo}/blob/main/web) | a folder linked as a file | [A](/docs/a) |`,
    ].join("\n");
    expect(mapRows(page, repo)).toEqual([
      { table: 0, line: 3, path: "agent/", readFirst: ["/docs/guides/run-the-agent"] },
      { table: 0, line: 4, path: "agent/src/policy.ts", readFirst: ["/docs/a", "/docs/b#c"] },
      { table: 0, line: 5, path: undefined, readFirst: ["/docs/guides/run-the-agent"] },
      { table: 0, line: 6, path: undefined, readFirst: [] },
      { table: 1, line: 10, path: undefined, readFirst: ["/docs/a"] },
    ]);
  });

  it("gives every row one repo path, linked to itself, and a Read first link to a docs page", () => {
    expect(rows.length, `content/docs/${MAP}.mdx has no table rows`).toBeGreaterThan(0);
    expect(
      rows.flatMap((r) => [
        ...(r.path === undefined ? [at(MAP, { line: r.line, text: "the first cell is not one repo path linked to itself" })] : []),
        ...(r.readFirst.length === 0 ? [at(MAP, { line: r.line, text: "the Read first cell links no docs page" })] : []),
      ]),
    ).toEqual([]);
  });

  it("lists in its first table each top-level folder the repository tracks, and nothing else", () => {
    const top = [...new Set(tracked().flatMap((p) => (p.includes("/") ? [`${p.split("/")[0]}/`] : [])))].sort();
    expect(top).toContain("contracts/");
    expect(rows.filter((r) => r.table === 0).map((r) => r.path ?? `line ${r.line}`).sort()).toEqual(top);
  });

  it("names in code each file the repository tracks at its root", () => {
    const rootFiles = tracked().filter((p) => !p.includes("/"));
    expect(rootFiles).toContain("README.md");
    const page = bySlug.get(MAP) ?? "";
    expect(rootFiles.filter((f) => !page.includes(`\`${f}\``))).toEqual([]);
  });

  it("names only folders and files the repository tracks, a folder with a trailing slash and a file without", () => {
    const named = rows.flatMap((r) => (r.path === undefined ? [] : [r]));
    const bad = new Set(misnamedPaths(named.map((r) => r.path ?? ""), tracked()));
    expect(named.filter((r) => bad.has(r.path ?? "")).map((r) => at(MAP, { line: r.line, text: r.path ?? "" }))).toEqual([]);
  });

  it("fails a path the repository does not track, a file named as a folder and a folder named as a file", () => {
    const paths = ["agent/src/", "agent/src/policy.ts", "contracts/lib/", "agent/src/nope/", "agent/src/policy.ts/", "agent/src", "contracts/out/"];
    expect(misnamedPaths(paths, tracked())).toEqual(["agent/src/nope/", "agent/src/policy.ts/", "agent/src", "contracts/out/"]);
  });
});

/**
 * Every heading id on a page that an earlier heading already has (h2 to h6, outside fenced code), with its line.
 * headingIds() in lib/docs/content-checks.ts returns a set, so it cannot see a repeat; the site gives the second
 * heading a suffixed id, and a link to the plain one then lands on the first.
 */
function repeatedHeadingIds(source: string): { line: number; text: string }[] {
  const seen = new Set<string>();
  const out: { line: number; text: string }[] = [];
  source
    .replace(FENCED, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .forEach((line, i) => {
      const text = /^#{2,6}\s+(.+?)\s*#*\s*$/.exec(line)?.[1];
      if (text === undefined) return;
      const id = headingId(text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"));
      if (seen.has(id)) out.push({ line: i + 1, text: `#${id} is already the id of an earlier heading` });
      seen.add(id);
    });
  return out;
}

describe.each(pages.map((p) => [p.slug, p.source] as const))("content/docs/%s.mdx", (slug, source) => {
  // A page whose frontmatter cannot be parsed must fail its own test, not abort the collection of every page.
  let fm: Record<string, unknown> = {};
  let yamlError: string | undefined;
  try {
    fm = (parse(frontmatterOf(source)) ?? {}) as Record<string, unknown>;
  } catch (e) {
    yamlError = `content/docs/${slug}.mdx frontmatter: ${e instanceof Error ? e.message : String(e)}`;
  }

  it("has valid frontmatter with the IA's title and description (gate 1)", () => {
    expect(yamlError).toBeUndefined();
    const r = docsFrontmatter.safeParse(fm);
    expect(r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)).toEqual([]);
    const want = ia.get(slug);
    expect(want, `${slug} is not in lib/docs/ia.ts`).toBeDefined();
    expect({ title: fm.title, description: fm.description }).toEqual({ title: want?.title, description: want?.description });
  });

  it("cites sources that exist and next pages in the IA (gate 1)", () => {
    const sources = (fm.sources ?? []) as string[];
    expect(sources.filter((s) => !existsSync(join(REPO_ROOT, s)))).toEqual([]);
    const next = (fm.next ?? []) as string[];
    expect(next.filter((n) => !ia.has(n))).toEqual([]);
  });

  it("is plain English (gate 6)", () => {
    expect(foreignCharacters(source).map((f) => at(slug, f))).toEqual([]);
  });

  it("renders numbers with <Fact> and only known names (gate 5)", () => {
    expect(handTypedFacts(source, FACT_TEXT_MAP).map((f) => at(slug, f))).toEqual([]);
    expect(factNames(source).filter((f) => !isFactName(f.text)).map((f) => at(slug, f))).toEqual([]);
  });

  it("links to IA pages, to headings that exist, and to repo paths that exist (gate 2)", () => {
    const bad: string[] = [];
    for (const href of docsLinks(source)) {
      const target = linkedPage(href);
      const hash = href.split("#")[1];
      const page = target === undefined ? undefined : bySlug.get(target);
      if (target === undefined) bad.push(`${href}: not a page in lib/docs/ia.ts`);
      // A page in the IA that is not written yet passes; its anchors are checked once it ships.
      else if (hash && page !== undefined && !headingIds(page).has(hash)) bad.push(`${href}: no heading #${hash} on ${target}`);
    }
    for (const p of repoPaths(source, SITE.repoUrl)) if (!existsSync(join(REPO_ROOT, p))) bad.push(`${p}: not in the repo`);
    expect(bad).toEqual([]);
  });

  it("cites tests that exist, each test name linked to the file that defines it (test gate)", () => {
    expect(missingTests(slug, source)).toEqual([]);
  });

  it("gives every heading its own id (anchor gate)", () => {
    expect(repeatedHeadingIds(source).map((f) => at(slug, f))).toEqual([]);
  });

  it("quotes code exactly (excerpt gate)", () => {
    expect(malformedExcerptTitles(source).map((f) => at(slug, f))).toEqual([]);
    for (const e of excerpts(source)) {
      const lines = readRepo(e.file).replace(/\r\n/g, "\n").split("\n").slice(e.from - 1, e.to).join("\n");
      expect(e.body, `content/docs/${slug}.mdx:${e.line} ${e.file}#L${e.from}-L${e.to}`).toBe(lines);
    }
  });
});
