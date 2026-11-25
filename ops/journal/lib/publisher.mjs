// One round of the publisher: read the agent's journal, bring the checkout of the agent-journal branch up to the
// remote by fast-forward only, append the rows the branch does not have yet as one commit, and push it with a plain
// push. Any doubt stops it (PublishStop); only a failure that may pass, such as the network, waits for the next round
// (PublishRetry).
import { existsSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DAY_FILE_RE, planAppend, readLocalChain } from "./chain.mjs";
import { PublishRetry, PublishStop } from "./errors.mjs";
import { BRANCH, BRANCH_REF, FETCH_ARGS, gitRunner, PUSH_ARGS, redact, REMOTE, TRACKING_REF } from "./git.mjs";

/** The public repository the owner's git login pushes the branch to. */
export const DEFAULT_REMOTE = "https://github.com/duongnq2798/maat.git";

const FORCED =
  "the remote agent-journal branch moved in a way that is not a fast-forward of what this checkout last fetched: someone force-pushed it or rewrote it. The publisher never force-pushes and pushed nothing. Compare the branch on GitHub with the checkout's log before you start the publisher again";

/**
 * @typedef {import("./git.mjs").GitRun} GitRun
 * @typedef {{ status: "waiting" | "up-to-date" | "pushed", appended: number, rows: number, head: string | null, message: string }} RoundResult
 */

/**
 * @param {{ journalFile: string, checkout: string, remote?: string, allowDryRun?: boolean, git?: GitRun }} o
 * @returns {Promise<RoundResult>}
 */
export async function publishOnce(o) {
  const git = o.git ?? gitRunner();
  let text;
  try {
    text = await readFile(o.journalFile, "utf8");
  } catch (e) {
    if (/** @type {NodeJS.ErrnoException} */ (e).code !== "ENOENT") throw e;
    return { status: "waiting", appended: 0, rows: 0, head: null, message: `no journal at ${o.journalFile} yet` };
  }
  /** @type {number[]} */
  const cut = [];
  const local = readLocalChain(text, (lineNo) => cut.push(lineNo));
  const cutNote =
    cut.length === 0
      ? ""
      : `; passed over journal.jsonl line${cut.length === 1 ? "" : "s"} ${cut.slice(0, 5).join(", ")}${cut.length > 5 ? ` and ${cut.length - 5} more` : ""}, cut short by a crash`;
  if (local.length === 0) {
    return { status: "waiting", appended: 0, rows: 0, head: null, message: `${o.journalFile} has no chained row yet (rows with prev and hash)` };
  }

  const dir = o.checkout;
  const run = (/** @type {string[]} */ args) => git(args, dir);
  /** Runs git and returns stdout; a failure stops the publisher, quoting git's first line. */
  const must = (/** @type {string[]} */ args) => {
    const r = run(args);
    if (r.code !== 0) throw new PublishStop(`git ${args[0]} failed in ${dir}: ${redact(r.stderr || r.stdout)}`);
    return r.stdout;
  };
  /** The commit a ref names, or null when it does not exist (an unborn branch, a ref never fetched). */
  const commitOf = (/** @type {string} */ ref) => {
    const r = run(["rev-parse", "-q", "--verify", `${ref}^{commit}`]);
    return r.code === 0 ? r.stdout.trim() : null;
  };

  ensureCheckout(dir, o.remote, run, must);

  // Fetch, and take only a fast-forward of what the checkout saw last.
  const f = run([...FETCH_ARGS]);
  let remoteMissing = false;
  if (f.code !== 0) {
    if (/couldn't find remote ref/i.test(f.stderr)) remoteMissing = true;
    else if (/\[rejected\]|non-fast-forward/i.test(f.stderr)) throw new PublishStop(FORCED);
    else throw new PublishRetry(`git fetch failed: ${redact(f.stderr)}`);
  }
  let head = commitOf("HEAD");
  const tracking = commitOf(TRACKING_REF);
  if (remoteMissing && tracking !== null) {
    throw new PublishStop("the remote has no agent-journal branch any more, but this checkout fetched it before: someone deleted it. The publisher pushed nothing; restore the branch on GitHub before you start it again");
  }
  if (tracking !== null && head !== tracking) {
    const isAncestor = (/** @type {string} */ a, /** @type {string} */ b) => run(["merge-base", "--is-ancestor", a, b]).code === 0;
    if (head === null || isAncestor(head, tracking)) {
      const m = run(["merge", "--ff-only", "-q", TRACKING_REF]);
      if (m.code !== 0) throw new PublishStop(`could not fast-forward the checkout to the remote branch: ${redact(m.stderr || m.stdout)}`);
      head = commitOf("HEAD");
    } else if (!isAncestor(tracking, head)) {
      throw new PublishStop(`the checkout and the remote agent-journal branch have diverged, so a push would not be a fast-forward. The publisher never force-pushes and pushed nothing; look at both before you start it again`);
    }
  }

  // The branch's day files, from the commit itself, whatever the working tree holds.
  const files =
    head === null
      ? []
      : must(["ls-tree", "--name-only", "HEAD", "journal/"])
          .split("\n")
          .map((p) => p.trim().replace(/^journal\//, ""))
          .filter((n) => DAY_FILE_RE.test(n))
          .sort()
          .map((name) => ({ name, text: must(["cat-file", "blob", `HEAD:journal/${name}`]) }));
  const plan = planAppend({ local, files, allowDryRun: o.allowDryRun ?? false });

  if (plan.appended > 0) {
    mkdirSync(join(dir, "journal"), { recursive: true });
    /** @type {Map<string, string>} */
    const writes = new Map(plan.changed.map((name) => [`journal/${name}`, /** @type {string} */ (plan.files.find((x) => x.name === name)?.text)]));
    writes.set("journal/index.json", plan.index);
    for (const [path, content] of writes) await writeFile(join(dir, path), content);
    const paths = [...writes.keys()];
    must(["add", "--", ...paths]);
    must(["commit", "-q", "-m", `journal: append ${plan.appended} row${plan.appended === 1 ? "" : "s"}, ${plan.rows} in all, head ${plan.head}`, "--", ...paths]);
    for (const [path, content] of writes) {
      if (must(["cat-file", "blob", `HEAD:${path}`]) !== content) throw new PublishStop(`the commit does not hold the planned ${path}; nothing is pushed`);
    }
    head = commitOf("HEAD");
  }

  if (head === null || head === tracking) {
    return { status: "up-to-date", appended: 0, rows: plan.rows, head: plan.head, message: `nothing new: the branch has all ${plan.rows} chained rows, head ${plan.head}${cutNote}` };
  }
  const p = run([...PUSH_ARGS]);
  if (p.code !== 0) {
    const out = `${p.stdout}\n${p.stderr}`;
    const remoteRejected = /\[remote rejected\]\s*\(([^)\n]*)\)/.exec(out);
    if (remoteRejected) throw new PublishStop(`the remote refused the push (${remoteRejected[1]}); the commit stays in the checkout, unpushed`);
    if (/\[rejected\]|non-fast-forward|fetch first/i.test(out)) {
      throw new PublishStop("the remote rejected the push as a non-fast-forward: the agent-journal branch changed on the remote since the fetch. The publisher never force-pushes; the commit stays in the checkout, unpushed. Look at the branch on GitHub before you start it again");
    }
    throw new PublishRetry(`git push failed: ${redact(p.stderr || p.stdout)}`);
  }
  const what = plan.appended > 0 ? `appended ${plan.appended} row${plan.appended === 1 ? "" : "s"} to ${plan.changed.map((n) => `journal/${n}`).join(", ")}` : "pushed the commit an earlier round could not push";
  return { status: "pushed", appended: plan.appended, rows: plan.rows, head: plan.head, message: `${what}; the ${BRANCH} branch has ${plan.rows} rows, head ${plan.head}${cutNote}` };
}

/**
 * Creates the checkout on its first use: an empty repository whose HEAD is the agent-journal branch and whose origin
 * is `remote`, fetching that branch only. Afterwards it must still be that: its own repository (never a folder inside
 * another one), on agent-journal, with origin equal to `remote` when one is given.
 * @param {string} dir
 * @param {string | undefined} remote
 * @param {(args: string[]) => import("./git.mjs").GitResult} run
 * @param {(args: string[]) => string} must
 */
function ensureCheckout(dir, remote, run, must) {
  if (!existsSync(dir) || readdirSync(dir).length === 0) {
    mkdirSync(dir, { recursive: true });
    must(["init", "-q"]);
    must(["symbolic-ref", "HEAD", BRANCH_REF]);
    must(["config", "core.autocrlf", "false"]);
    must(["config", "push.default", "nothing"]);
    must(["remote", "add", REMOTE, remote ?? DEFAULT_REMOTE]);
    must(["config", `remote.${REMOTE}.fetch`, `${BRANCH_REF}:${TRACKING_REF}`]);
  }
  const top = run(["rev-parse", "--show-toplevel"]);
  const same = (/** @type {string} */ a, /** @type {string} */ b) => {
    const norm = (/** @type {string} */ p) => {
      const r = realpathSync.native(resolve(p));
      return process.platform === "win32" ? r.toLowerCase() : r;
    };
    return norm(a) === norm(b);
  };
  if (top.code !== 0 || !same(top.stdout.trim(), dir)) {
    throw new PublishStop(`${dir} is not a git checkout of its own; point --checkout at an empty folder or at the publisher's checkout`);
  }
  const head = run(["symbolic-ref", "-q", "HEAD"]).stdout.trim();
  if (head !== BRANCH_REF) throw new PublishStop(`the checkout ${dir} is on ${head || "a detached HEAD"}, not the ${BRANCH} branch`);
  const url = must(["remote", "get-url", REMOTE]).trim();
  if (remote !== undefined && url !== remote) throw new PublishStop(`the checkout's origin is ${redact(url)}, not ${redact(remote)}`);
}
