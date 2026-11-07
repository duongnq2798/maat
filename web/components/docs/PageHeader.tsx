import { getBreadcrumbItems } from "fumadocs-core/breadcrumb";
import { DocsDescription, DocsTitle } from "fumadocs-ui/layouts/docs/page";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { source } from "@/lib/docs-source";
import { AUDIENCE_LABEL, type Audience, type DocStatus } from "@/lib/docs/frontmatter";
import { StatusBadge } from "./StatusBadge";

interface PageHeaderProps {
  url: string;
  title: string;
  description?: string;
  status: DocStatus;
  audience: readonly Audience[];
  readingMinutes: number;
  /** ISO date, YYYY-MM-DD. */
  lastReviewed: string;
}

const reviewed = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

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

/** Breadcrumb, H1, lede, then status, audience, reading time and review date in one row. */
export function PageHeader({ url, title, description, status, audience, readingMinutes, lastReviewed }: PageHeaderProps) {
  return (
    <header>
      <Breadcrumbs url={url} />
      <DocsTitle>{title}</DocsTitle>
      <DocsDescription className="mt-2 mb-4">{description}</DocsDescription>
      <div className="mb-8 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-fd-muted-foreground">
        <StatusBadge status={status} />
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
