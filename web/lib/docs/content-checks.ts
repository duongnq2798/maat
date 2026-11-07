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

/** Repo paths linked as `<repoUrl>/blob/main/<path>` or `/tree/main/<path>`, without any #L anchor. */
export function repoPaths(source: string, repoUrl: string): string[] {
  const esc = repoUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...source.matchAll(new RegExp(`${esc}/(?:blob|tree)/main/([^)\\s"'#?]+)`, "g"))].map((m) => m[1] ?? "");
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

/** Fenced blocks titled with a repo path and a line range: ```solidity title="contracts/src/GuardLib.sol#L44-L62". */
export function excerpts(source: string): Excerpt[] {
  const out: Excerpt[] = [];
  const re = /^(```|~~~)[^\n]*title="([^"#]+)#L(\d+)-L(\d+)"[^\n]*\n([\s\S]*?)^\1[^\n]*$/gm;
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
