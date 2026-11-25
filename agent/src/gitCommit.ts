import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Runs git with `args` in `cwd` and returns its stdout; throws when git is missing or fails. */
export type GitRunner = (args: readonly string[], cwd: string) => string;

const runGit: GitRunner = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true });

/** The agent/ folder of the code that is running, wherever the process was started from. */
const AGENT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The commit of the running agent code, stamped into every journal row: the 40-hex HEAD of the checkout that holds
 * `dir`, with "-dirty" appended when tracked files under `dir` differ from it (`git describe --dirty` spells it the
 * same way), or "unknown" when git cannot tell.
 */
export function gitCommit(dir: string = AGENT_DIR, git: GitRunner = runGit): string {
  try {
    const sha = git(["rev-parse", "HEAD"], dir).trim();
    if (!/^[0-9a-f]{40}$/.test(sha)) return "unknown";
    const changed = git(["status", "--porcelain", "--untracked-files=no", "--", "."], dir).trim();
    return changed.length > 0 ? `${sha}-dirty` : sha;
  } catch {
    return "unknown";
  }
}
