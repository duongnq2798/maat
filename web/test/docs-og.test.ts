// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { docsOgSvg, pngSize, renderDocsOg } from "@/brand/render";
import { frontmatterOf } from "@/lib/docs/content-checks";
import { type DocStatus, STATUS_LABEL } from "@/lib/docs/frontmatter";
import { urlSlug } from "@/lib/docs/links";
import { OG_IMAGE_SIZE, type OgCard, ogAlt, ogCard, ogImageUrl, slugsFromOgPath } from "@/lib/docs/og";
import { docsTree } from "@/lib/docs/remark-component-text";
import { DOCS_DIR, docsPages } from "./helpers/docs";

const tree = docsTree(DOCS_DIR);
const data = { title: "The nine checks", status: "fork-tested", lastReviewed: "2026-11-07" } as const;

/** Every docs page as ogCard reads it: its URL slugs and the frontmatter fields the card uses. */
const pages = docsPages().map((p) => {
  const fm = parse(frontmatterOf(p.source)) as { title: string; description: string; status: DocStatus; lastReviewed: string };
  return {
    slug: p.slug,
    slugs: urlSlug(p.slug),
    data: { title: fm.title, description: fm.description, status: fm.status, lastReviewed: fm.lastReviewed },
  };
});
const home = pages.find((p) => p.slugs.length === 0);
if (!home) throw new Error("no docs home in content/docs");

describe("ogImageUrl and slugsFromOgPath", () => {
  it("give the docs home and every page its own PNG under /og, as /md gives each its Markdown copy", () => {
    expect(ogImageUrl("/docs")).toBe("/og/docs.png");
    expect(ogImageUrl("/docs/concepts/nine-checks")).toBe("/og/docs/concepts/nine-checks.png");
    expect(slugsFromOgPath(["docs.png"])).toEqual([]);
    expect(slugsFromOgPath(["docs", "concepts", "nine-checks.png"])).toEqual(["concepts", "nine-checks"]);
  });

  it("read back the slugs of every page's image", () => {
    for (const { slug, slugs } of pages) {
      const url = `/docs/${slugs.join("/")}`.replace(/\/$/, "");
      expect(slugsFromOgPath(ogImageUrl(url).split("/").slice(2)), slug).toEqual(slugs);
    }
  });

  it.each([
    ["a Markdown copy", ["docs", "concepts", "nine-checks.md"]],
    ["another image type", ["docs.jpg"]],
    ["a file outside the docs", ["opengraph-image.png"]],
  ])("refuse %s", (_name, segments) => {
    expect(slugsFromOgPath(segments)).toBeNull();
  });
});

describe("ogCard", () => {
  it("gives a page its title, its section's sidebar title and the status label its header shows", () => {
    expect(ogCard({ slugs: ["concepts", "nine-checks"], data }, tree)).toStrictEqual({
      title: "The nine checks",
      section: "Concepts",
      status: STATUS_LABEL["fork-tested"],
    });
    expect(ogCard({ slugs: ["guides", "run-the-agent"], data: { ...data, title: "Run the agent", status: "planned" } }, tree)).toStrictEqual({
      title: "Run the agent",
      section: "Guides",
      status: "Planned",
    });
  });

  it("leaves the label off a Help page and the docs home, as their headers do", () => {
    expect(ogCard({ slugs: ["help", "faq"], data: { ...data, title: "FAQ" } }, tree)).toStrictEqual({ title: "FAQ", section: "Help" });
    expect(ogCard({ slugs: [], data: { ...data, title: "Maat docs", description: "Understand Maat." } }, tree)).toStrictEqual({
      description: "Understand Maat.",
    });
  });

  it("gives the docs home its description in place of a title that would repeat the lockup's name", () => {
    expect(ogCard(home, tree)).toStrictEqual({ description: home.data.description });
    expect(home.data.description.length).toBeGreaterThan(0);
  });

  it("fails on a docs home with no description, which would leave its image with nothing but the lockup", () => {
    expect(() => ogCard({ slugs: [], data: { ...data, title: "Maat docs" } }, tree)).toThrow(/docs home.*description/);
  });

  it("names no section on a section's own page, whose title is the section", () => {
    expect(ogCard({ slugs: ["concepts"], data: { ...data, title: "Concepts" } }, tree)).toStrictEqual({
      title: "Concepts",
      status: "Fork-tested",
    });
  });

  it("fails on a page outside every section", () => {
    expect(() => ogCard({ slugs: ["nowhere", "page"], data }, tree)).toThrow(/nowhere/);
  });

  it("gives every docs page a card of its own, so no two shared links look the same", () => {
    const cards = pages.map((p) => JSON.stringify(ogCard(p, tree)));
    // More than one, so the uniqueness check cannot pass on an empty list; no page count, which adding a page changes.
    expect(cards.length).toBeGreaterThan(1);
    expect(new Set(cards).size).toBe(cards.length);
  });
});

describe("ogAlt", () => {
  it("reads the image's text in order: the docs center, the section, the title, then the status label", () => {
    expect(ogAlt({ title: "The nine checks", section: "Concepts", status: "Fork-tested" })).toBe(
      "Maat Docs, Concepts: The nine checks. Status: Fork-tested.",
    );
    expect(ogAlt({ title: "FAQ", section: "Help" })).toBe("Maat Docs, Help: FAQ.");
  });

  it("reads the docs home's description after the docs center's name, and ends it with one full stop", () => {
    expect(ogAlt({ description: "Understand Maat. Pick a path." })).toBe("Maat Docs: Understand Maat. Pick a path.");
    expect(ogAlt({ description: "Understand Maat" })).toBe("Maat Docs: Understand Maat.");
    expect(ogAlt(ogCard(home, tree))).toBe(`Maat Docs: ${home.data.description}`);
  });
});

describe("renderDocsOg", () => {
  it(`draws a ${OG_IMAGE_SIZE.width}x${OG_IMAGE_SIZE.height} PNG, and a different one for a different page`, async () => {
    const nine = await renderDocsOg({ title: "The nine checks", section: "Concepts", status: "Fork-tested" });
    const codes = await renderDocsOg({ title: "Refusal codes", section: "Concepts", status: "Fork-tested" });
    expect(pngSize(nine)).toEqual(OG_IMAGE_SIZE);
    expect(nine.equals(codes)).toBe(false);
  }, 30_000);

  it("keeps every page's text inside the image's margins", async () => {
    const MARGIN = { x: 72, y: 64 };
    const outside: string[] = [];
    for (const p of pages) {
      const card: OgCard = ogCard(p, tree);
      await docsOgSvg(card, (node) => {
        if (!node.textContent) return;
        const inside =
          node.left >= MARGIN.x &&
          node.top >= MARGIN.y &&
          node.left + node.width <= OG_IMAGE_SIZE.width - MARGIN.x &&
          node.top + node.height <= OG_IMAGE_SIZE.height - MARGIN.y;
        if (!inside) outside.push(`${p.slug}: "${node.textContent}" at ${node.left},${node.top} ${node.width}x${node.height}`);
      });
    }
    expect(outside).toEqual([]);
  }, 60_000);

  it("draws the docs home's description under the lockup, and not its title, which would repeat the lockup", async () => {
    const texts: string[] = [];
    await docsOgSvg(ogCard(home, tree), (node) => {
      if (node.textContent) texts.push(node.textContent);
    });
    expect(texts).toContain(home.data.description);
    expect(texts).not.toContain(home.data.title);
  }, 30_000);

  it("would catch a title too long for the image", async () => {
    const bottoms: number[] = [];
    await docsOgSvg({ title: "A title that goes on ".repeat(8), section: "Concepts", status: "Fork-tested" }, (node) => {
      if (node.textContent) bottoms.push(node.top + node.height);
    });
    expect(Math.max(...bottoms)).toBeGreaterThan(OG_IMAGE_SIZE.height - 64);
  }, 30_000);
});
