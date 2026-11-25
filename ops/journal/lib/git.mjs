// Every git command the publisher runs goes through gitRunner, which refuses anything but the few commands below.
// It can push one refspec only, agent-journal to agent-journal with no force, and it has no command that rewrites
// history or moves a branch backwards.
import { spawnSync } from "node:child_process";
import { PublishRetry } from "./errors.mjs";

export const BRANCH = "agent-journal";
export const REMOTE = "origin";
export const BRANCH_REF = `refs/heads/${BRANCH}`;
export const TRACKING_REF = `refs/remotes/${REMOTE}/${BRANCH}`;
/** The one push the publisher makes: a plain push of agent-journal to agent-journal. */
export const PUSH_ARGS = Object.freeze(["push", "--porcelain", REMOTE, `${BRANCH_REF}:${BRANCH_REF}`]);
/** The one fetch: agent-journal into its tracking ref with no "+", so git refuses to take a rewrite of it. */
export const FETCH_ARGS = Object.freeze(["fetch", "--no-tags", REMOTE, `${BRANCH_REF}:${TRACKING_REF}`]);

const COMMANDS = new Set(["init", "symbolic-ref", "config", "remote", "rev-parse", "merge-base", "merge", "ls-tree", "cat-file", "add", "commit", "fetch", "push"]);
const FORBIDDEN = /^(?:-f|-B|-D|-d|--force.*|--mirror|--all|--tags|--delete|--amend|--hard|--no-ff|--global|--system|--prune.*)$/;

/** @param {readonly string[]} a @param {readonly string[]} b */
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Throws unless `args` is a git command the publisher may run.
 * @param {readonly string[]} args
 */
export function checkGitArgs(args) {
  const [cmd = "", ...rest] = args;
  const refuse = (why) => {
    throw new Error(`refused: git ${args.join(" ")}: ${why}`);
  };
  if (!COMMANDS.has(cmd)) refuse("not a command the publisher runs");
  if (cmd === "push") {
    if (!same(args, PUSH_ARGS)) refuse(`the only push is git ${PUSH_ARGS.join(" ")}`);
    return;
  }
  if (cmd === "fetch") {
    if (!same(args, FETCH_ARGS)) refuse(`the only fetch is git ${FETCH_ARGS.join(" ")}`);
    return;
  }
  if (cmd === "merge" && rest[0] !== "--ff-only") refuse("a merge must be --ff-only");
  for (const a of rest) {
    if (FORBIDDEN.test(a) || a.startsWith("+")) refuse(`${a} is not allowed`);
  }
}

/**
 * The first line of git's output with any credentials in a URL hidden, for a log line.
 * @param {string} text
 */
export function redact(text) {
  const first = text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  return first.replace(/(\/\/)[^\s/@]+@/g, "$1***@").trim().slice(0, 300);
}

/**
 * @typedef {{ code: number, stdout: string, stderr: string }} GitResult
 * @typedef {(args: readonly string[], cwd: string) => GitResult} GitRun
 */

/** How long a fetch or a push may take, sign-in window included, before it is ended and the next round tries again. */
export const NETWORK_TIMEOUT_MS = 300_000;
/** How long any other git command may take, such as a commit waiting on a signing prompt. */
export const LOCAL_TIMEOUT_MS = 60_000;
/** Git ends an HTTP transfer that moves under 1,000 bytes a second for 60 seconds. */
const LOW_SPEED_ENV = { GIT_HTTP_LOW_SPEED_LIMIT: "1000", GIT_HTTP_LOW_SPEED_TIME: "60" };

/**
 * Runs git through checkGitArgs. Git never prompts in the terminal (GIT_TERMINAL_PROMPT=0), so a missing login fails
 * at once instead of hanging the loop; a credential helper, such as Git Credential Manager on Windows, still works.
 * No command runs for good: a stalled transfer fails on git's low-speed limit, and a command past its time limit is
 * ended and thrown as a PublishRetry, so the loop says so and tries again next round.
 * @param {{ env?: Record<string, string>, networkTimeoutMs?: number, localTimeoutMs?: number, spawn?: typeof spawnSync }} [o]
 * @returns {GitRun}
 */
export function gitRunner(o = {}) {
  const spawn = o.spawn ?? spawnSync;
  return (args, cwd) => {
    checkGitArgs(args);
    const network = args[0] === "fetch" || args[0] === "push";
    const timeout = network ? (o.networkTimeoutMs ?? NETWORK_TIMEOUT_MS) : (o.localTimeoutMs ?? LOCAL_TIMEOUT_MS);
    const r = spawn("git", [...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...LOW_SPEED_ENV, ...o.env },
      windowsHide: true,
      maxBuffer: 512 * 1024 * 1024,
      timeout,
    });
    if (r.error && /** @type {NodeJS.ErrnoException} */ (r.error).code === "ETIMEDOUT") {
      throw new PublishRetry(`git ${args[0]} did not finish within ${timeout / 1000} s and was ended`);
    }
    if (r.error) throw r.error;
    return { code: r.status ?? 1, stdout: String(r.stdout), stderr: String(r.stderr) };
  };
}
