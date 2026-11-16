// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildCommit, commitMarkdown } from "@/lib/build-info";
import { SITE } from "@/lib/site";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const noGit = () => {
  throw new Error("not a git repository");
};

describe("buildCommit", () => {
  it("names a Vercel deploy's commit by its short sha and links it, since a pushed commit is on GitHub", () => {
    expect(buildCommit({ VERCEL_GIT_COMMIT_SHA: SHA }, noGit)).toEqual({ short: "0123456", url: `${SITE.repoUrl}/commit/${SHA}` });
  });

  it("falls back to Git's short sha for any other build, with no link: that commit may never have been pushed", () => {
    expect(buildCommit({}, () => "def033c\n")).toEqual({ short: "def033c" });
    expect(buildCommit({ VERCEL_GIT_COMMIT_SHA: " " }, () => "def033c\n")).toEqual({ short: "def033c" });
  });

  it("names no commit when there is neither a Vercel sha nor a Git checkout, rather than a wrong one", () => {
    expect(buildCommit({}, noGit)).toBeNull();
    expect(buildCommit({}, () => "fatal: not a git repository\n")).toBeNull();
    expect(buildCommit({ VERCEL_GIT_COMMIT_SHA: "main" }, noGit)).toBeNull();
  });
});

describe("commitMarkdown", () => {
  it("reads 'Built from commit <sha>.', linking the sha only for a pushed deploy", () => {
    expect(commitMarkdown({ short: "def033c" })).toBe("Built from commit `def033c`.");
    expect(commitMarkdown({ short: "0123456", url: `${SITE.repoUrl}/commit/${SHA}` })).toBe(
      `Built from commit [\`0123456\`](${SITE.repoUrl}/commit/${SHA}).`,
    );
  });
});
