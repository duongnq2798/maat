// Every git command the publisher runs goes through gitRunner, which refuses anything but the few commands below.
// It can push one refspec only, agent-journal to agent-journal with no force, and it has no command that rewrites
// history or moves a branch backwards.
import { spawnSync } from "node:child_process";

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

/**
 * Runs git through checkGitArgs. Git never prompts in the terminal (GIT_TERMINAL_PROMPT=0), so a missing login fails
 * at once instead of hanging the loop; a credential helper, such as Git Credential Manager on Windows, still works.
 * @param {{ env?: Record<string, string> }} [o]
 * @returns {GitRun}
 */
export function gitRunner(o = {}) {
  return (args, cwd) => {
    checkGitArgs(args);
    const r = spawnSync("git", [...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...o.env },
      windowsHide: true,
      maxBuffer: 512 * 1024 * 1024,
    });
    if (r.error) throw r.error;
    return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
  };
}
