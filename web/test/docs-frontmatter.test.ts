// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { frontmatterOf } from "@/lib/docs/content-checks";
import { type DocStatus, docsFrontmatter, headerFrame, STATUS_LABEL } from "@/lib/docs/frontmatter";
import { urlSlug } from "@/lib/docs/links";
import { docsPages } from "./helpers/docs";

const GOOD = {
  title: "The nine checks",
  description: "The ordered checks the vault runs on every proposed trade.",
  type: "concept",
  audience: ["newcomer"],
  status: "fork-tested",
  lastReviewed: "2026-11-07",
};

describe("docsFrontmatter", () => {
  it("accepts a page and fills the defaults", () => {
    expect(docsFrontmatter.parse(GOOD)).toMatchObject({ sources: [], next: [] });
    expect(docsFrontmatter.parse({ ...GOOD, next: ["concepts/nine-checks"] }).next).toEqual(["concepts/nine-checks"]);
  });

  it.each([
    ["an unknown type", { type: "tutorial" }],
    ["no audience", { audience: [] }],
    ["an unknown status", { status: "beta" }],
    ["a date that is not ISO", { lastReviewed: "7 Nov 2026" }],
    ["an empty next", { next: [] }],
    ["four next pages", { next: ["a", "b", "c", "d"] }],
    ["a next URL instead of a slug", { next: ["/docs/concepts/nine-checks"] }],
  ])("rejects %s", (_name, patch) => {
    expect(docsFrontmatter.safeParse({ ...GOOD, ...patch }).success).toBe(false);
  });

  it("labels every status", () => {
    expect(STATUS_LABEL["fork-tested"]).toBe("Fork-tested");
    expect(STATUS_LABEL.live).toBe("Live on mainnet");
  });
});

describe("headerFrame", () => {
  const data = { status: "fork-tested", lastReviewed: "2026-11-07" } as const;

  it("gives the docs home no frame, a Help page its date only, and every other page its label and date", () => {
    expect(headerFrame({ slugs: [], data })).toBeNull();
    expect(headerFrame({ slugs: ["help"], data })).toStrictEqual({ lastReviewed: "2026-11-07" });
    expect(headerFrame({ slugs: ["help", "faq"], data })).toStrictEqual({ lastReviewed: "2026-11-07" });
    expect(headerFrame({ slugs: ["concepts", "nine-checks"], data })).toStrictEqual({ status: "fork-tested", lastReviewed: "2026-11-07" });
    expect(headerFrame({ slugs: ["get-started"], data: { ...data, status: "planned" } })).toStrictEqual({ status: "planned", lastReviewed: "2026-11-07" });
  });

  it("leaves the label off six pages, the docs home and the five Help pages, and the date off the home alone", () => {
    const frames = docsPages().map((p) => {
      const fm = parse(frontmatterOf(p.source)) as { status: DocStatus; lastReviewed: string };
      return { slug: p.slug, frame: headerFrame({ slugs: urlSlug(p.slug), data: { status: fm.status, lastReviewed: fm.lastReviewed } }) };
    });
    expect(frames.filter((f) => f.frame?.status === undefined).map((f) => f.slug)).toEqual([
      "help/changelog",
      "help/faq",
      "help/glossary",
      "help/index",
      "help/troubleshooting",
      "index",
    ]);
    expect(frames.filter((f) => f.frame?.lastReviewed === undefined).map((f) => f.slug)).toEqual(["index"]);
  });
});

describe("the Live on mainnet label", () => {
  it("is on exactly the pages the status page's table names for it: that page and every page it links in the row", () => {
    const pages = docsPages();
    const slugs = new Set(pages.map((p) => p.slug));
    const status = pages.find((p) => p.slug === "get-started/status")?.source ?? "";
    const row = status.split("\n").find((l) => l.startsWith('| <StatusBadge status="live" /> |'));
    expect(row).toBeDefined();
    // The row's cells: the label, its meaning, and Today, which says "this page" and links every other page.
    const today = (row ?? "").split("|")[3] ?? "";
    expect(today).toContain("this page");
    const paths = [...today.matchAll(/\]\(\/docs\/([a-z0-9/-]+)\)/g)].map((m) => m[1] ?? "");
    const linked = paths.map((path) => (slugs.has(path) ? path : `${path}/index`));
    const named = ["get-started/status", ...linked].sort();
    const labeled = pages.filter((p) => (parse(frontmatterOf(p.source)) as { status: DocStatus }).status === "live").map((p) => p.slug);
    expect(linked.length).toBeGreaterThan(0);
    expect([...labeled].sort()).toEqual(named);
  });
});
