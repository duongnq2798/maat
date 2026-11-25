// @vitest-environment node
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { dynamic, GET } from "@/app/reasons.json/route";
import {
  GUARD_CHECKLIST,
  type RaiseSite,
  REASON_GROUPS,
  REASON_LABEL,
  REASON_MEANING_DOCS,
  REASON_RAISED_AT,
  REASONS,
  type RefusalCode,
  reasonsFile,
} from "@/content/reasons";
import { repoFileUrl, siteUrl } from "@/lib/site";
import { enumMembers, REPO_ROOT, readRepo } from "./helpers/solidity";

// /reasons.json lists every refusal reason a MandateVault can record in a Decision, for agents and tools that decode one
// without reading the contracts. Each reason names the lines of contracts/src that return it; this file reads those
// sources, so a line that moves, or a new return of a reason, fails here before the file is published.

const text = z.string().min(1).refine((s) => s === s.trim(), "no leading or trailing space");
const site = z.strictObject({
  file: z.string().regex(/^contracts\/src\/[\w/]+\.sol$/),
  line: z.int().positive(),
  function: z.string().regex(/^\w+\.\w+$/),
  url: z.url(),
});
const reason = z.strictObject({
  id: z.int().positive(),
  name: z.string().regex(/^[A-Z][A-Z_]*$/),
  label: text,
  group: z.enum(REASON_GROUPS.map((g) => g.title)),
  meaning: text,
  check: text,
  stops: text,
  raisedAt: z.array(site).min(1),
});
const schema = z.strictObject({
  enum: z.strictObject({ file: z.literal("contracts/src/Types.sol"), name: z.literal("Reason"), url: z.url() }),
  docs: z.strictObject({ refusalCodes: z.url(), checklist: z.url() }),
  ok: z.strictObject({ id: z.literal(0), name: z.literal("OK"), label: text, meaning: text }),
  reasons: z.array(reason).min(1),
});
type Served = z.infer<typeof schema>;

async function served(): Promise<{ res: Response; body: string; json: Served }> {
  const res = GET();
  const body = await res.text();
  return { res, body, json: schema.parse(JSON.parse(body)) };
}

/** Solidity source as lines, with its comments blanked and every line kept where it was. */
function blankComments(src: string): string[] {
  return src
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""));
}

const code = (file: string): string[] => blankComments(readRepo(file));

/** The contract or library a line is in, and the function, as "GuardLib.checkMarket". */
function enclosing(lines: readonly string[], line: number): string {
  const before = lines.slice(0, line);
  const fn = before.findLast((l) => /^\s*function\s+\w+/.test(l))?.match(/function\s+(\w+)/)?.[1];
  const unit = before.findLast((l) => /^\s*(?:abstract\s+)?(?:contract|library)\s+\w+/.test(l))?.match(/(?:contract|library)\s+(\w+)/)?.[1];
  return `${unit}.${fn}`;
}

/** Why a raise site does not hold: its line must return the code (or set the reason to it) inside the function it names. */
function siteProblems(codeName: string, s: RaiseSite): string[] {
  const lines = code(s.file);
  const at = lines[s.line - 1] ?? "";
  const problems: string[] = [];
  if (!new RegExp(`\\bReason\\.${codeName}\\b`).test(at)) problems.push(`${s.file}:${s.line} does not name Reason.${codeName}`);
  else if (!/\breturn\b|\breason\s*=/.test(at)) problems.push(`${s.file}:${s.line} names Reason.${codeName} but does not return it`);
  const fn = enclosing(lines, s.line);
  if (fn !== s.fn) problems.push(`${s.file}:${s.line} is in ${fn}, not ${s.fn}`);
  return problems;
}

/** Every .sol file under contracts/src, as repo paths. */
function sources(dir = join(REPO_ROOT, "contracts/src")): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith(".sol") ? [relative(REPO_ROOT, join(dir, e.name)).split(sep).join("/")] : [],
  );
}

/** Each line of contracts/src that names a refusal code outside a comment, as "file:line CODE". */
function raisesInSource(): string[] {
  return sources().flatMap((file) =>
    code(file).flatMap((l, i) => [...l.matchAll(/\bReason\.([A-Z_]+)\b/g)].flatMap(([, c]) => (c === "OK" ? [] : [`${file}:${i + 1} ${c}`]))),
  );
}

const listed = (): string[] => REASONS.flatMap((c) => REASON_RAISED_AT[c].map((s) => `${s.file}:${s.line} ${c}`));

describe("GET /reasons.json", () => {
  it("serves content/reasons.ts as JSON, exported once at build time", async () => {
    const { res, body, json } = await served();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(json).toEqual(reasonsFile(siteUrl()));
    expect(body).toBe(`${JSON.stringify(reasonsFile(siteUrl()), null, 2)}\n`);
    expect(dynamic).toBe("force-static");
  });

  it("matches its schema", async () => {
    const res = GET();
    expect(schema.safeParse(JSON.parse(await res.text())).error?.issues ?? []).toEqual([]);
  });

  it("lists exactly the refusal reasons of enum Reason in contracts/src/Types.sol, in order, each with its enum id", async () => {
    const { json } = await served();
    const members = enumMembers(readRepo("contracts/src/Types.sol"), "Reason");
    expect([json.ok.name, ...json.reasons.map((r) => r.name)]).toEqual(members);
    expect([json.ok.id, ...json.reasons.map((r) => r.id)]).toEqual(members.map((_, i) => i));
    expect(json.enum.url).toBe(repoFileUrl("contracts/src/Types.sol"));
  });

  it("gives each reason the label, group and meaning the site shows", async () => {
    const { json } = await served();
    const groupOf = (name: string) => REASON_GROUPS.find((g) => (g.codes as readonly string[]).includes(name))?.title;
    expect(json.ok.label).toBe(REASON_LABEL.OK);
    for (const r of json.reasons) {
      const name = r.name as RefusalCode;
      expect({ label: r.label, group: r.group, meaning: r.meaning }, r.name).toEqual({
        label: REASON_LABEL[name],
        group: groupOf(name),
        meaning: REASON_MEANING_DOCS[name],
      });
    }
  });

  it("gives each reason the check and the failure its checklist line names", async () => {
    const { json } = await served();
    expect([...GUARD_CHECKLIST.map((g) => g.code)].sort()).toEqual([...REASONS].sort());
    for (const r of json.reasons) {
      const g = GUARD_CHECKLIST.find((x) => x.code === r.name);
      expect({ check: r.check, stops: r.stops }, r.name).toEqual({ check: g?.check, stops: g?.stops });
    }
  });

  it("links the docs pages that explain the reasons, at the site's URL", async () => {
    const { json } = await served();
    expect(json.docs).toEqual({
      refusalCodes: new URL("/docs/concepts/refusal-codes", siteUrl()).href,
      checklist: new URL("/docs/concepts/agent-checklist", siteUrl()).href,
    });
  });
});

describe("the lines that raise each reason", () => {
  it.each(REASONS.map((c) => [c] as const))("%s: each line named returns it, inside the function named", async (c) => {
    const { json } = await served();
    const sites = REASON_RAISED_AT[c];
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.flatMap((s) => siteProblems(c, s))).toEqual([]);
    expect(json.reasons.find((r) => r.name === c)?.raisedAt).toEqual(
      sites.map((s) => ({ file: s.file, line: s.line, function: s.fn, url: `${repoFileUrl(s.file)}#L${s.line}` })),
    );
  });

  it("are listed GuardLib first, then MandateVault, each in source order", () => {
    const files = ["contracts/src/GuardLib.sol", "contracts/src/MandateVault.sol"];
    for (const c of REASONS) {
      const keys = REASON_RAISED_AT[c].map((s) => [files.indexOf(s.file), s.line] as const);
      expect(keys.every(([f]) => f >= 0), c).toBe(true);
      expect([...keys].sort(([fa, la], [fb, lb]) => fa - fb || la - lb), c).toEqual(keys);
    }
  });

  it("are every line in contracts/src that returns a refusal reason, each named once", () => {
    expect(new Set(listed()).size).toBe(listed().length);
    expect([...listed()].sort()).toEqual([...raisesInSource()].sort());
  });

  it("would catch a line that moved, a reason on the wrong line and the wrong function", () => {
    const vault = "contracts/src/MandateVault.sol";
    const [first] = REASON_RAISED_AT.VAULT_PAUSED;
    if (!first) throw new Error("VAULT_PAUSED has no raise site");
    expect(siteProblems("VAULT_PAUSED", first)).toEqual([]);
    expect(siteProblems("VAULT_PAUSED", { ...first, line: first.line + 1 })).toEqual([
      `${vault}:${first.line + 1} does not name Reason.VAULT_PAUSED`,
    ]);
    expect(siteProblems("SIZE_LIMIT", first)).toEqual([`${vault}:${first.line} does not name Reason.SIZE_LIMIT`]);
    expect(siteProblems("VAULT_PAUSED", { ...first, fn: "MandateVault.execute" })).toEqual([
      `${vault}:${first.line} is in ${first.fn}, not MandateVault.execute`,
    ]);
  });

  it("reads comments as blank and keeps the line numbers, so a reason named only in a comment is not a raise", () => {
    const src = "/// returns Reason.SIZE_LIMIT\n/* Reason.BAD_PRICE\n   Reason.FEED_STALE */ return Reason.OK;\nreturn Reason.CONCENTRATION; // not Reason.SWAP_FAILED\n";
    const lines = blankComments(src);
    expect(lines).toHaveLength(5);
    expect(lines.map((l) => [...l.matchAll(/\bReason\.([A-Z_]+)\b/g)].map((m) => m[1]))).toEqual([[], [], ["OK"], ["CONCENTRATION"], []]);
  });
});
