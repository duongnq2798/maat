import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { feedbackHref } from "@/components/docs/PageFooter";
import { StatusBadge } from "@/components/docs/StatusBadge";
import { llmsIndex, markdownUrl, pageMarkdown, readingMinutes, slugsFromMarkdownPath } from "@/lib/docs/markdown";
import { SITE } from "@/lib/site";

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
