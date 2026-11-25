// End to end: the publisher against a temporary bare repository that stands in for GitHub, with real git.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { PublishRetry, PublishStop } from "../lib/errors.mjs";
import { gitRunner, PUSH_ARGS } from "../lib/git.mjs";
import { publishOnce } from "../lib/publisher.mjs";
import { chainRows, jsonl, liveRun } from "./helpers.mjs";

const BRANCH = "refs/heads/agent-journal";

/** A temporary world: a bare remote, the agent's data dir and the publisher's checkout, with a git config of its own. */
function world() {
  const root = mkdtempSync(join(tmpdir(), "maat-journal-"));
  const gitconfig = join(root, "gitconfig");
  writeFileSync(gitconfig, "[user]\n\tname = Journal Test\n\temail = journal-test@example.invalid\n[init]\n\tdefaultBranch = main\n");
  const env = { GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: "1" };
  const git = (args, cwd = root) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...env }, windowsHide: true });
    if (r.status !== 0) throw new Error(`test git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const remote = join(root, "remote.git");
  git(["init", "-q", "--bare", remote]);
  const dataDir = join(root, "data");
  mkdirSync(dataDir);
  const journalFile = join(dataDir, "journal.jsonl");
  /** Every git command the publisher ran. */
  const calls = [];
  const real = gitRunner({ env });
  const runner = (args, cwd) => {
    calls.push([...args]);
    return real(args, cwd);
  };
  const o = { journalFile, checkout: join(root, "checkout"), remote, git: runner };
  const remoteGit = (...args) => git(["--git-dir", remote, ...args]);
  return { root, env, git, remote, remoteGit, journalFile, calls, o, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const rows1 = chainRows([liveRun("2026-11-26T14:00:00.000Z", "r1"), liveRun("2026-11-26T14:15:00.000Z", "r2")]);
const rows2 = chainRows([liveRun("2026-11-26T23:59:00.000Z", "r3"), liveRun("2026-11-27T00:14:00.000Z", "r4")], rows1[1].hash);
const rows3 = chainRows([liveRun("2026-11-27T00:29:00.000Z", "r5")], rows2[1].hash);

async function stopOf(p) {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof PublishStop, `expected a PublishStop, got ${e?.stack ?? e}`);
    return e;
  }
  assert.fail("expected a PublishStop");
}

describe("publishOnce against a local bare repository", () => {
  let w;
  before(() => {
    w = world();
  });
  after(() => w.cleanup());

  it("waits while there is no journal, or no chained row in it", async () => {
    assert.equal((await publishOnce(w.o)).status, "waiting");
    writeFileSync(w.journalFile, jsonl([{ ts: "2026-11-26T13:00:00.000Z", kind: "run", runId: "r0", mode: "live" }]));
    assert.equal((await publishOnce(w.o)).status, "waiting");
    assert.deepEqual(w.calls, []);
  });

  it("first run: creates the checkout, commits the rows and pushes the agent-journal branch", async () => {
    appendFileSync(w.journalFile, jsonl(rows1));
    const r = await publishOnce(w.o);
    assert.equal(r.status, "pushed");
    assert.equal(r.appended, 2);
    assert.equal(r.rows, 2);
    assert.equal(w.remoteGit("for-each-ref", "--format=%(refname)"), BRANCH);
    const day = w.remoteGit("show", "agent-journal:journal/2026-11-26.jsonl").split("\n");
    assert.deepEqual(day.map((l) => JSON.parse(l).hash), rows1.map((x) => x.hash));
    assert.deepEqual(JSON.parse(w.remoteGit("show", "agent-journal:journal/index.json")), { days: ["2026-11-26.jsonl"], head: rows1[1].hash, rows: 2, v: 1 });
  });

  it("second run: appends only the new rows as one more commit on top, across a UTC day", async () => {
    const before = w.remoteGit("rev-parse", BRANCH);
    appendFileSync(w.journalFile, jsonl(rows2));
    const r = await publishOnce(w.o);
    assert.equal(r.status, "pushed");
    assert.equal(r.appended, 2);
    const after = w.remoteGit("rev-parse", BRANCH);
    assert.equal(w.remoteGit("rev-list", "--count", BRANCH), "2");
    assert.equal(w.remoteGit("rev-parse", `${after}~1`), before);
    assert.equal(w.remoteGit("show", "agent-journal:journal/2026-11-26.jsonl").split("\n").length, 3);
    assert.equal(w.remoteGit("show", "agent-journal:journal/2026-11-27.jsonl").split("\n").length, 1);
    assert.deepEqual(JSON.parse(w.remoteGit("show", "agent-journal:journal/index.json")), { days: ["2026-11-26.jsonl", "2026-11-27.jsonl"], head: rows2[1].hash, rows: 4, v: 1 });
  });

  it("a run with nothing new commits and pushes nothing: no row goes up twice", async () => {
    const pushes = w.calls.filter((c) => c[0] === "push").length;
    const r = await publishOnce(w.o);
    assert.equal(r.status, "up-to-date");
    assert.equal(r.appended, 0);
    assert.equal(w.remoteGit("rev-list", "--count", BRANCH), "2");
    assert.equal(w.calls.filter((c) => c[0] === "push").length, pushes);
  });

  it("pushes nothing but agent-journal, even with other branches and tags in the checkout", () => {
    w.git(["branch", "other"], w.o.checkout);
    w.git(["tag", "v-test"], w.o.checkout);
    return publishOnce(w.o).then(() => {
      assert.equal(w.remoteGit("for-each-ref", "--format=%(refname)"), BRANCH);
      const pushes = w.calls.filter((c) => c[0] === "push");
      assert.ok(pushes.length >= 2);
      for (const c of pushes) assert.deepEqual(c, [...PUSH_ARGS]);
      assert.equal(w.calls.some((c) => c.some((a) => /^(?:-f|--force.*|\+.*)$/.test(a))), false);
    });
  });

  it("a forced remote change makes the next run stop, and the publisher does not force-push over it", async () => {
    // What a force push to GitHub would leave: the branch moved to a commit that does not contain the old head.
    const parent = w.remoteGit("rev-parse", `${BRANCH}~1`);
    const rewritten = spawnSync("git", ["--git-dir", w.remote, "commit-tree", `${parent}^{tree}`, "-p", parent, "-m", "rewritten"], { encoding: "utf8", env: { ...process.env, ...w.env } }).stdout.trim();
    w.remoteGit("update-ref", BRANCH, rewritten);
    appendFileSync(w.journalFile, jsonl(rows3));
    const callsBefore = w.calls.length;
    const e = await stopOf(publishOnce(w.o));
    assert.match(e.message, /not a fast-forward/);
    assert.match(e.message, /never force-pushes/);
    assert.equal(w.remoteGit("rev-parse", BRANCH), rewritten);
    assert.equal(w.calls.slice(callsBefore).some((c) => c[0] === "push"), false);
    // It keeps stopping until the owner looks: the next run stops the same way.
    await stopOf(publishOnce(w.o));
    assert.equal(w.remoteGit("rev-parse", BRANCH), rewritten);
  });
});

describe("publishOnce after a crash cut a journal line short", () => {
  let w;
  before(() => {
    w = world();
  });
  after(() => w.cleanup());

  it("waits while the cut line has no line feed, then passes over it and pushes the rows after it", async () => {
    writeFileSync(w.journalFile, jsonl(rows1.slice(0, 1)));
    assert.equal((await publishOnce(w.o)).appended, 1);
    // The crash: half a row and no line feed. The agent's next start writes a line feed first, then the next row.
    appendFileSync(w.journalFile, JSON.stringify(rows1[1]).slice(0, 50));
    assert.equal((await publishOnce(w.o)).status, "up-to-date");
    appendFileSync(w.journalFile, `\n${jsonl(rows1.slice(1))}`);
    const r = await publishOnce(w.o);
    assert.equal(r.status, "pushed");
    assert.equal(r.appended, 1);
    assert.match(r.message, /passed over journal\.jsonl line 2, cut short by a crash/);
    assert.deepEqual(JSON.parse(w.remoteGit("show", "agent-journal:journal/index.json")), { days: ["2026-11-26.jsonl"], head: rows1[1].hash, rows: 2, v: 1 });
    assert.match((await publishOnce(w.o)).message, /nothing new.*passed over journal\.jsonl line 2/);
  });
});

describe("publishOnce when the push itself is refused or fails", () => {
  let w;
  before(() => {
    w = world();
  });
  after(() => w.cleanup());

  it("a push the network drops is retried by the next run, which pushes the kept commit", async () => {
    writeFileSync(w.journalFile, jsonl(rows1));
    const real = w.o.git;
    const flaky = (args, cwd) => (args[0] === "push" ? { code: 128, stdout: "", stderr: "fatal: unable to access 'https://user:fake-token@example.invalid/x.git/': Could not resolve host\n" } : real(args, cwd));
    await assert.rejects(publishOnce({ ...w.o, git: flaky }), (e) => e instanceof PublishRetry && !e.message.includes("fake-token"));
    assert.equal(w.remoteGit("for-each-ref"), "");
    const r = await publishOnce(w.o);
    assert.equal(r.status, "pushed");
    assert.equal(r.appended, 0);
    assert.equal(w.remoteGit("rev-list", "--count", BRANCH), "1");
  });

  it("a push the remote rejects as a non-fast-forward stops the publisher", async () => {
    appendFileSync(w.journalFile, jsonl(rows2));
    const real = w.o.git;
    // The remote moves between the fetch and the push, as a force push from elsewhere at that moment would.
    const racing = (args, cwd) => {
      if (args[0] === "push") {
        const parent = w.remoteGit("rev-parse", BRANCH);
        const other = spawnSync("git", ["--git-dir", w.remote, "commit-tree", `${parent}^{tree}`, "-p", parent, "-m", "elsewhere"], { encoding: "utf8", env: { ...process.env, ...w.env } }).stdout.trim();
        w.remoteGit("update-ref", BRANCH, other);
      }
      return real(args, cwd);
    };
    const e = await stopOf(publishOnce({ ...w.o, git: racing }));
    assert.match(e.message, /rejected the push as a non-fast-forward/);
    assert.equal(w.remoteGit("log", "-1", "--format=%s", BRANCH), "elsewhere");
  });
});

describe("publishOnce when the remote branch was deleted, or moved on while a commit waited", () => {
  let w;
  before(() => {
    w = world();
  });
  after(() => w.cleanup());
  const commitOnRemote = (message) => {
    const parent = w.remoteGit("rev-parse", BRANCH);
    return spawnSync("git", ["--git-dir", w.remote, "commit-tree", `${parent}^{tree}`, "-p", parent, "-m", message], { encoding: "utf8", env: { ...process.env, ...w.env } }).stdout.trim();
  };

  it("stops when a commit could not be pushed and the remote branch has moved on since: they diverged", async () => {
    writeFileSync(w.journalFile, jsonl(rows1));
    await publishOnce(w.o);
    appendFileSync(w.journalFile, jsonl(rows2));
    const real = w.o.git;
    const offline = (args, cwd) => (args[0] === "push" ? { code: 128, stdout: "", stderr: "fatal: Could not resolve host\n" } : real(args, cwd));
    await assert.rejects(publishOnce({ ...w.o, git: offline }), PublishRetry);
    // Someone else appends a commit to the branch on the remote meanwhile, by a plain fast-forward.
    const theirs = commitOnRemote("appended elsewhere");
    w.remoteGit("update-ref", BRANCH, theirs);
    const e = await stopOf(publishOnce(w.o));
    assert.match(e.message, /have diverged/);
    assert.equal(w.remoteGit("rev-parse", BRANCH), theirs);
  });

  it("stops when the branch it pushed before is gone from the remote, and pushes nothing", async () => {
    w.remoteGit("update-ref", "-d", BRANCH);
    const e = await stopOf(publishOnce(w.o));
    assert.match(e.message, /no agent-journal branch any more/);
    assert.equal(w.remoteGit("for-each-ref"), "");
  });
});

describe("publishOnce refuses before it commits", () => {
  let w;
  before(() => {
    w = world();
  });
  after(() => w.cleanup());

  it("a broken local chain stops it before any git command", async () => {
    writeFileSync(w.journalFile, jsonl([rows1[0], { ...rows1[1], summary: "edited" }]));
    const e = await stopOf(publishOnce(w.o));
    assert.match(e.message, /line 2\b.*hash/);
    assert.deepEqual(w.calls, []);
  });

  it("a row with a URL in an exported field stops it with no commit and no push", async () => {
    const leak = chainRows([liveRun("2026-11-26T14:00:00.000Z", "r1", { mode: "live see https://rpc.example.org/v2/fake-key" })]);
    writeFileSync(w.journalFile, jsonl(leak));
    const e = await stopOf(publishOnce(w.o));
    assert.match(e.message, /URL_RE/);
    assert.equal(/fake|rpc\.example/.test(e.message), false);
    assert.equal(w.calls.some((c) => c[0] === "commit" || c[0] === "push"), false);
    assert.equal(w.remoteGit("for-each-ref"), "");
  });

  it("--allow-dry-run refuses the public repository as origin, given, by default or in the checkout, before any fetch", async () => {
    const dry = chainRows([liveRun("2026-11-26T14:00:00.000Z", "d1", { mode: "dry-run" })]);
    writeFileSync(w.journalFile, jsonl(dry));
    const calls = w.calls.length;
    // These rounds must never reach GitHub, guard or no guard: a fetch or a push fails the test instead.
    const offline = (args, cwd) => {
      if (args[0] === "fetch" || args[0] === "push") throw new Error(`test: git ${args[0]} must not run here`);
      return w.o.git(args, cwd);
    };
    const fresh = join(w.root, "rehearsal");
    for (const remote of [undefined, "https://github.com/duongnq2798/maat.git", "https://github.com/duongnq2798/maat", "git@github.com:duongnq2798/maat.git", "ssh://git@github.com/duongnq2798/Maat.git/"]) {
      const e = await stopOf(publishOnce({ ...w.o, checkout: fresh, remote, allowDryRun: true, git: offline }));
      assert.match(e.message, /--allow-dry-run.*remote of your own/);
    }
    assert.equal(existsSync(fresh), false, "no checkout is made for a refused rehearsal");
    // A checkout made earlier with the public origin is refused too, when no --remote is given.
    const made = join(w.root, "made");
    mkdirSync(made);
    w.git(["init", "-q"], made);
    w.git(["symbolic-ref", "HEAD", BRANCH], made);
    w.git(["remote", "add", "origin", "https://github.com/duongnq2798/maat.git"], made);
    assert.match((await stopOf(publishOnce({ ...w.o, checkout: made, remote: undefined, allowDryRun: true, git: offline }))).message, /--allow-dry-run/);
    assert.equal(w.calls.slice(calls).some((c) => c[0] === "fetch" || c[0] === "push"), false);
    // A remote of one's own is fine.
    const own = join(w.root, "own.git");
    w.git(["init", "-q", "--bare", own]);
    assert.equal((await publishOnce({ ...w.o, checkout: join(w.root, "own"), remote: own, allowDryRun: true })).status, "pushed");
  });

  it("a checkout on another branch, or pushing to another remote, stops it", async () => {
    writeFileSync(w.journalFile, jsonl(rows1));
    await publishOnce(w.o);
    assert.match((await stopOf(publishOnce({ ...w.o, remote: join(w.root, "elsewhere.git") }))).message, /origin is .*, not/);
    w.git(["switch", "-q", "-c", "side"], w.o.checkout);
    assert.match((await stopOf(publishOnce(w.o))).message, /on refs\/heads\/side, not the agent-journal branch/);
  });
});
