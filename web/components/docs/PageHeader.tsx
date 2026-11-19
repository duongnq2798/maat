import { getBreadcrumbItems } from "fumadocs-core/breadcrumb";
import { DocsDescription, DocsTitle } from "fumadocs-ui/layouts/docs/page";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { source } from "@/lib/docs-source";
import { AUDIENCE_LABEL, type Audience, type DocStatus, STATUS_LABEL, STATUS_MEANING } from "@/lib/docs/frontmatter";
import { StatusBadge } from "./StatusBadge";

interface PageHeaderProps {
  url: string;
  title: string;
  description?: string;
  /**
   * The project's status label. Left out on the Help pages: the label states how far the project is built and tested,
   * and those pages are aids around the docs, so they carry none (final-review Minor).
   */
  status?: DocStatus;
  audience: readonly Audience[];
  readingMinutes: number;
  /** ISO date, YYYY-MM-DD. */
  lastReviewed: string;
}

const reviewed = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** The highlight the label takes on hover, and on keyboard focus too. */
const STATUS_LINK_HIGHLIGHT = [
  "hover:[&>[data-status]]:bg-fd-accent hover:[&>[data-status]]:text-fd-accent-foreground hover:[&>[data-status]]:underline hover:text-fd-foreground",
  "focus-visible:[&>[data-status]]:bg-fd-accent focus-visible:[&>[data-status]]:text-fd-accent-foreground focus-visible:[&>[data-status]]:underline focus-visible:text-fd-foreground",
].join(" ");

/**
 * The status label, linked to what the labels mean, with an info mark that shows it is a link without a hover. Its
 * meaning is the link's description, in a hidden node: one that aria-describedby names still gives the description,
 * where visually hidden text would be read again as page text. A title shows only on hover, and aria-description is
 * still an ARIA 1.3 draft.
 */
function StatusLink({ status }: { status: DocStatus }) {
  return (
    <>
      <Link
        href="/docs/get-started/status#what-the-three-labels-mean"
        aria-label={`Status: ${STATUS_LABEL[status]}. What this label means`}
        aria-describedby="status-meaning"
        className={`inline-flex min-h-11 items-center gap-1 md:min-h-0 ${STATUS_LINK_HIGHLIGHT}`}
      >
        <StatusBadge status={status} />
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="size-3.5 shrink-0">
          <circle cx="8" cy="8" r="6.25" />
          <path d="M8 7.25v3.5M8 5.1v.05" />
        </svg>
      </Link>
      <span id="status-meaning" hidden>
        {STATUS_MEANING[status]}
      </span>
    </>
  );
}

/** Docs / folder / page. A folder without an index page is plain text; the current page is not a link. */
function Breadcrumbs({ url }: { url: string }) {
  const trail = getBreadcrumbItems(url, source.getPageTree(), { includePage: true }).filter((item) => item.url !== "/docs");
  const items: { name: ReactNode; url?: string }[] = [{ name: "Docs", url: "/docs" }, ...trail];
  return (
    <nav aria-label="Breadcrumb" className="mb-2 text-sm text-fd-muted-foreground">
      <ol className="flex flex-wrap items-center gap-x-1.5">
        {items.map((item, i) => (
          <Fragment key={i}>
            {i > 0 && (
              <li aria-hidden className="select-none">
                /
              </li>
            )}
            <li>
              {i === items.length - 1 ? (
                <span aria-current="page" className="font-medium text-fd-foreground">
                  {item.name}
                </span>
              ) : item.url ? (
                <Link href={item.url} className="inline-flex min-h-11 items-center hover:text-fd-foreground md:min-h-0">
                  {item.name}
                </Link>
              ) : (
                <span>{item.name}</span>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}

/** The docs home's header: the H1 and the lede only. The home's own "Today" paragraph says what is built and tested. */
export function HomeHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header>
      <DocsTitle>{title}</DocsTitle>
      <DocsDescription className="mt-2">{description}</DocsDescription>
    </header>
  );
}

/** Breadcrumb, H1, lede, then status, audience, reading time and review date in one row. */
export function PageHeader({ url, title, description, status, audience, readingMinutes, lastReviewed }: PageHeaderProps) {
  return (
    <header>
      <Breadcrumbs url={url} />
      <DocsTitle>{title}</DocsTitle>
      <DocsDescription className="mt-2 mb-4">{description}</DocsDescription>
      <div className="mb-8 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-fd-muted-foreground">
        {status && <StatusLink status={status} />}
        <ul aria-label="Written for" className="flex flex-wrap gap-1.5">
          {audience.map((a) => (
            <li key={a} className="rounded-full border border-fd-border px-2.5 py-0.5 text-xs">
              {AUDIENCE_LABEL[a]}
            </li>
          ))}
        </ul>
        <span>{readingMinutes} min read</span>
        <span>
          Last reviewed <time dateTime={lastReviewed}>{reviewed.format(new Date(`${lastReviewed}T00:00:00Z`))}</time>
        </span>
      </div>
    </header>
  );
}
