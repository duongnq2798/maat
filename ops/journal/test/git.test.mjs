import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkGitArgs, FETCH_ARGS, PUSH_ARGS, redact } from "../lib/git.mjs";

describe("checkGitArgs: the only git commands the publisher can run", () => {
  it("pushes exactly one refspec, agent-journal to agent-journal, with no force", () => {
    assert.deepEqual([...PUSH_ARGS], ["push", "--porcelain", "origin", "refs/heads/agent-journal:refs/heads/agent-journal"]);
    assert.doesNotThrow(() => checkGitArgs([...PUSH_ARGS]));
  });

  it("refuses any other push: a force, a plus refspec, another branch, every branch, tags, a delete, a mirror", () => {
    const refused = [
      ["push", "--force", "origin", "refs/heads/agent-journal:refs/heads/agent-journal"],
      ["push", "-f", "origin", "refs/heads/agent-journal:refs/heads/agent-journal"],
      ["push", "--force-with-lease", "origin", "refs/heads/agent-journal:refs/heads/agent-journal"],
      ["push", "--porcelain", "origin", "+refs/heads/agent-journal:refs/heads/agent-journal"],
      ["push", "--porcelain", "origin", "refs/heads/agent-journal:refs/heads/main"],
      ["push", "--porcelain", "origin", "refs/heads/main:refs/heads/main"],
      ["push", "--porcelain", "origin", "HEAD"],
      ["push", "origin"],
      ["push", "--all", "origin"],
      ["push", "--tags", "origin"],
      ["push", "--mirror", "origin"],
      ["push", "--delete", "origin", "agent-journal"],
      ["push", "--porcelain", "origin", ":refs/heads/agent-journal"],
      ["push", "--porcelain", "origin", "refs/heads/agent-journal:refs/heads/agent-journal", "refs/heads/main:refs/heads/main"],
    ];
    for (const args of refused) assert.throws(() => checkGitArgs(args), /refused/, args.join(" "));
  });

  it("fetches only agent-journal, into its tracking ref, with no plus that would accept a rewrite", () => {
    assert.deepEqual([...FETCH_ARGS], ["fetch", "--no-tags", "origin", "refs/heads/agent-journal:refs/remotes/origin/agent-journal"]);
    assert.doesNotThrow(() => checkGitArgs([...FETCH_ARGS]));
    assert.throws(() => checkGitArgs(["fetch", "--no-tags", "origin", "+refs/heads/agent-journal:refs/remotes/origin/agent-journal"]), /refused/);
    assert.throws(() => checkGitArgs(["fetch", "origin"]), /refused/);
  });

  it("refuses every command that rewrites history or moves a branch backwards", () => {
    const refused = [
      ["reset", "--hard", "HEAD~1"],
      ["rebase", "origin/agent-journal"],
      ["commit", "--amend", "-m", "x"],
      ["update-ref", "refs/heads/agent-journal", "HEAD~1"],
      ["filter-branch", "--all"],
      ["branch", "-f", "agent-journal", "HEAD~1"],
      ["checkout", "-B", "agent-journal"],
      ["merge", "origin/agent-journal"],
      ["merge", "--no-ff", "origin/agent-journal"],
      ["config", "--global", "user.name", "x"],
      ["gc", "--prune=now"],
    ];
    for (const args of refused) assert.throws(() => checkGitArgs(args), /refused/, args.join(" "));
    assert.doesNotThrow(() => checkGitArgs(["merge", "--ff-only", "-q", "refs/remotes/origin/agent-journal"]));
    assert.doesNotThrow(() => checkGitArgs(["commit", "-q", "-m", "journal: append 2 rows", "--", "journal/index.json"]));
  });
});

describe("redact", () => {
  it("keeps the first line of git's output and hides credentials in a URL", () => {
    assert.equal(redact("fatal: unable to access 'https://user:fake-token@github.com/x.git/'\nhint: more"), "fatal: unable to access 'https://***@github.com/x.git/'");
  });
});
