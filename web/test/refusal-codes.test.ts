// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REASON_GROUPS, REASONS } from "@/content/reasons";
import { DOCS_DIR } from "./helpers/docs";

// concepts/refusal-codes.mdx states each reason's enum id as plain text, so search and the Markdown copy carry it.
// This keeps those hand-written ids in step with REASONS, which facts.test.ts keeps in step with Types.sol.

const FENCE = /^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm;
const source = readFileSync(join(DOCS_DIR, "concepts/refusal-codes.mdx"), "utf8")
  .replace(/\r\n/g, "\n")
  .replace(FENCE, (m) => m.replace(/[^\n]/g, " "));
const lines = source.split("\n");

interface Heading {
  readonly level: number;
  readonly text: string;
  readonly line: number;
}

const headings: Heading[] = lines.flatMap((l, i) => {
  const m = /^(#{2,6})\s+(.+?)\s*$/.exec(l);
  return m ? [{ level: m[1]!.length, text: m[2]!, line: i }] : [];
});

/** The lines between a heading and the next heading of any level. */
function body(h: Heading): string[] {
  const next = headings.find((x) => x.line > h.line);
  return lines.slice(h.line + 1, next?.line ?? lines.length);
}

const ID_LINE = /^- \*\*Id:\*\* `(\d+)`$/;

describe("concepts/refusal-codes.mdx", () => {
  it.each(REASONS.map((code, i) => [code, i + 1] as const))("gives %s the id %i", (code, id) => {
    const h = headings.filter((x) => x.text === code);
    expect(h, `one heading "### ${code}"`).toHaveLength(1);
    expect(h[0]!.level).toBe(3);
    const ids = body(h[0]!).flatMap((l) => ID_LINE.exec(l)?.[1] ?? []);
    expect(ids.map(Number), `the Id line under ### ${code}`).toEqual([id]);
  });

  it("has no Id line outside a code entry", () => {
    const codes = new Set<string>(REASONS);
    const stray = headings
      .filter((h) => !codes.has(h.text))
      .flatMap((h) => body(h).filter((l) => ID_LINE.test(l)).map((l) => `${h.text}: ${l}`));
    expect(stray).toEqual([]);
  });

  it("puts each group at h2 with its codes at h3 under it", () => {
    for (const g of REASON_GROUPS) {
      const at = headings.findIndex((h) => h.level === 2 && h.text === g.title);
      expect(at, `## ${g.title}`).toBeGreaterThanOrEqual(0);
      const end = headings.findIndex((h, i) => i > at && h.level <= 2);
      const under = headings.slice(at + 1, end === -1 ? undefined : end).filter((h) => h.level === 3).map((h) => h.text);
      expect([...under].sort(), `the codes under ## ${g.title}`).toEqual([...g.codes].sort());
    }
  });
});
