import { type BuildCommit, currentBuildCommit } from "@/lib/build-info";
import { SITE } from "@/lib/site";
import { CopyMarkdown } from "./CopyMarkdown";
import { BuiltFrom } from "./SourceOfTruth";

const action =
  "inline-flex min-h-11 items-center gap-1.5 rounded-md border border-fd-border bg-fd-secondary px-3 text-sm font-medium text-fd-secondary-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground focus-visible:ring-2 focus-visible:ring-fd-ring focus-visible:outline-none disabled:opacity-60 md:min-h-9";

interface PageFooterProps {
  title: string;
  /** Absolute URL of the page, quoted in the feedback issue. */
  pageUrl: string;
  /** Path of the MDX file below content/docs. */
  filePath: string;
  markdownHref: string;
  /** The commit the page was built from; null names none. */
  commit?: BuildCommit | null;
}

/** A prefilled GitHub issue: the reader decides whether to send it, and nothing is tracked. */
export function feedbackHref(title: string, pageUrl: string, helpful: boolean): string {
  const params = new URLSearchParams({
    title: `Docs feedback: ${title} (${helpful ? "helpful" : "not helpful"})`,
    body: `Page: ${pageUrl}\n\n${helpful ? "What helped?" : "What was missing or wrong?"}\n`,
  });
  return `${SITE.repoUrl}/issues/new?${params}`;
}

/** Feedback, edit, view and copy actions under every docs page, and the commit the page was built from. */
export function PageFooter({ title, pageUrl, filePath, markdownHref, commit = currentBuildCommit() }: PageFooterProps) {
  return (
    <div className="not-prose mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-fd-border pt-6 text-sm">
      <div role="group" aria-labelledby="page-helpful" className="flex flex-wrap items-center gap-2">
        <span id="page-helpful" className="text-fd-muted-foreground">
          Was this page helpful?
        </span>
        <a className={action} href={feedbackHref(title, pageUrl, true)} target="_blank" rel="noreferrer">
          Yes
        </a>
        <a className={action} href={feedbackHref(title, pageUrl, false)} target="_blank" rel="noreferrer">
          No
        </a>
      </div>
      <div className="flex flex-wrap gap-2">
        <a className={action} href={`${SITE.repoUrl}/edit/main/web/content/docs/${filePath}`} target="_blank" rel="noreferrer">
          Edit on GitHub
        </a>
        <a className={action} href={markdownHref}>
          View as Markdown
        </a>
        <CopyMarkdown href={markdownHref} className={action} />
      </div>
      <BuiltFrom commit={commit} className="basis-full text-xs text-fd-muted-foreground" />
    </div>
  );
}
