// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DOCS_IA, IA_SLUGS } from "@/lib/docs/ia";
import { DOCS_DIR, docsPages } from "./helpers/docs";

/** The pages written so far. Each content task (7 to 18) appends its slugs; Task 18b checks this is the whole IA. */
const SHIPPED: readonly string[] = [
  "index",
  "get-started/what-is-maat",
  "get-started/how-a-decision-is-made",
  "get-started/quickstart",
  "get-started/read-a-decision",
  "get-started/status",
  "concepts/mandate",
  "concepts/nine-checks",
  "concepts/refusal-codes",
  "concepts/market-hours",
  "concepts/prices-and-premium",
  "concepts/splits-and-multiplier",
  "concepts/credit-and-health-factor",
  "concepts/timelock-and-roles",
  "concepts/treasury-loop",
  "reference/mandate-vault",
  "reference/events",
  "reference/errors",
  "reference/types",
  "reference/market-calendar",
  "reference/adapters",
  "reference/agent-configuration",
  "reference/agent-scripts",
  "reference/base-addresses",
  "reference/default-parameters",
  "help/faq",
  "help/glossary",
];

const written = docsPages().map((p) => p.slug);
const meta = (dir: string) => JSON.parse(readFileSync(join(DOCS_DIR, dir, "meta.json"), "utf8")) as unknown;
const sections = DOCS_IA.filter((s) => s.dir !== "");

describe("docs pages follow the IA (docs spec §3)", () => {
  it("the IA has unique slugs and descriptions of 50 to 160 characters", () => {
    expect(new Set(IA_SLUGS).size).toBe(IA_SLUGS.length);
    const pages = DOCS_IA.flatMap((s) => s.pages);
    expect(pages.filter((p) => p.description.length < 50 || p.description.length > 160).map((p) => p.slug)).toEqual([]);
  });

  it("every shipped page is written", () => {
    expect(SHIPPED.filter((s) => !written.includes(s))).toEqual([]);
  });

  it("every written page is shipped and in the IA", () => {
    expect(written.filter((s) => !SHIPPED.includes(s))).toEqual([]);
    expect(SHIPPED.filter((s) => !IA_SLUGS.includes(s))).toEqual([]);
  });

  it("each section's meta.json lists its written pages in IA order", () => {
    for (const s of sections) {
      const pages = s.pages.filter((p) => written.includes(p.slug)).map((p) => p.slug.slice(s.dir.length + 1));
      if (pages.length === 0) expect(existsSync(join(DOCS_DIR, s.dir)), `${s.dir}/ has no pages yet`).toBe(false);
      else expect(meta(s.dir), `${s.dir}/meta.json`).toEqual({ title: s.title, pages });
    }
  });

  it("the root meta.json lists the home page, then each section that has pages", () => {
    const dirs = sections.filter((s) => s.pages.some((p) => written.includes(p.slug))).map((s) => s.dir);
    expect(meta("")).toEqual({ title: DOCS_IA[0]?.title, pages: ["index", ...dirs] });
  });
});
