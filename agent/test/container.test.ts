import { readFileSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { parseEnv } from "node:util";
import { describe, expect, it } from "vitest";
import { DEPLOYMENTS_FILE } from "../src/briefs/inbox.js";

// No Docker on the dev machine: the image is built remotely, so these text checks are what guards it before a build.
const AGENT_DIR = join(import.meta.dirname, "..");
const read = (file: string) => readFileSync(join(AGENT_DIR, file), "utf8");

/** Dockerfile instructions in order, with comments dropped and `\` continuations joined. */
function instructions(text: string): { op: string; args: string }[] {
  return text
    .replace(/\\\r?\n/g, " ")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"))
    .map((l) => {
      const [op = "", ...rest] = l.split(/\s+/);
      return { op: op.toUpperCase(), args: rest.join(" ") };
    });
}

const docker = instructions(read("Dockerfile"));
const all = (op: string) => docker.filter((i) => i.op === op);
const ignored = read(".dockerignore")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l !== "" && !l.startsWith("#"));

/** Source paths of every COPY and ADD: flags and the destination dropped, exec (JSON) form included. */
const copySources = docker
  .filter((i) => i.op === "COPY" || i.op === "ADD")
  .flatMap((i) => {
    const words: string[] = i.args.startsWith("[") ? JSON.parse(i.args) : i.args.split(" ").filter((w) => !w.startsWith("--"));
    return words.slice(0, -1);
  });

describe("agent/Dockerfile", () => {
  it("builds on node:24-slim, optionally pinned by digest", () => {
    expect(all("FROM").map((i) => i.args)).toEqual([expect.stringMatching(/^node:24-slim(@sha256:[0-9a-f]{64})?$/)]);
  });

  it("runs under tini from the Debian package", () => {
    expect(all("RUN").some((i) => /apt-get install\b.*\btini\b/.test(i.args))).toBe(true);
    expect(all("ENTRYPOINT").map((i) => JSON.parse(i.args))).toEqual([["/usr/bin/tini", "--"]]);
  });

  it("switches to the node user before CMD and stays there", () => {
    const users = docker.flatMap((i, n) => (i.op === "USER" ? [{ n, who: i.args }] : []));
    expect(users.at(-1)?.who).toBe("node");
    expect(users.at(-1)?.n).toBeLessThan(docker.findIndex((i) => i.op === "CMD"));
  });

  it("keeps state in a /data volume that the node user owns", () => {
    expect(all("ENV").flatMap((i) => i.args.split(" "))).toContain("MAAT_DATA_DIR=/data");
    expect(all("VOLUME").map((i) => i.args)).toEqual(["/data"]);
    expect(all("RUN").some((i) => /\bchown node:node \/data\b/.test(i.args))).toBe(true);
  });

  it("installs the locked production dependencies, and tsx is one of them", () => {
    expect(all("RUN").some((i) => /\bnpm ci --omit=dev\b/.test(i.args))).toBe(true);
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.dependencies.tsx).toBeDefined();
    expect(pkg.devDependencies.tsx).toBeUndefined();
    const lock = JSON.parse(read("package-lock.json"));
    expect(lock.packages[""].dependencies.tsx).toBe(pkg.dependencies.tsx);
    expect(lock.packages["node_modules/tsx"].dev).toBeUndefined();
  });

  it("starts the agent loop with node and tsx, not through npm", () => {
    expect(all("CMD").map((i) => JSON.parse(i.args))).toEqual([["node", "--import", "tsx", "src/main.ts"]]);
  });

  it("bakes no secret into the image", () => {
    // An allowlist, not a list of secret names: BASE_RPC_URL names no secret but can carry a provider key.
    expect(all("ARG")).toEqual([]);
    expect(all("ENV").map((i) => i.args)).toEqual(["MAAT_DATA_DIR=/data"]);
  });

  it("copies only the runtime files and the heartbeat check, and never .env", () => {
    expect(copySources.filter((s) => /(^|\/)\.env/.test(s))).toEqual([]);
    expect([...copySources].sort()).toEqual(["package-lock.json", "package.json", "scripts/heartbeat.ts", "src", "tsconfig.json"]);
  });
});

/**
 * Whether agent/.dockerignore leaves `path` (relative to agent/) out of the build context: the last line that matches
 * it, or a folder above it, wins, and a line that starts with `!` lets it back in. `*` stays inside one path segment.
 */
function leftOut(path: string): boolean {
  let out = false;
  for (const line of ignored) {
    const keep = line.startsWith("!");
    const glob = (keep ? line.slice(1) : line).replace(/^\/+|\/+$/g, "");
    const parts = glob.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"));
    if (new RegExp(`^${parts.join("[^/]*")}(/.*)?$`).test(path)) out = !keep;
  }
  return out;
}

describe("agent/.dockerignore", () => {
  it("keeps secrets, local state and installed modules out of the build context", () => {
    expect(ignored).toEqual(expect.arrayContaining([".env", ".env.*", "data*", "node_modules"]));
    // data-dryrun: the soak's folder in the Windows runbook.
    for (const p of [".env", ".env.local", "data/agent.lock", "data-dryrun/journal.jsonl", "node_modules/tsx/package.json"]) {
      expect(leftOut(p), p).toBe(true);
    }
  });

  it("keeps the lockfile that npm ci installs from", () => {
    expect(ignored.filter((p) => /json|lock/.test(p))).toEqual([]);
  });

  it("keeps every file the Dockerfile copies in the build context, and no other script", () => {
    expect(copySources.filter(leftOut)).toEqual([]);
    expect(leftOut("scripts/cdp-setup.ts")).toBe(true);
  });
});

describe("Run in a container, in agent/README.md", () => {
  const readme = read("README.md");
  const start = readme.indexOf("\n## Run in a container\n");
  const section = readme.slice(start, readme.indexOf("\n## ", start + 1));
  const toml = /```toml\n([\s\S]*?)```/.exec(section)?.[1] ?? "";
  const flyEnv = [.../\[env\]\n((?:[ \t]+.*\n)+)/.exec(toml)?.[1]?.matchAll(/^\s+([A-Z0-9_]+) = /gm) ?? []].map((m) => m[1]!);
  const settings = Object.keys(parseEnv(read(".env.example")));
  // The keys and URLs: BASE_RPC_URL and its fallback name no secret but can carry a provider key.
  const secrets = ["ANTHROPIC_API_KEY", "CDP_API_KEY_ID", "CDP_API_KEY_SECRET", "CDP_WALLET_SECRET", "BASE_RPC_URL", "BASE_RPC_URL_FALLBACK"];

  it("is found", () => {
    expect(start).toBeGreaterThan(0);
    expect(flyEnv.length).toBeGreaterThan(0);
  });

  it("names every setting of .env.example", () => {
    expect(settings.filter((k) => !new RegExp(`\\b${k}\\b`).test(section))).toEqual([]);
  });

  it("passes every secret at run time, and fly.toml holds none of them and no unknown setting", () => {
    const flySecrets = /^fly secrets set (.*)$/m.exec(section)?.[1] ?? "";
    expect(secrets.filter((k) => !flySecrets.split(" ").some((w) => w.startsWith(`${k}=`)))).toEqual([]);
    expect(flyEnv.filter((k) => secrets.includes(k) || k === "MAAT_DATA_DIR")).toEqual([]);
    expect(flyEnv.filter((k) => !settings.includes(k) && k !== "TINI_SUBREAPER")).toEqual([]);
  });

  it("mounts deployments/README.md where the agent in the image reads the MaatInbox row from", () => {
    const workdir = all("WORKDIR").at(-1)?.args ?? "";
    const inImage = posix.resolve(workdir, relative(AGENT_DIR, DEPLOYMENTS_FILE).split(sep).join("/"));
    // The loop's docker run and the one-off --once run.
    expect(section.split(`/deployments/README.md:${inImage}:ro`).length - 1).toBe(2);
  });

  it("checks the agent's health with the heartbeat script that the image holds", () => {
    expect(section).toContain("node --import tsx scripts/heartbeat.ts");
    expect(copySources).toContain("scripts/heartbeat.ts");
  });
});
