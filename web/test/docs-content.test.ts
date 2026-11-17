// @vitest-environment node
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  codedTestTitles,
  docsLinks,
  excerpts,
  factNames,
  foreignCharacters,
  frontmatterOf,
  handTypedFacts,
  headingIds,
  malformedExcerptTitles,
  quotedTestTitles,
  repoPaths,
  testNameLinks,
  unknownTestNames,
} from "@/lib/docs/content-checks";
import { FACT_TEXT_MAP, isFactName } from "@/lib/docs/fact-text";
import { docsFrontmatter } from "@/lib/docs/frontmatter";
import { DOCS_IA } from "@/lib/docs/ia";
import { docsSlug, headingId, urlSlug } from "@/lib/docs/links";
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
 * The messages a page quotes under the H2 whose id is `id`, up to the next H2: the inline code in the first cell of
 * each table row. A placeholder such as <FILE> stands for a value the code puts in.
 */
function quotedMessages(source: string, id: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  let inside = false;
  source
    .replace(FENCED, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .forEach((line, i) => {
      const h2 = /^##\s+(.+?)\s*$/.exec(line)?.[1];
      if (h2 !== undefined) inside = headingId(h2) === id;
      else if (inside && line.startsWith("|")) {
        const cell = line.split(/(?<!\\)\|/)[1] ?? "";
        for (const [, text = ""] of cell.matchAll(/`([^`\n]+)`/g)) out.push({ line: i + 1, text });
      }
    });
  return out;
}

/** The quoted messages that no file of `code` holds word for word: each piece between placeholders must be in one file. */
function unknownMessages(messages: readonly { line: number; text: string }[], code: ReadonlyMap<string, string>) {
  return messages.filter((m) => {
    const pieces = m.text.split(/<[A-Z][A-Z_]*>/).filter((p) => p !== "");
    return ![...code.values()].some((src) => pieces.every((p) => src.includes(p)));
  });
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
