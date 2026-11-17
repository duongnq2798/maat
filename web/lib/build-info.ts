import { execFileSync } from "node:child_process";
import { SITE } from "./site";

/** The commit a build was made from, named on every docs page, in its /md copy and at the top of llms-full.txt. */
export interface BuildCommit {
  /** The short sha a reader can quote, as in "Built from commit def033c." */
  readonly short: string;
  /** The commit on GitHub, for a Vercel deploy only: a local build may be of a commit that was never pushed. */
  readonly url?: string;
  /** Set when a tracked file differed from that commit: the build holds changes the commit does not. */
  readonly dirty?: boolean;
}

type Env = Record<string, string | undefined>;

/** Runs git with these arguments and returns what it prints; throws when git fails. */
export type Git = (args: readonly string[]) => string;

const SHA = /^[0-9a-f]{7,40}$/i;

const runGit: Git = (args) => execFileSync("git", [...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

/**
 * The commit this build is made from: VERCEL_GIT_COMMIT_SHA on a Vercel deploy, which builds a clean checkout of it.
 * Otherwise `git rev-parse --short HEAD`, marked dirty when `git status` lists a tracked file that differs from HEAD,
 * staged or not, so a build of work not yet committed is never passed off as its parent commit. Untracked files are not
 * counted: a stray file such as a crash dump would mark every build, and a new file counts once it is added. Null when
 * there is no Vercel sha and Git cannot answer, so that no page names a commit it was not built from. It says "built
 * from", not "checked against": the excerpt gate runs in `npm run verify`, not in the build.
 */
export function buildCommit(env: Env = process.env, git: Git = runGit): BuildCommit | null {
  const pushed = env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (pushed && SHA.test(pushed)) return { short: pushed.slice(0, 7), url: `${SITE.repoUrl}/commit/${pushed}` };
  try {
    const sha = git(["rev-parse", "--short", "HEAD"]).trim();
    if (!SHA.test(sha)) return null;
    // --no-optional-locks: a build only reads the repository, so git must not refresh the index for it.
    const changes = git(["--no-optional-locks", "status", "--porcelain", "--untracked-files=no"]).trim();
    return changes ? { short: sha, dirty: true } : { short: sha };
  } catch {
    return null;
  }
}

let current: BuildCommit | null | undefined;

/** buildCommit() once per process: every page of a build names the same commit, and Git runs once. */
export function currentBuildCommit(): BuildCommit | null {
  if (current === undefined) current = buildCommit();
  return current;
}

/** What follows the sha: ", with uncommitted changes." for a dirty build, else ".". */
export function commitSuffix(commit: BuildCommit): string {
  return commit.dirty ? ", with uncommitted changes." : ".";
}

/** The stamp as Markdown, for llms-full.txt and the /md copies. */
export function commitMarkdown(commit: BuildCommit): string {
  const sha = `\`${commit.short}\``;
  return `Built from commit ${commit.url ? `[${sha}](${commit.url})` : sha}${commitSuffix(commit)}`;
}
