import { type BuildCommit, commitSuffix } from "@/lib/build-info";

/**
 * "Built from commit def033c.", the sha linked to the commit on GitHub only when the build knows it was pushed, and
 * ", with uncommitted changes." when the build held changes that commit does not. The Source of truth box and the page
 * footer show it; commitMarkdown in lib/build-info.ts is the same stamp in Markdown.
 */
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
      {commitSuffix(commit)}
    </p>
  );
}
