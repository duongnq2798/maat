import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { PublishRetry } from "../lib/errors.mjs";
import { checkGitArgs, FETCH_ARGS, gitRunner, LOCAL_TIMEOUT_MS, NETWORK_TIMEOUT_MS, PUSH_ARGS, redact } from "../lib/git.mjs";

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

describe("gitRunner: a git command never blocks the loop for good", () => {
  /** A spawnSync stand-in that records its options and answers as `result` says. */
  const fakeSpawn = (result) => {
    const seen = [];
    const spawn = (cmd, args, opts) => {
      seen.push({ cmd, args, opts });
      return { status: 0, stdout: "", stderr: "", ...result };
    };
    return { spawn, seen };
  };

  it("gives fetch and push 5 minutes and every other command 1 minute, and sets git's low-speed limit", () => {
    const { spawn, seen } = fakeSpawn({});
    const run = gitRunner({ spawn });
    run([...FETCH_ARGS], ".");
    run([...PUSH_ARGS], ".");
    run(["rev-parse", "HEAD"], ".");
    assert.deepEqual(seen.map((s) => s.opts.timeout), [NETWORK_TIMEOUT_MS, NETWORK_TIMEOUT_MS, LOCAL_TIMEOUT_MS]);
    assert.equal(NETWORK_TIMEOUT_MS, 300_000);
    assert.equal(LOCAL_TIMEOUT_MS, 60_000);
    for (const { opts } of seen) {
      assert.equal(opts.env.GIT_TERMINAL_PROMPT, "0");
      assert.equal(opts.env.GIT_HTTP_LOW_SPEED_LIMIT, "1000");
      assert.equal(opts.env.GIT_HTTP_LOW_SPEED_TIME, "60");
    }
  });

  it("turns a command it had to end into a failure the next round tries again, and passes on any other error", () => {
    const timedOut = Object.assign(new Error("spawnSync git ETIMEDOUT"), { code: "ETIMEDOUT" });
    const run = gitRunner({ spawn: fakeSpawn({ status: null, signal: "SIGTERM", error: timedOut }).spawn });
    assert.throws(() => run([...FETCH_ARGS], "."), (e) => e instanceof PublishRetry && /git fetch did not finish within 300 s/.test(e.message));
    const missing = Object.assign(new Error("spawnSync git ENOENT"), { code: "ENOENT" });
    assert.throws(() => gitRunner({ spawn: fakeSpawn({ status: null, error: missing }).spawn })(["rev-parse", "HEAD"], "."), (e) => e === missing);
  });

  it("ends a real fetch from a remote that accepts the connection and never answers", async () => {
    const sockets = new Set();
    const server = createServer((s) => sockets.add(s));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const root = mkdtempSync(join(tmpdir(), "maat-journal-stall-"));
    try {
      const env = { GIT_CONFIG_GLOBAL: join(root, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1" };
      writeFileSync(env.GIT_CONFIG_GLOBAL, "");
      const setup = (args) => assert.equal(spawnSync("git", args, { cwd: root, env: { ...process.env, ...env }, windowsHide: true }).status, 0, args.join(" "));
      setup(["init", "-q"]);
      setup(["remote", "add", "origin", `http://127.0.0.1:${server.address().port}/maat.git`]);
      const run = gitRunner({ env, networkTimeoutMs: 1500 });
      const started = Date.now();
      assert.throws(() => run([...FETCH_ARGS], root), (e) => e instanceof PublishRetry && /did not finish within 1\.5 s/.test(e.message));
      assert.ok(Date.now() - started < 30_000, "the stalled fetch was ended near its time limit");
    } finally {
      // Let the server take the stalled connection, then drop it, so git's helper process (which Windows does not end
      // with git) exits and lets go of the folder.
      await new Promise((resolve) => setTimeout(resolve, 200));
      for (const s of sockets) s.destroy();
      await new Promise((resolve) => server.close(resolve));
      for (let tries = 40; ; tries--) {
        try {
          rmSync(root, { recursive: true, force: true });
          break;
        } catch (e) {
          if (tries === 0) throw e;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
    }
  });
});
