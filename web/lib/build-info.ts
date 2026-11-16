import { execFileSync } from "node:child_process";
import { SITE } from "./site";

/** The commit a build was made from, named on every docs page and at the top of llms-full.txt. */
export interface BuildCommit {
  /** The short sha a reader can quote, as in "Built from commit def033c." */
  readonly short: string;
  /** The commit on GitHub, for a Vercel deploy only: a local build may be of a commit that was never pushed. */
  readonly url?: string;
}

type Env = Record<string, string | undefined>;

const SHA = /^[0-9a-f]{7,40}$/i;

function gitHead(): string {
  return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

/**
 * The commit this build is made from: VERCEL_GIT_COMMIT_SHA on a Vercel deploy, else `git rev-parse --short HEAD`, else
 * null (no Vercel and no Git checkout), so that no page names a commit it was not built from. It says "built from", not
 * "checked against": the excerpt gate runs in `npm run verify`, not in the build.
 */
export function buildCommit(env: Env = process.env, head: () => string = gitHead): BuildCommit | null {
  const pushed = env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (pushed && SHA.test(pushed)) return { short: pushed.slice(0, 7), url: `${SITE.repoUrl}/commit/${pushed}` };
  try {
    const sha = head().trim();
    return SHA.test(sha) ? { short: sha } : null;
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

/** The stamp as Markdown, for llms-full.txt. */
export function commitMarkdown(commit: BuildCommit): string {
  const sha = `\`${commit.short}\``;
  return `Built from commit ${commit.url ? `[${sha}](${commit.url})` : sha}.`;
}
