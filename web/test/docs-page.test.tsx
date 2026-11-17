import { readFileSync } from "node:fs";
import { render, screen, within } from "@testing-library/react";
import type { Root } from "fumadocs-core/page-tree";
import type { ComponentProps, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { getMDXComponents } from "@/components/docs/mdx";
import { listsNextInBody, NextLinks } from "@/components/docs/NextLinks";
import { feedbackHref, PageFooter } from "@/components/docs/PageFooter";
import { HomeHeader, PageHeader } from "@/components/docs/PageHeader";
import { SourceOfTruth } from "@/components/docs/SourceOfTruth";
import { StatusBadge } from "@/components/docs/StatusBadge";
import { footerItems } from "@/lib/docs/footer-items";
import { STATUS_MEANING } from "@/lib/docs/frontmatter";
import { llmsIndex, markdownUrl, pageMarkdown, readingMinutes, slugsFromMarkdownPath, standaloneMarkdown } from "@/lib/docs/markdown";
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

  it("gives the status label and its meaning, then the review date, after the URL, as the page's header shows them", () => {
    const page = { title: "T", url: "https://x/docs/a", description: "D", status: "fork-tested", lastReviewed: "2026-11-07", body: "Body\n" } as const;
    expect(pageMarkdown(page)).toBe(
      `# T\n\nURL: https://x/docs/a\n\nStatus: Fork-tested. ${STATUS_MEANING["fork-tested"]} Last reviewed: 2026-11-07.\n\nD\n\nBody\n`,
    );
  });

  it("gives only the review date on a page whose header shows no label, such as a Help page", () => {
    expect(pageMarkdown({ title: "T", url: "https://x/docs/help/a", description: "D", lastReviewed: "2026-11-07", body: "Body\n" })).toBe(
      "# T\n\nURL: https://x/docs/help/a\n\nLast reviewed: 2026-11-07.\n\nD\n\nBody\n",
    );
  });

  it("ends with the Source of truth files, each linked on main, as the page's box lists them", () => {
    const sources = ["contracts/src/MandateVault.sol", "README.md"];
    expect(pageMarkdown({ title: "T", url: "https://x/docs/a", sources, body: "Body\n" })).toBe(
      [
        "# T\n\nURL: https://x/docs/a\n\nBody\n\n## Source of truth\n\nThis page is checked against these files. If they disagree, the files win.\n",
        `- [\`contracts/src/MandateVault.sol\`](${SITE.repoUrl}/blob/main/contracts/src/MandateVault.sol)`,
        `- [\`README.md\`](${SITE.repoUrl}/blob/main/README.md)\n`,
      ].join("\n"),
    );
    expect(pageMarkdown({ title: "T", url: "https://x/docs/a", sources: [], body: "Body\n" })).not.toContain("Source of truth");
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

  it("makes every other root-relative link absolute too: the landing page, its ledger, and the files at the site's root", () => {
    const body = 'The [engine](/), the [ledger](/#ledger) and [a page](/documents). <a href="/llms.txt">llms.txt</a>, <a href="/data/abi/V.json">ABI (JSON)</a>.\n';
    expect(pageMarkdown({ title: "T", url: "https://x.dev/docs/a", body })).toBe(
      "# T\n\nURL: https://x.dev/docs/a\n\nThe [engine](https://x.dev/), the [ledger](https://x.dev/#ledger) and [a page](https://x.dev/documents). " +
        '<a href="https://x.dev/llms.txt">llms.txt</a>, <a href="https://x.dev/data/abi/V.json">ABI (JSON)</a>.\n',
    );
  });

  it("leaves other links alone, and everything inside code fences", () => {
    const body = [
      '[out](https://other.dev/docs) [cdn](//cdn.example/a) [file](./a.md) <a href="https://other.dev/">o</a> <a href="//cdn.example/b">c</a>',
      "",
      "```md",
      "[kept](/docs/a)",
      '<a href="/llms.txt">kept</a> [root](/)',
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

  it("opens a page's own Markdown file with where the index and the other pages are", () => {
    expect(standaloneMarkdown("# T\n\nURL: https://x.dev/docs/a\n", new URL("https://x.dev/"))).toBe(
      "> Index of every page: [llms.txt](https://x.dev/llms.txt). All pages in one file: [llms-full.txt](https://x.dev/llms-full.txt).\n\n" +
        "# T\n\nURL: https://x.dev/docs/a\n",
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

describe("SourceOfTruth", () => {
  const files = (n: number) => Array.from({ length: n }, (_, i) => `contracts/src/F${i}.sol`);
  const box = () => screen.getByRole("complementary", { name: "Source of truth" });
  const RULE = "This page is checked against these files. If they disagree, the files win.";

  it("lists up to five files in the open, each linked on main", () => {
    render(<SourceOfTruth sources={files(5)} commit={null} />);
    expect(box().querySelector("details")).toBeNull();
    expect(within(box()).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(
      files(5).map((f) => `${SITE.repoUrl}/blob/main/${f}`),
    );
  });

  it("folds a longer list into a closed disclosure that counts the files, keeping the heading and the rule in view", () => {
    render(<SourceOfTruth sources={files(6)} commit={null} />);
    const details = box().querySelector("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    expect(details?.querySelector("summary")).toHaveTextContent(/^Source of truth \(6 files\)$/);
    expect([...(details?.querySelectorAll("a") ?? [])].map((a) => a.getAttribute("href"))).toEqual(
      files(6).map((f) => `${SITE.repoUrl}/blob/main/${f}`),
    );
    expect(within(box()).getByRole("heading", { name: "Source of truth" }).closest("details")).toBeNull();
    expect(within(box()).getByText(RULE).closest("details")).toBeNull();
  });

  it("says which commit the page was built from, linking it only when it is on GitHub", () => {
    const { unmount } = render(<SourceOfTruth sources={files(6)} commit={{ short: "def033c" }} />);
    expect(within(box()).getByText(/^Built from commit/)).toHaveTextContent(/^Built from commit def033c\.$/);
    expect(within(box()).getByText(/^Built from commit/).closest("details")).toBeNull();
    expect(within(box()).queryByRole("link", { name: "def033c" })).toBeNull();
    unmount();
    render(<SourceOfTruth sources={files(1)} commit={{ short: "0123456", url: `${SITE.repoUrl}/commit/0123456789` }} />);
    expect(within(box()).getByRole("link", { name: "0123456" })).toHaveAttribute("href", `${SITE.repoUrl}/commit/0123456789`);
  });

  it("names no commit when the build could not tell which", () => {
    render(<SourceOfTruth sources={files(1)} commit={null} />);
    expect(box()).not.toHaveTextContent("Built from");
  });

  it("says when the build had changes its commit does not hold", () => {
    render(<SourceOfTruth sources={files(1)} commit={{ short: "def033c", dirty: true }} />);
    expect(within(box()).getByText(/^Built from commit/)).toHaveTextContent(/^Built from commit def033c, with uncommitted changes\.$/);
  });
});

describe("PageFooter", () => {
  const props = {
    title: "The nine checks",
    pageUrl: "https://x.dev/docs/concepts/nine-checks",
    filePath: "concepts/nine-checks.mdx",
    markdownHref: "/md/docs/concepts/nine-checks.md",
  };

  it("opens the page's Markdown copy from a link next to the copy button", () => {
    render(<PageFooter {...props} commit={null} />);
    const view = screen.getByRole("link", { name: "View as Markdown" });
    expect(view).toHaveAttribute("href", "/md/docs/concepts/nine-checks.md");
    expect(view.nextElementSibling).toBe(screen.getByRole("button", { name: "Copy page as Markdown" }));
  });

  it("says which commit the page was built from", () => {
    render(<PageFooter {...props} commit={{ short: "def033c" }} />);
    expect(screen.getByText(/^Built from commit/)).toHaveTextContent(/^Built from commit def033c\.$/);
  });

  it("says when the build had changes its commit does not hold", () => {
    render(<PageFooter {...props} commit={{ short: "def033c", dirty: true }} />);
    expect(screen.getByText(/^Built from commit/)).toHaveTextContent(/^Built from commit def033c, with uncommitted changes\.$/);
  });
});

describe("code block titles", () => {
  const Pre = getMDXComponents().pre as (props: ComponentProps<"pre">) => ReactNode;

  it("links an excerpt's path and line range to those lines on main", () => {
    render(
      <Pre title="contracts/src/MandateVault.sol#L102-L113">
        <code>function execute()</code>
      </Pre>,
    );
    const link = screen.getByRole("link", { name: "contracts/src/MandateVault.sol#L102-L113" });
    expect(link).toHaveAttribute("href", `${SITE.repoUrl}/blob/main/contracts/src/MandateVault.sol#L102-L113`);
    expect(link.closest("figcaption")).not.toBeNull();
    expect(screen.getByText("function execute()")).toBeInTheDocument();
  });

  it("leaves any other title as text", () => {
    render(
      <Pre title="agent/.env.example">
        <code>MAAT_MODE=dry-run</code>
      </Pre>,
    );
    expect(screen.getByText("agent/.env.example").tagName).toBe("FIGCAPTION");
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("llmsIndex", () => {
  it("gives the summary, the status, the full file, every page as a link to its Markdown copy with its web page, and the ABIs", () => {
    const docs = { title: "Maat docs", summary: "S.", status: "built. Details: https://x.dev/docs/s", fullUrl: "https://x.dev/llms-full.txt" };
    const pages = [{ title: "A", url: "https://x.dev/docs", description: "D." }, { title: "B", url: "https://x.dev/docs/b" }];
    const abis = [{ title: "V ABI", url: "https://x.dev/data/abi/V.json", description: "N." }];
    expect(llmsIndex(docs, pages, abis)).toBe(
      [
        "# Maat docs",
        "",
        "> S.",
        "",
        "Status: built. Details: https://x.dev/docs/s",
        "",
        "Every page as one Markdown file: https://x.dev/llms-full.txt",
        "",
        "## Pages",
        "",
        "- [A](https://x.dev/md/docs.md): D. Web page: https://x.dev/docs",
        "- [B](https://x.dev/md/docs/b.md): Web page: https://x.dev/docs/b",
        "",
        "## Contract ABIs",
        "",
        "- [V ABI](https://x.dev/data/abi/V.json): N.",
        "",
      ].join("\n"),
    );
  });
});
