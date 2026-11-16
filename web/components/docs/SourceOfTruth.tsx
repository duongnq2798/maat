import { SITE } from "@/lib/site";

/** The repo files a page is checked against, so a reader can verify every claim where it is defined. */
export function SourceOfTruth({ sources }: { sources: readonly string[] }) {
  if (sources.length === 0) return null;
  return (
    <aside aria-labelledby="source-of-truth" className="not-prose mt-10 rounded-xl border border-fd-border bg-fd-card p-4 text-sm">
      <h2 id="source-of-truth" className="font-semibold text-fd-card-foreground">
        Source of truth
      </h2>
      <p className="mt-1 text-fd-muted-foreground">This page is checked against these files. If they disagree, the files win.</p>
      <ul className="mt-2">
        {sources.map((path) => (
          <li key={path}>
            <a
              href={`${SITE.repoUrl}/blob/main/${path}`}
              className="inline-flex min-h-11 items-center font-mono text-xs break-all text-fd-primary underline-offset-4 hover:underline md:min-h-8"
            >
              {path}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}
