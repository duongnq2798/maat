import { type BuildCommit, currentBuildCommit } from "@/lib/build-info";
import { SITE } from "@/lib/site";

/** Lists longer than this fold into a disclosure, so a page's end is not a wall of paths. */
const OPEN_FILES = 5;

/** "Built from commit def033c.", the sha linked to the commit on GitHub only when the build knows it was pushed. */
export function BuiltFrom({ commit, className }: { commit: BuildCommit | null; className?: string }) {
  if (!commit) return null;
  const sha = <code className="font-mono">{commit.short}</code>;
  return (
    <p className={className}>
      Built from commit{" "}
      {commit.url ? (
        <a href={commit.url} className="inline-flex min-h-11 items-center text-fd-primary underline-offset-4 hover:underline md:min-h-0">
          {sha}
        </a>
      ) : (
        sha
      )}
      .
    </p>
  );
}

/** The repo files a page is checked against, so a reader can verify every claim where it is defined. */
export function SourceOfTruth({ sources, commit = currentBuildCommit() }: { sources: readonly string[]; commit?: BuildCommit | null }) {
  if (sources.length === 0) return null;
  const files = (
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
  );
  return (
    <aside aria-labelledby="source-of-truth" className="not-prose mt-10 rounded-xl border border-fd-border bg-fd-card p-4 text-sm">
      <h2 id="source-of-truth" className="font-semibold text-fd-card-foreground">
        Source of truth
      </h2>
      <p className="mt-1 text-fd-muted-foreground">This page is checked against these files. If they disagree, the files win.</p>
      {sources.length > OPEN_FILES ? (
        // A printout lists the files even with the disclosure closed.
        <details className="mt-2 print:[&::details-content]:[content-visibility:visible]">
          <summary className="cursor-pointer py-3 font-medium text-fd-card-foreground md:py-1.5">
            Source of truth ({sources.length} files)
          </summary>
          {files}
        </details>
      ) : (
        files
      )}
      <BuiltFrom commit={commit} className="mt-2 text-fd-muted-foreground" />
    </aside>
  );
}
