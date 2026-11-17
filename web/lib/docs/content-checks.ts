import { headingId } from "./links";

/** Pure checks over docs MDX source. test/docs-content.test.ts runs them on every page in content/docs. */

/** Symbols the docs may use beyond printable ASCII (spec §8 gate 6). */
export const ALLOWED_SYMBOLS: ReadonlySet<string> = new Set(["·", "≤", "≥", "→", "↗", "−"]);

export interface Finding {
  readonly line: number;
  readonly text: string;
}

const blank = (m: string) => m.replace(/[^\n]/g, " ");
const FENCE = /^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm;

/** The frontmatter block without its `---` lines, or "" when the page has none. */
export function frontmatterOf(source: string): string {
  return /^---\n([\s\S]*?)\n---\n/.exec(source)?.[1] ?? "";
}

/**
 * Characters outside printable ASCII (plus tab and newline) that are not in ALLOWED_SYMBOLS, in prose and
 * frontmatter. Fenced code is exempt: it holds real program output, which may draw boxes or print "…".
 */
export function foreignCharacters(source: string): Finding[] {
  const out: Finding[] = [];
  source
    .replace(FENCE, blank)
    .split("\n")
    .forEach((line, i) => {
      for (const ch of line) {
        const code = ch.codePointAt(0) ?? 0;
        const ascii = code === 9 || code === 13 || (code >= 32 && code <= 126);
        if (!ascii && !ALLOWED_SYMBOLS.has(ch)) out.push({ line: i + 1, text: ch });
      }
    });
  return out;
}

/** The source with frontmatter, fenced code blocks, inline code and JSX tags blanked, keeping line numbers. */
export function prose(source: string): string {
  return source
    .replace(/^---\n[\s\S]*?\n---\n/, blank)
    .replace(FENCE, blank)
    .replace(/`[^`\n]*`/g, blank)
    .replace(/<[A-Za-z][^>]*>/g, blank);
}

/** Variants a hand-typed copy of `text` could take: as shown, and with digit group separators removed. */
function variants(text: string): string[] {
  const plain = text.replace(/(\d)[,_](?=\d{3})/g, "$1");
  return [...new Set([text, plain])];
}

/** A fact is distinctive enough to lint when it has three or more digits, a dollar amount or a bps value. */
export function isDistinctive(text: string): boolean {
  // Dates are left out: milestone and review dates are not facts.
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  return /\d{3,}|\d,\d{3}|\$\d|\bbps\b/.test(text);
}

/** Prose lines that spell out a distinctive fact instead of rendering it with <Fact>. */
export function handTypedFacts(source: string, facts: Readonly<Record<string, string>>): Finding[] {
  const lines = prose(source).split("\n");
  const out: Finding[] = [];
  for (const [name, text] of Object.entries(facts)) {
    if (!isDistinctive(text)) continue;
    for (const v of variants(text)) {
      const re = new RegExp(`(^|[^\\w.,])${v.replace(/[.*+?^${}()|[\]\\$]/g, "\\$&")}(?![\\w]|[.,]\\d)`);
      lines.forEach((l, i) => {
        if (re.test(l)) out.push({ line: i + 1, text: `${name}: "${v}"` });
      });
    }
  }
  return out;
}

/**
 * The phrases a page uses to say that nothing of Maat is deployed. Once deployments/README.md records an address,
 * test/docs-content.test.ts fails on every line that still holds one, so the launch edit starts from a list. Left out
 * are words that stay true after a deploy: a fork run broadcasts nothing ("Nothing is broadcast"), the agent's own
 * mode ("has not run live"), and what a deployed vault would do ("Once a vault is deployed").
 */
const NOT_DEPLOYED = new RegExp(
  [
    String.raw`\bnot deployed\b`,
    String.raw`\bnothing is deployed\b`,
    String.raw`\bno (?:Maat )?(?:contract|vault|calendar) is deployed\b`,
    String.raw`\bhas deployed (?:no|none)\b`,
    String.raw`\bhas not broadcast\b`,
    String.raw`\bnothing (?:was|has been) broadcast\b`,
    String.raw`\bnot on mainnet\b`,
    String.raw`\bno mainnet deploy(?:ment)?\b`,
    String.raw`\b(?:not|none is) live\b`,
    String.raw`\bno live (?:vault|system)\b`,
    String.raw`\bempty today\b`,
    // A table row that asks about the deploy and answers No: "| Is Maat deployed to Base mainnet? | No |".
    String.raw`\bdeployed\b[^|\n]*\?\s*\|\s*No\b`,
  ].join("|"),
  "gi",
);

/** Lines that say nothing is deployed, with the phrases found, anywhere in the source: frontmatter, JSX, code and prose. */
export function notDeployedClaims(source: string): Finding[] {
  return source.split("\n").flatMap((line, i) => {
    const found = [...line.matchAll(NOT_DEPLOYED)].map((m) => m[0]);
    return found.length > 0 ? [{ line: i + 1, text: found.join(", ") }] : [];
  });
}

/** Every `<Fact name="…" />` name on the page, outside code. */
export function factNames(source: string): Finding[] {
  const lines = source.replace(FENCE, blank).replace(/`[^`\n]*`/g, blank).split("\n");
  return lines.flatMap((l, i) => [...l.matchAll(/<Fact\s+name="([^"]*)"/g)].map((m) => ({ line: i + 1, text: m[1] ?? "" })));
}

/** Every docs-internal href in markdown links and JSX href attributes, e.g. "/docs/concepts/mandate#fields". */
export function docsLinks(source: string): string[] {
  const md = [...source.matchAll(/\]\((\/docs[^)\s]*)\)/g)].map((m) => m[1] ?? "");
  const jsx = [...source.matchAll(/href=["'](\/docs[^"']*)["']/g)].map((m) => m[1] ?? "");
  return [...md, ...jsx];
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Repo paths linked as `<repoUrl>/blob/main/<path>` or `/tree/main/<path>`, without any #L anchor. */
export function repoPaths(source: string, repoUrl: string): string[] {
  return [...source.matchAll(new RegExp(`${escapeRegExp(repoUrl)}/(?:blob|tree)/main/([^)\\s"'#?]+)`, "g"))].map((m) => m[1] ?? "");
}

const COUNT_WORDS: Readonly<Record<string, number>> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };

/**
 * Solidity test names in inline code that no test in `names` has, outside fences: `test_x`, or one inside a longer span
 * such as `[PASS] test_x()`. Two forms name several tests at once: a `*` stands for any letters and must match at least
 * one test (`test_reverting*FailsClosed`), and "the two `test_x` tests" must have exactly that many tests starting so.
 */
export function unknownTestNames(source: string, names: ReadonlySet<string>): Finding[] {
  const out: Finding[] = [];
  source
    .replace(/^---\n[\s\S]*?\n---\n/, blank)
    .replace(FENCE, blank)
    .split("\n")
    .forEach((line, i) => {
      for (const span of line.matchAll(/`([^`\n]*)`/g)) {
        const code = span[1] ?? "";
        const count = COUNT_WORDS[/\bthe (\w+) $/.exec(line.slice(0, span.index))?.[1] ?? ""];
        const plural = count !== undefined && /^ tests\b/.test(line.slice(span.index + span[0].length));
        for (const [name] of code.matchAll(/\btest_[\w*]*/g)) {
          if (plural && name === code) {
            const n = [...names].filter((t) => t.startsWith(name)).length;
            if (n !== count) out.push({ line: i + 1, text: `${name}: ${n} tests start so, not ${count}` });
          } else if (name.includes("*")) {
            const pattern = new RegExp(`^${name.split("*").join("\\w*")}$`);
            if (![...names].some((t) => pattern.test(t))) out.push({ line: i + 1, text: `${name}: no test matches` });
          } else if (!names.has(name)) out.push({ line: i + 1, text: name });
        }
      }
    });
  return out;
}

/** A link to a test file under agent/test on main; the group is its repo path. */
const agentTestLink = (repoUrl: string) => new RegExp(`${escapeRegExp(repoUrl)}/blob/main/(agent/test/[^)\\s"'#?]+\\.test\\.ts)`, "g");

export interface QuotedTitle extends Finding {
  /** The test files under agent/test that the line, or the table cell, links. */
  readonly files: readonly string[];
}

/**
 * Vitest titles a page quotes: each "..." in a prose line, or in one cell of a table row, that links a test file under
 * agent/test, with the files it links. Code, JSX tags and frontmatter are skipped, and so is a quote in another cell.
 */
export function quotedTestTitles(source: string, repoUrl: string): QuotedTitle[] {
  const testFile = agentTestLink(repoUrl);
  const out: QuotedTitle[] = [];
  prose(source)
    .split("\n")
    .forEach((line, i) => {
      for (const unit of line.trimStart().startsWith("|") ? line.split(/(?<!\\)\|/) : [line]) {
        const files = [...unit.matchAll(testFile)].map((m) => m[1] ?? "");
        if (files.length === 0) continue;
        for (const [, text = ""] of unit.matchAll(/"([^"\n]+)"/g)) out.push({ line: i + 1, text, files });
      }
    });
  return out;
}

/** A span that runs a program, such as `npm test` or `npm run test:integration`: an instruction, not a quote. */
const COMMAND = /^(?:cd|npm|npx|node|tsx|vitest|forge|cast|anvil|git)\s/;

/**
 * Vitest titles a page cites in inline code: each span with a space in it, in a prose line or in one cell of a table
 * row, that also names a test file under agent/test, either linked or in code as its path or its file name alone
 * (`agent/test/policy.test.ts`, `runOnce.test.ts`), with the files named. `testFiles` are the repo's test files, by path.
 * Commands such as `npm test` are skipped, and so are fences, frontmatter and JSX tags.
 */
export function codedTestTitles(source: string, repoUrl: string, testFiles: readonly string[]): QuotedTitle[] {
  const linked = agentTestLink(repoUrl);
  const agentFiles = testFiles.filter((f) => f.startsWith("agent/test/"));
  const named = (code: string) => (code.endsWith(".test.ts") ? agentFiles.filter((f) => f === code || f.endsWith(`/${code}`)) : []);
  const out: QuotedTitle[] = [];
  source
    .replace(/^---\n[\s\S]*?\n---\n/, blank)
    .replace(FENCE, blank)
    .replace(/<[A-Za-z][^>]*>/g, blank)
    .split("\n")
    .forEach((line, i) => {
      for (const unit of line.trimStart().startsWith("|") ? line.split(/(?<!\\)\|/) : [line]) {
        const spans = [...unit.matchAll(/`([^`\n]+)`/g)].map((m) => m[1] ?? "");
        const files = [...new Set([...[...unit.matchAll(linked)].map((m) => m[1] ?? ""), ...spans.flatMap(named)])];
        if (files.length === 0) continue;
        for (const text of spans) {
          if (/\s/.test(text.trim()) && !COMMAND.test(text)) out.push({ line: i + 1, text, files });
        }
      }
    });
  return out;
}

/** Links whose text is a test name in inline code, [`test_x`](<repoUrl>/blob/main/<file>), outside fences. */
export function testNameLinks(source: string, repoUrl: string): { line: number; name: string; file: string }[] {
  const link = new RegExp(`\\[\`(test_\\w+)\`\\]\\(${escapeRegExp(repoUrl)}/blob/main/([^)\\s"'#?]+)`, "g");
  return source
    .replace(FENCE, blank)
    .split("\n")
    .flatMap((l, i) => [...l.matchAll(link)].map((m) => ({ line: i + 1, name: m[1] ?? "", file: m[2] ?? "" })));
}

/** The ids Fumadocs gives the page's headings (h2 to h6), outside code blocks. */
export function headingIds(source: string): Set<string> {
  const ids = new Set<string>();
  for (const line of source.replace(FENCE, blank).split("\n")) {
    const text = /^#{2,6}\s+(.+?)\s*#*\s*$/.exec(line)?.[1];
    if (text !== undefined) ids.add(headingId(text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")));
  }
  return ids;
}

export interface Excerpt {
  /** Line of the opening fence in the page. */
  readonly line: number;
  readonly file: string;
  readonly from: number;
  readonly to: number;
  readonly body: string;
}

/** An excerpt's title: a repo path, then the line range it quotes ("contracts/src/GuardLib.sol#L44-L62"). */
const EXCERPT_TITLE = String.raw`([^"#]+)#L(\d+)-L(\d+)`;

/**
 * Where an excerpt's title links: those lines of the file on main, the range the excerpt gate compares with the code.
 * Null for a title that is not an excerpt's, such as "agent/.env.example".
 */
export function excerptHref(title: string, repoUrl: string): string | null {
  return new RegExp(`^${EXCERPT_TITLE}$`).test(title) ? `${repoUrl}/blob/main/${title}` : null;
}

/** Fenced blocks titled with a repo path and a line range: ```solidity title="contracts/src/GuardLib.sol#L44-L62". */
export function excerpts(source: string): Excerpt[] {
  const out: Excerpt[] = [];
  const re = new RegExp(String.raw`^(${"```"}|~~~)[^\n]*title="${EXCERPT_TITLE}"[^\n]*\n([\s\S]*?)^\1[^\n]*$`, "gm");
  for (const m of source.matchAll(re)) {
    out.push({
      line: source.slice(0, m.index).split("\n").length,
      file: m[2] ?? "",
      from: Number(m[3]),
      to: Number(m[4]),
      body: (m[5] ?? "").replace(/\n$/, ""),
    });
  }
  return out;
}

/** Fences that look like an excerpt (a title with `#L`) but that `excerpts` skipped, so no gate would compare them with the code. */
export function malformedExcerptTitles(source: string): Finding[] {
  const parsed = new Set(excerpts(source).map((e) => e.line));
  const out: Finding[] = [];
  source.split("\n").forEach((l, i) => {
    if (/^\s*(```|~~~).*title=["'][^"']*#L/i.test(l) && !parsed.has(i + 1)) {
      out.push({ line: i + 1, text: "excerpt title must read path#L<from>-L<to>, with the fence at the start of the line" });
    }
  });
  return out;
}
