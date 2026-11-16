import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import type { Root } from "fumadocs-core/page-tree";
import { describe, expect, it, vi } from "vitest";
import { listsNextInBody, NextLinks } from "@/components/docs/NextLinks";
import { feedbackHref } from "@/components/docs/PageFooter";
import { HomeHeader, PageHeader, STATUS_MEANING } from "@/components/docs/PageHeader";
import { StatusBadge } from "@/components/docs/StatusBadge";
import { footerItems } from "@/lib/docs/footer-items";
import { llmsIndex, markdownUrl, pageMarkdown, readingMinutes, slugsFromMarkdownPath } from "@/lib/docs/markdown";
import { SITE } from "@/lib/site";

// A small docs tree for the breadcrumb, and the one page NextLinks looks up.
const { tree, pages } = vi.hoisted(() => {
  const tree: Root = {
    name: "Docs",
    children: [
      {
        type: "folder",
        name: "Concepts",
        index: { type: "page", name: "Concepts", url: "/docs/concepts" },
        children: [{ type: "page", name: "The nine checks", url: "/docs/concepts/nine-checks" }],
      },
    ],
  };
  const pages: Record<string, { url: string; data: { title: string; description: string } }> = {
    "concepts/nine-checks": { url: "/docs/concepts/nine-checks", data: { title: "The nine checks", description: "The order of the checks." } },
  };
  return { tree, pages };
});
vi.mock("@/lib/docs-source", () => ({
  source: { getPageTree: () => tree, getPage: (slugs: string[]) => pages[slugs.join("/")] },
}));

describe("docs Markdown helpers", () => {
  it("maps a page URL to its Markdown file and back", () => {
    expect(markdownUrl("/docs")).toBe("/md/docs.md");
    expect(markdownUrl("/docs/concepts/nine-checks")).toBe("/md/docs/concepts/nine-checks.md");
    expect(slugsFromMarkdownPath(["docs.md"])).toEqual([]);
    expect(slugsFromMarkdownPath(["docs", "concepts", "nine-checks.md"])).toEqual(["concepts", "nine-checks"]);
    expect(slugsFromMarkdownPath(["docs", "concepts", "nine-checks"])).toBeNull();
    expect(slugsFromMarkdownPath(["other.md"])).toBeNull();
  });

  it("counts reading time at 200 words a minute, at least one", () => {
    expect(readingMinutes("")).toBe(1);
    expect(readingMinutes("word ".repeat(200))).toBe(1);
    expect(readingMinutes("word ".repeat(201))).toBe(2);
    expect(readingMinutes("``` - | word")).toBe(1);
  });

  it("puts the title, URL and description above the body", () => {
    expect(pageMarkdown({ title: "T", url: "https://x/docs", description: "D", body: "Body\n" })).toBe(
      "# T\n\nURL: https://x/docs\n\nD\n\nBody\n",
    );
  });

  it("makes links to the site's own pages absolute, so a copy read elsewhere still leads back", () => {
    const body = "See [the checks](/docs/concepts/nine-checks#x), [the home](/docs) and [its copy](/md/docs.md).\n";
    expect(pageMarkdown({ title: "T", url: "http://localhost:3000/docs/a", body })).toBe(
      "# T\n\nURL: http://localhost:3000/docs/a\n\nSee [the checks](http://localhost:3000/docs/concepts/nine-checks#x), [the home](http://localhost:3000/docs) and [its copy](http://localhost:3000/md/docs.md).\n",
    );
  });

  it("points a link to a heading on the same page at that page, so it still works once the pages are joined", () => {
    const body = "Jump to [the table](#the-table), or to [another](/docs/b#y).\n\n```md\n[kept](#x)\n```\n";
    expect(pageMarkdown({ title: "T", url: "https://x.dev/docs/a", body })).toBe(
      "# T\n\nURL: https://x.dev/docs/a\n\nJump to [the table](https://x.dev/docs/a#the-table), or to [another](https://x.dev/docs/b#y).\n\n```md\n[kept](#x)\n```\n",
    );
  });

  it("leaves other links alone, and everything inside code fences", () => {
    const body = [
      "[out](https://other.dev/docs) [near](/documents) [file](./a.md)",
      "",
      "```md",
      "[kept](/docs/a)",
      "```",
      "",
      "````md",
      "```",
      "[kept too](/md/a.md)",
      "```",
      "````",
      "",
      "[after](/docs/b)",
    ].join("\n");
    expect(pageMarkdown({ title: "T", url: "https://x.dev/docs", body })).toBe(
      `# T\n\nURL: https://x.dev/docs\n\n${body.replace("[after](/docs/b)", "[after](https://x.dev/docs/b)")}\n`,
    );
  });
});

describe("footerItems", () => {
  const pages = [
    { name: "Errors", url: "/docs/reference/errors", description: "E." },
    { name: "Types", url: "/docs/reference/types", description: "T." },
    { name: "MarketCalendar", url: "/docs/reference/market-calendar" },
  ];

  it("gives a page the pages before and after it, with their titles and descriptions", () => {
    expect(footerItems(pages, "/docs/reference/types")).toEqual({ previous: pages[0], next: pages[2] });
  });

  it("gives the first page no previous card and the last no next card", () => {
    expect(footerItems(pages, "/docs/reference/errors")).toEqual({ previous: undefined, next: pages[1] });
    expect(footerItems(pages, "/docs/reference/market-calendar")).toEqual({ previous: pages[1], next: undefined });
  });

  it("gives a page that is not in the list no cards, rather than the first page as its next", () => {
    expect(footerItems(pages, "/docs/concepts/refusal-codes")).toEqual({});
  });
});

describe("page footer feedback", () => {
  it("opens a prefilled GitHub issue that names the page and the answer", () => {
    const url = new URL(feedbackHref("The nine checks", "https://maatonbase.xyz/docs/concepts/nine-checks", false));
    expect(`${url.origin}${url.pathname}`).toBe(`${SITE.repoUrl}/issues/new`);
    expect(url.searchParams.get("title")).toBe("Docs feedback: The nine checks (not helpful)");
    expect(url.searchParams.get("body")).toBe(
      "Page: https://maatonbase.xyz/docs/concepts/nine-checks\n\nWhat was missing or wrong?\n",
    );
    expect(new URL(feedbackHref("T", "https://x", true)).searchParams.get("title")).toBe("Docs feedback: T (helpful)");
  });
});

describe("StatusBadge", () => {
  it("says the status in words, so it reads the same without color", () => {
    render(<StatusBadge status="fork-tested" />);
    expect(screen.getByText("Fork-tested").closest("[data-status]")).toHaveAttribute("data-status", "fork-tested");
  });

  it("stays a plain label on its own, as in the status page's table, which would otherwise link to itself", () => {
    render(<StatusBadge status="fork-tested" />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("PageHeader", () => {
  const header = {
    url: "/docs/concepts/nine-checks",
    title: "The nine checks",
    description: "The order of the checks.",
    audience: ["developer", "evaluator"],
    readingMinutes: 4,
    lastReviewed: "2026-11-07",
  } as const;

  it("links the status label to what the labels mean, named as the status and described by its meaning", () => {
    render(<PageHeader {...header} status="fork-tested" />);
    const link = screen.getByRole("link", { name: "Status: Fork-tested. What this label means" });
    expect(link).toHaveAttribute("href", "/docs/get-started/status#what-the-three-labels-mean");
    expect(link).toHaveTextContent("Fork-tested");
    expect(link).toHaveAccessibleDescription(
      "Built and tested; the contracts and the send path have run on a Base mainnet fork; not deployed.",
    );
    // Hidden text that only the description reads, not a tooltip or the ARIA 1.3 draft attribute. Visually hidden
    // (sr-only) text would be read a second time as page text.
    expect(link).not.toHaveAttribute("title");
    expect(link).not.toHaveAttribute("aria-description");
    const meaning = document.getElementById(link.getAttribute("aria-describedby") ?? "");
    expect(meaning).toHaveAttribute("hidden");
    expect(meaning).not.toHaveClass("sr-only");
  });

  it("marks the label as a link with an info mark that a screen reader skips", () => {
    render(<PageHeader {...header} status="fork-tested" />);
    const link = screen.getByRole("link", { name: "Status: Fork-tested. What this label means" });
    expect(link.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it("gives each label the meaning the status page's table gives it, word for word", () => {
    const table = readFileSync("content/docs/get-started/status.mdx", "utf8");
    const rows = [...table.matchAll(/^\| <StatusBadge status="([a-z-]+)" \/> \| ([^|]+) \|/gm)];
    expect(Object.fromEntries(rows.map(([, status, meaning]) => [status, meaning!.replace(/`/g, "").trim()]))).toEqual(STATUS_MEANING);
  });

  it("shows no status label on a page given none, and keeps the rest of the row", () => {
    render(<PageHeader {...header} url="/docs/help/glossary" title="Glossary" />);
    expect(screen.queryByText("Fork-tested")).toBeNull();
    expect(document.querySelector("[data-status], #status-meaning")).toBeNull();
    // The audience chips open the row, with no empty label before them.
    expect(screen.getByRole("list", { name: "Written for" }).previousElementSibling).toBeNull();
    expect(screen.getByText("4 min read")).toBeInTheDocument();
  });

  it("keeps the breadcrumb, audience chips, reading time and review date on every other page", () => {
    render(<PageHeader {...header} status="fork-tested" />);
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent("Docs/Concepts/The nine checks");
    expect(screen.getByRole("list", { name: "Written for" })).toHaveTextContent("DeveloperEvaluator");
    expect(screen.getByText(/Last reviewed/)).toHaveTextContent("Last reviewed 7 Nov 2026");
  });
});

describe("HomeHeader", () => {
  it("is the H1 and the lede only: no breadcrumb, label, chips, reading time or review date", () => {
    const { container } = render(<HomeHeader title="Maat docs" description="Pick the path that fits why you came." />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Maat docs");
    expect(container.querySelector("header")?.children).toHaveLength(2);
    expect(container.querySelector("header > p")).toHaveTextContent("Pick the path that fits why you came.");
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });
});

describe("NextLinks", () => {
  it("heads the pages to read next \"Read next\"", () => {
    render(<NextLinks slugs={["concepts/nine-checks"]} />);
    const block = screen.getByRole("navigation", { name: "Read next" });
    expect(block.querySelector("h2")).toHaveTextContent("Read next");
    expect(screen.getByRole("link", { name: /The nine checks/ })).toHaveAttribute("href", "/docs/concepts/nine-checks");
  });

  it("knows a page whose body ends with its own Next steps or Related list, which needs no second one", () => {
    const toc = (...urls: string[]) => urls.map((url) => ({ title: url, url, depth: 2 }));
    expect(listsNextInBody(toc("#steps", "#next-steps"))).toBe(true);
    expect(listsNextInBody(toc("#summary", "#related"))).toBe(true);
    expect(listsNextInBody(toc("#steps", "#check-it-worked"))).toBe(false);
    expect(listsNextInBody([])).toBe(false);
  });
});

describe("llmsIndex", () => {
  it("gives the summary, the full file and every page as an absolute link", () => {
    const docs = { title: "Maat docs", summary: "S.", fullUrl: "https://x.dev/llms-full.txt" };
    const pages = [{ title: "A", url: "https://x.dev/docs", description: "D" }, { title: "B", url: "https://x.dev/docs/b" }];
    expect(llmsIndex(docs, pages)).toBe(
      "# Maat docs\n\n> S.\n\nEvery page as one Markdown file: https://x.dev/llms-full.txt\n\n## Pages\n\n- [A](https://x.dev/docs): D\n- [B](https://x.dev/docs/b)\n",
    );
  });
});
