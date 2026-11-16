import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// No Docker on the dev machine: the image is built remotely, so these text checks are what guards it before a build.
const read = (file: string) => readFileSync(join(import.meta.dirname, "..", file), "utf8");

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
    const leaks = docker.filter((i) => (i.op === "ARG" || i.op === "ENV") && /KEY|SECRET|TOKEN|ANTHROPIC/i.test(i.args));
    expect(leaks).toEqual([]);
  });

  it("copies only the runtime files, and never .env", () => {
    expect(copySources.filter((s) => /(^|\/)\.env/.test(s))).toEqual([]);
    expect([...copySources].sort()).toEqual(["package-lock.json", "package.json", "src", "tsconfig.json"]);
  });
});

describe("agent/.dockerignore", () => {
  it("keeps secrets, local state and installed modules out of the build context", () => {
    expect(ignored).toEqual(expect.arrayContaining([".env", ".env.*", "data", "node_modules"]));
  });

  it("keeps the lockfile that npm ci installs from", () => {
    expect(ignored.filter((p) => /json|lock/.test(p))).toEqual([]);
  });
});
