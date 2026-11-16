import { getBreadcrumbItems } from "fumadocs-core/breadcrumb";
import { DocsDescription, DocsTitle } from "fumadocs-ui/layouts/docs/page";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { source } from "@/lib/docs-source";
import { AUDIENCE_LABEL, type Audience, type DocStatus, STATUS_LABEL } from "@/lib/docs/frontmatter";
import { StatusBadge } from "./StatusBadge";

interface PageHeaderProps {
  url: string;
  title: string;
  description?: string;
  /** Left out on a page that describes no part of Maat, such as the Help pages. */
  status?: DocStatus;
  audience: readonly Audience[];
  readingMinutes: number;
  /** ISO date, YYYY-MM-DD. */
  lastReviewed: string;
}

const reviewed = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Each label's meaning, word for word from the table on the status page (test/docs-page.test.tsx compares them). */
export const STATUS_MEANING: Record<DocStatus, string> = {
  "fork-tested": "Built and tested; the contracts and the send path have run on a Base mainnet fork; not deployed.",
  live: "Deployed to Base mainnet by the owner, with the addresses recorded in deployments/README.md.",
  planned: "Designed but not built.",
};

/**
 * The status label, linked to what the labels mean. Its meaning is the link's description, in visually hidden text:
 * a title shows only on hover, and aria-description is still an ARIA 1.3 draft.
 */
function StatusLink({ status }: { status: DocStatus }) {
  return (
    <>
      <Link
        href="/docs/get-started/status#what-the-three-labels-mean"
        aria-label={`Status: ${STATUS_LABEL[status]}. What this label means`}
        aria-describedby="status-meaning"
        className="inline-flex min-h-11 items-center md:min-h-0 hover:[&>[data-status]]:bg-fd-accent hover:[&>[data-status]]:text-fd-accent-foreground"
      >
        <StatusBadge status={status} />
      </Link>
      <span id="status-meaning" className="sr-only">
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
