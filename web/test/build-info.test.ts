// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildCommit, commitMarkdown, type Git } from "@/lib/build-info";
import { SITE } from "@/lib/site";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const noGit: Git = () => {
  throw new Error("not a git repository");
};
const STATUS = ["--no-optional-locks", "status", "--porcelain", "--untracked-files=no"];

/** A checkout whose HEAD is `head` and whose `git status` prints `changes`, recording every call. */
function checkout(head: string, changes = "") {
  const calls: string[][] = [];
  const git: Git = (args) => {
    calls.push([...args]);
    if (args.join(" ") === "rev-parse --short HEAD") return head;
    if (args.join(" ") === STATUS.join(" ")) return changes;
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
  return { git, calls };
}

describe("buildCommit", () => {
  it("names a Vercel deploy's commit by its short sha and links it, since a pushed commit is on GitHub", () => {
    expect(buildCommit({ VERCEL_GIT_COMMIT_SHA: SHA }, noGit)).toEqual({ short: "0123456", url: `${SITE.repoUrl}/commit/${SHA}` });
  });

  it("falls back to Git's short sha for any other build, with no link: that commit may never have been pushed", () => {
    expect(buildCommit({}, checkout("def033c\n").git)).toEqual({ short: "def033c" });
    expect(buildCommit({ VERCEL_GIT_COMMIT_SHA: " " }, checkout("def033c\n").git)).toEqual({ short: "def033c" });
  });

  it("asks Git whether a tracked file differs from that commit, without taking a lock or counting untracked files", () => {
    const { git, calls } = checkout("def033c\n");
    buildCommit({}, git);
    expect(calls).toEqual([["rev-parse", "--short", "HEAD"], STATUS]);
  });

  it("says so when the build has changes not yet committed, so it never passes them off as that commit", () => {
    expect(buildCommit({}, checkout("def033c\n", " M web/lib/build-info.ts\n").git)).toEqual({ short: "def033c", dirty: true });
    expect(buildCommit({}, checkout("def033c\n", "M  web/content/docs/index.mdx\n").git)).toEqual({ short: "def033c", dirty: true });
  });

  it("names no commit when there is neither a Vercel sha nor a Git checkout, or Git cannot say what changed, rather than a wrong one", () => {
    expect(buildCommit({}, noGit)).toBeNull();
    expect(buildCommit({}, checkout("fatal: not a git repository\n").git)).toBeNull();
    expect(buildCommit({ VERCEL_GIT_COMMIT_SHA: "main" }, noGit)).toBeNull();
    const statusFails: Git = (args) => {
      if (args[0] === "rev-parse") return "def033c\n";
      throw new Error("index.lock exists");
    };
    expect(buildCommit({}, statusFails)).toBeNull();
  });
});

describe("commitMarkdown", () => {
  it("reads 'Built from commit <sha>.', linking the sha only for a pushed deploy", () => {
    expect(commitMarkdown({ short: "def033c" })).toBe("Built from commit `def033c`.");
    expect(commitMarkdown({ short: "0123456", url: `${SITE.repoUrl}/commit/${SHA}` })).toBe(
      `Built from commit [\`0123456\`](${SITE.repoUrl}/commit/${SHA}).`,
    );
  });

  it("adds ', with uncommitted changes' for a build of a tree that differs from its commit", () => {
    expect(commitMarkdown({ short: "def033c", dirty: true })).toBe("Built from commit `def033c`, with uncommitted changes.");
  });
});
