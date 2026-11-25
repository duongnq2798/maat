import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { gitCommit, type GitRunner } from "../src/gitCommit.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";
/** A git that answers rev-parse with `head` and status with `status`, and records what it was asked. */
const fakeGit = (head: string, status: string) => {
  const asked: { args: readonly string[]; cwd: string }[] = [];
  const git: GitRunner = (args, cwd) => (asked.push({ args, cwd }), args[0] === "rev-parse" ? `${head}\n` : status);
  return { git, asked };
};

describe("gitCommit", () => {
  it("is HEAD's 40-hex commit when the agent's tracked files are unchanged", () => {
    const g = fakeGit(SHA, "");
    expect(gitCommit("/agent", g.git)).toBe(SHA);
    expect(g.asked).toEqual([
      { args: ["rev-parse", "HEAD"], cwd: "/agent" },
      { args: ["status", "--porcelain", "--untracked-files=no", "--", "."], cwd: "/agent" },
    ]);
  });

  it("appends -dirty when a tracked file under the agent folder differs from HEAD", () => {
    expect(gitCommit("/agent", fakeGit(SHA, " M src/policy.ts\n").git)).toBe(`${SHA}-dirty`);
  });

  it("is unknown when git is missing, fails, or answers something that is not a commit", () => {
    const missing: GitRunner = () => {
      throw new Error("spawn git ENOENT");
    };
    expect(gitCommit("/agent", missing)).toBe("unknown");
    expect(gitCommit("/agent", fakeGit("fatal: not a git repository", "").git)).toBe("unknown");
  });

  it("reads the checkout of the running code by default", () => {
    const agentDir = join(dirname(fileURLToPath(import.meta.url)), "..");
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: agentDir, encoding: "utf8" }).trim();
    expect(gitCommit()).toMatch(new RegExp(`^${head}(-dirty)?$`));
  });
});
