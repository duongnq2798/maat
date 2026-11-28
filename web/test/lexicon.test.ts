// @vitest-environment node
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { parseSync } from "vite";
import { describe, expect, it } from "vitest";
import { ASK_INVITATION } from "@/content/ask-card";
import { SITE } from "@/lib/site";
import { LINES as FILM_LINES } from "../../film/lib/cards.mjs";
import { REPO_ROOT, readRepo } from "./helpers/solidity";

// Maat's lexicon, docs/brand/lexicon.md: one line per slot, the names, the words, the two myth lines, and the variants
// they retired. This test holds the lexicon to its approved lines, and the repository's public copy to the lexicon.

const lf = (rel: string) => readRepo(rel).replace(/\r\n/g, "\n");
const LEXICON = "docs/brand/lexicon.md";

/** The approved lines, word for word. */
const LINES = {
  positioning: "The AI agent that knows when not to trade.",
  mechanism: "Claude proposes. The vault decides.",
  invitation: "Try to talk Maat's agent into a bad trade. The vault has the last word.",
  signOff: "Every trade is weighed.",
  verdict: "Refused · Market closed (MARKET_CLOSED)",
  mythLong:
    "In the Egyptian Book of the Dead, a heart is weighed against a feather that stands for Ma'at: what is right. A heart that does not balance does not pass. Maat weighs every trade its AI agent proposes against a written mandate, and the chain records the verdict either way.",
  mythShort: "Named for Ma'at, whose feather every heart was weighed against. Here the feather is the mandate.",
} as const;

/** The British Museum's text on the Hunefer papyrus, on Google Arts & Culture: the source of "what is right". */
const MYTH_SOURCE = "https://artsandculture.google.com/asset/page-from-the-book-of-the-dead-of-hunefer/-gFGdB-pjqRpeg";

interface Rule {
  readonly id: string;
  readonly pattern: RegExp;
  /** What the lexicon says instead. */
  readonly say: string;
  /** Retired forms the rule must catch; the lexicon quotes each one. */
  readonly retired: readonly string[];
}

/**
 * The retired variants. Each pattern runs on prose with its whitespace collapsed, so a phrase that wraps across lines
 * is still one phrase, and never across a blank line. The mechanism line itself is blanked out first.
 */
const RULES: readonly Rule[] = [
  {
    id: "mechanism",
    // Any other wording of the mechanism line: a proposer and a decider in one breath.
    pattern: /\b(?:proposes|propose|may advise)\b.{0,60}?\bdecides\b/gi,
    say: LINES.mechanism,
    retired: [
      "The LLM proposes. The contract decides.",
      "LLM proposes, contract decides.",
      "The model may advise. The contract decides.",
      "The agent proposes. The mandate decides.",
      "the agent proposes, the contract decides",
      "Claude proposes every trade and an onchain mandate decides",
    ],
  },
  {
    id: "decider",
    // Up to three words may stand between: "a mandate onchain decides". The vault between them is the approved decider.
    pattern: /\b(?:contract|mandate)(?:\s+(?!vault\b)[\w'’-]+){0,3}?\s+decides\b/gi,
    say: "the vault decides",
    retired: ["the contract decides", "the mandate decides", "a mandate onchain decides"],
  },
  {
    id: "proposer",
    pattern: /\b(?:LLM|AI|model)\s+(?:only\s+)?proposes\b/gi,
    say: "Claude proposes",
    retired: ["the LLM proposes", "the AI proposes", "the model proposes"],
  },
  {
    id: "ai-named-maat",
    // Maat is the project, the vault and the mandate; the AI is Maat's agent.
    pattern:
      /\bMaat\s+is\s+an?\s+(?:AI(?:\s+(?:treasury\s+)?agent)?|LLM|model|bot|(?:treasury\s+)?agent)\b|\bMaat,\s+(?:an?|the)\s+(?:AI(?:\s+agent)?|LLM|model|(?:treasury\s+)?agent)\b|\bYou\s+are\s+Maat\b(?!['’]s)|\bMaat['’]s\s+AI\b/g,
    say: "Maat's agent",
    retired: ["Maat is an AI agent", "Maat is a treasury agent", "You are Maat,", "Maat, the treasury agent", "Maat's AI"],
  },
  {
    id: "maat-replied",
    pattern: /\bMaat\s+(?:replied|replies)\b/g,
    say: "Maat's agent replied",
    retired: ["Maat replied"],
  },
  {
    id: "frozen",
    // Retired for a feed, its price or its hours. A test's clock or a still frame may be frozen: "a frozen clock", "the
    // clock is frozen at 15:59".
    pattern: /(?<!\b(?:clocks?|time|timers?|frames?)\b[^.;:,\n]{0,24})\bfrozen\b(?!\s+(?:clocks?|time|timers?|frames?|dates?)\b)/gi,
    say: "held without an update",
    retired: ["frozen", "49.40 h frozen", "the frozen answer", "frozen over the weekend"],
  },
  {
    id: "divine",
    pattern: /\bdivine\b/gi,
    say: "what is right",
    retired: ["divine"],
  },
];

/**
 * The public copy: the README, Markdown under docs/, the site's content, components and pages, the skill, the film's
 * captions and voice-over (the landing's captions track) and the journal publisher's README. contracts/ is out: the
 * deployed vault's NatSpec cannot change. So is web/content/generated/, which docs:gen copies from contracts/ and agent/.
 */
const SCOPE = [
  "README.md",
  "docs",
  "web/content",
  "web/components",
  "web/app",
  "skills",
  "film/captions.json",
  "film/narration.json",
  "ops/journal/README.md",
  "agent/README.md",
] as const;

/**
 * Skipped by path. A spec or plan under docs/superpowers/ is a dated record, named for its day: it keeps that day's
 * words. The lexicon quotes the retired variants it lists, so it is checked against LINES and RULES instead.
 */
const DATED = /^docs\/superpowers\/(?:.+\/)?\d{4}-\d{2}-\d{2}-[^/]+$/;
const SKIPPED = (path: string) => path === LEXICON || path.startsWith("web/content/generated/") || DATED.test(path);

/**
 * Files the two culture lanes in progress own, feat/now-market-clock and feat/landing-verdict-first, that hold a
 * retired variant today. Each lane fixes its own, and its entry goes once the file is clean.
 */
const PENDING_CULTURE_LANES: readonly string[] = [];

const PENDING = new Set<string>(PENDING_CULTURE_LANES);

let trackedPaths: string[] | undefined;
/** The tracked files in SCOPE, as `git ls-files` lists them. */
const scoped = () =>
  (trackedPaths ??= execFileSync("git", ["ls-files", "--", ...SCOPE], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n")
    .filter((p) => p !== ""));

/** A run of prose from a file, its whitespace collapsed, with the file offset of each of its characters. */
interface Prose {
  readonly text: string;
  readonly at: readonly number[];
}

/**
 * Collapses the whitespace of `raw`, which starts at offset `base` of its file: a run with a blank line becomes "\n",
 * any other run one space.
 */
function prose(raw: string, base = 0): Prose {
  let text = "";
  const at: number[] = [];
  const to = raw.length;
  let i = 0;
  while (i < to) {
    if (/\s/.test(raw[i]!)) {
      const start = i;
      let breaks = 0;
      while (i < to && /\s/.test(raw[i]!)) breaks += raw[i++] === "\n" ? 1 : 0;
      if (text !== "" && i < to) {
        text += breaks >= 2 ? "\n" : " ";
        at.push(base + start);
      }
      continue;
    }
    text += raw[i];
    at.push(base + i);
    i++;
  }
  return { text, at };
}

/** `s` with every character but newlines turned into a space, so offsets keep their lines. */
const blank = (s: string) => s.replace(/[^\n]/g, " ");

/** The visible text an HTML or JSX tag in Markdown carries: its alt, title and aria-label values. */
function tagText(tag: string): string {
  const kept = ` ${[...tag.matchAll(/\b(?:alt|title|aria-label)="([^"]*)"/g)].map((m) => m[1]).join(" ")}`;
  // The kept text goes over the start of the blanked tag, around its newlines, so every line stays where it was.
  const out = [...blank(tag)];
  let j = 0;
  for (let i = 0; i < out.length && j < kept.length; i++) if (out[i] !== "\n") out[i] = kept[j++]!;
  return out.join("");
}

/**
 * The prose of a Markdown or MDX file: everything but fenced code, inline code, link targets, HTML comments and tags,
 * whose alt, title and aria-label values it keeps. Code quotes a file word for word (the docs pages' excerpts are
 * tested against their source), so it is the quoted file's words, not the page's.
 */
function markdownProse(source: string): Prose[] {
  const text = source
    .replace(/^[ \t]*(```|~~~)[^\n]*\n[\s\S]*?^[ \t]*\1[^\n]*$/gm, blank)
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/`[^`\n]+`/g, blank)
    .replace(/(!?\[)([^\]\n]*)(\]\([^)\n]*\))/g, (_m, open: string, label: string, target: string) => blank(open) + label + blank(target))
    .replace(/<\/?[A-Za-z][^>]*>/g, (tag) => tagText(tag));
  return [prose(text)];
}

/** A string that is one lowercase token, such as a data-part value, a key or a slug: code, not copy. */
const TOKEN = /^[a-z0-9@][a-z0-9@_./:#-]*$/;

/**
 * The prose of a TypeScript or JavaScript file: its JSX text, and its string and template literals except one-token
 * strings. Comments and identifiers are code.
 */
function codeProse(path: string, source: string): Prose[] {
  const lang = path.endsWith(".tsx") ? "tsx" : path.endsWith(".ts") ? "ts" : path.endsWith(".jsx") ? "jsx" : "js";
  const parsed = parseSync(path, source, { lang });
  if (parsed.errors.length > 0) throw new Error(`${path} does not parse: ${parsed.errors[0]?.message}`);
  const out: Prose[] = [];
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n);
      return;
    }
    const n = node as { type?: string; start?: number; value?: unknown };
    if (n.type === "JSXText" && typeof n.value === "string") out.push(prose(n.value, n.start ?? 0));
    else if (n.type === "Literal" && typeof n.value === "string" && !TOKEN.test(n.value)) out.push(prose(n.value, n.start ?? 0));
    else if (n.type === "TemplateElement") {
      const cooked = (n.value as { cooked?: string | null } | undefined)?.cooked ?? "";
      if (!TOKEN.test(cooked)) out.push(prose(cooked, n.start ?? 0));
    }
    for (const [k, v] of Object.entries(node)) if (k !== "parent") visit(v);
  };
  visit(parsed.program);
  return out;
}

/** The string values of a JSON file, except one-token strings; its keys are code. */
function jsonProse(source: string): Prose[] {
  const out: Prose[] = [];
  const visit = (v: unknown): void => {
    if (typeof v === "string") {
      if (!TOKEN.test(v)) {
        // The value's offset is not tracked through JSON.parse: find its first occurrence for the line.
        const at = Math.max(0, source.indexOf(JSON.stringify(v).slice(1, -1)));
        out.push(prose(v, at));
      }
    } else if (Array.isArray(v)) v.forEach(visit);
    else if (v !== null && typeof v === "object") Object.values(v).forEach(visit);
  };
  visit(JSON.parse(source));
  return out;
}

/** How a file's prose is read, by its extension; undefined for a kind that holds no copy. */
const kindOf = (path: string) =>
  /\.mdx?$/.test(path) ? "markdown" : /\.(?:tsx?|jsx?|mjs|cjs)$/.test(path) ? "code" : path.endsWith(".json") ? "json" : path.endsWith(".txt") ? "text" : undefined;

/** Kinds that hold no copy: styles, images and icons. */
const NO_COPY = /\.(?:css|svg|png|ico|jpe?g|webp)$/;

/** The prose of one file, by its kind. */
function proseOf(path: string, source: string): Prose[] {
  switch (kindOf(path)) {
    case "markdown":
      return markdownProse(source);
    case "code":
      return codeProse(path, source);
    case "json":
      return jsonProse(source);
    case "text":
      return [prose(source)];
    default:
      return [];
  }
}

interface Hit {
  readonly rule: string;
  readonly offset: number;
  readonly text: string;
}

/** Every retired variant in a run of prose. */
function hitsIn(p: Prose): Hit[] {
  // The mechanism line is blanked first: it is the one line a proposer and a decider may share.
  const text = p.text.split(LINES.mechanism).join("#".repeat(LINES.mechanism.length));
  const hits: Hit[] = [];
  for (const r of RULES) {
    for (const m of text.matchAll(r.pattern)) hits.push({ rule: r.id, offset: p.at[m.index] ?? 0, text: m[0] });
  }
  return hits;
}

const lineOf = (source: string, offset: number) => source.slice(0, offset).split("\n").length;

/** Every hit in a file of the scope, as "path:line [rule] text". */
function fileHits(path: string): string[] {
  const source = lf(path);
  return proseOf(path, source).flatMap((p) => hitsIn(p).map((h) => `${path}:${lineOf(source, h.offset)} [${h.rule}] ${h.text}`));
}

const scan = (text: string, path = "x.mdx") => proseOf(path, text).flatMap((p) => hitsIn(p).map((h) => `${h.rule}: ${h.text}`));

describe("the lexicon", () => {
  const lexicon = () => lf(LEXICON);

  it("holds each approved line word for word, the myth's source and the names", () => {
    for (const [slot, line] of Object.entries(LINES)) expect(lexicon(), slot).toContain(line);
    expect(lexicon()).toContain(`](${MYTH_SOURCE})`);
    for (const name of ["Maat's agent", "Claude", "the vault", "the operator", "outside wallet", "held without an update"]) {
      expect(lexicon(), name).toContain(name);
    }
  });

  it("is the wording the site, the /ask card and the film already use", () => {
    expect(SITE.title).toBe(`${SITE.name} · ${LINES.positioning.replace(/\.$/, "")}`);
    expect(SITE.tagline).toBe(LINES.signOff);
    expect(ASK_INVITATION).toBe(LINES.invitation);
    expect(FILM_LINES).toMatchObject({
      positioning: LINES.positioning,
      mechanism: LINES.mechanism,
      invitation: LINES.invitation,
      signOff: LINES.signOff,
      mythShort: LINES.mythShort,
    });
  });

  it("quotes every retired variant the test fails on, and what to say instead", () => {
    for (const r of RULES) {
      for (const form of r.retired) expect(lexicon(), `${r.id}: ${form}`).toContain(form);
      expect(lexicon(), r.id).toContain(r.say);
    }
  });
});

describe("the myth, told once in words", () => {
  it("is the first section of What is Maat, with its source linked", () => {
    const page = lf("web/content/docs/get-started/what-is-maat.mdx");
    const first = page.split(/^## /m)[1] ?? "";
    expect(first.split("\n")[0]).toBe("The name");
    expect(first).toContain(LINES.mythLong);
    expect(first).toContain(`](${MYTH_SOURCE})`);
    expect(page.split(LINES.mythLong)).toHaveLength(2);
  });

  it("is the line under the README's H3, in its short version", () => {
    const lines = lf("README.md").split("\n");
    const h3 = lines.findIndex((l) => l.startsWith("### "));
    expect(lines[h3]).toBe(`### ${LINES.positioning.replace(/\.$/, "")}`);
    expect(lines.slice(h3 + 1).find((l) => l.trim() !== "")).toBe(LINES.mythShort);
  });
});

describe("the scan", () => {
  it("catches each retired variant, and passes the approved lines", () => {
    for (const r of RULES) for (const form of r.retired) expect(scan(form).map((h) => h.split(":")[0]), form).toContain(r.id);
    for (const line of Object.values(LINES)) expect(scan(line), line).toEqual([]);
    expect(scan(`> ${LINES.mechanism}\n\nThe vault decides on each one. Claude replies before the vault decides.`)).toEqual([]);
  });

  it("reads a phrase across a wrapped line and a link, never across a blank line", () => {
    expect(scan("so the agent proposes\nand the mandate decides")).toEqual(["mechanism: proposes and the mandate decides", "decider: mandate decides"]);
    expect(scan("Claude proposes every trade and an onchain [mandate](/docs/help/glossary#mandate) decides")).toEqual([
      "mechanism: proposes every trade and an onchain mandate decides",
      "decider: mandate decides",
    ]);
    expect(scan("whatever the agent proposes.\n\nThe contract\ndecides")).toEqual(["decider: contract decides"]);
  });

  it("reads a decider a few words from its verb, and lets the vault decide", () => {
    expect(scan("and how a mandate onchain decides every trade they propose")).toEqual(["decider: mandate onchain decides"]);
    expect(scan("The contract on Base decides.")).toEqual(["decider: contract on Base decides"]);
    expect(scan("It checks every intent against the mandate and the vault decides. The mandate is what the vault decides against.")).toEqual([]);
  });

  it("flags frozen for a feed, its price or its hours, not for a clock or a frame a test holds still", () => {
    expect(scan("The feed stays frozen over the weekend: 49.40 h frozen, up to 254 bps above the frozen answer.")).toEqual([
      "frozen: frozen",
      "frozen: frozen",
      "frozen: frozen",
    ]);
    expect(scan("now-week.spec.ts runs with a frozen clock in a closed window. The clock is frozen at 15:59. A frozen frame.")).toEqual([]);
  });

  it("skips Markdown's code and link targets, and keeps alt and title text", () => {
    expect(scan("```ts\nconst motto = \"LLM proposes, contract decides.\";\n```\n\nThe `FROZEN` and `frozen` codes.")).toEqual([]);
    expect(scan("[a page](/docs/frozen-feed) and <img alt=\"a frozen feed\" src=\"/frozen.png\">")).toEqual(["frozen: frozen"]);
    expect(scan('<Callout type="fork" title="Maat is an AI agent">')).toEqual(["ai-named-maat: Maat is an AI agent"]);
  });

  it("reads code's JSX text and strings, and skips comments, identifiers and one-token strings", () => {
    const tsx = [
      "// the frozen frame",
      "const swapsWhileFrozen = 1; /* LLM proposes */",
      'export const A = () => <rect data-part="frozen"><text>frozen</text><title>{`${swapsWhileFrozen} h frozen`}</title></rect>;',
      'const id = "frozen-feed"; const label = "The contract decides.";',
    ].join("\n");
    expect(scan(tsx, "a.tsx")).toEqual(["frozen: frozen", "frozen: frozen", "decider: contract decides"]);
    expect(scan('{"frozen-feed": "frozen-feed", "a": "Maat replied: no"}', "a.json")).toEqual(["maat-replied: Maat replied"]);
  });

  it("names the line of each hit", () => {
    const source = "Line one.\n\nThe LLM proposes.\nThe contract decides.\n";
    const [p] = markdownProse(source);
    expect(hitsIn(p!).map((h) => [h.rule, lineOf(source, h.offset)])).toEqual([
      ["mechanism", 3],
      ["decider", 4],
      ["proposer", 3],
    ]);
  });
});

describe("the repository's public copy", () => {
  it("reads the whole scope, and only copy", () => {
    const files = scoped();
    expect(files).toContain("README.md");
    expect(files).toContain(LEXICON);
    expect(files.filter((f) => f.startsWith("contracts/"))).toEqual([]);
    // Every file in scope is copy the scan reads, a dated record or the lexicon, or a kind that holds no copy.
    const unread = files.filter((f) => !SKIPPED(f) && kindOf(f) === undefined && !NO_COPY.test(f));
    expect(unread).toEqual([]);
  });

  // The scan parses every file of the scope: on a busy machine its first run takes longer than the default 5 s.
  it("uses no retired variant", { timeout: 60_000 }, () => {
    const hits = scoped()
      .filter((f) => !SKIPPED(f) && !PENDING.has(f))
      .flatMap(fileHits);
    expect(hits).toEqual([]);
  });

  it("skips a culture lane's file only while it holds a retired variant", () => {
    for (const f of PENDING_CULTURE_LANES) expect(fileHits(f), `${f} is clean: remove it from PENDING_CULTURE_LANES`).not.toEqual([]);
  });
});
