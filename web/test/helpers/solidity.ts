import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root: web/test/helpers → ../../../ */
export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export function readRepo(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

export function enumMembers(src: string, name: string): string[] {
  const m = new RegExp(`enum\\s+${name}\\s*\\{([^}]*)\\}`).exec(stripComments(src));
  if (!m?.[1]) throw new Error(`enum ${name} not found`);
  return m[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const UNITS: Record<string, number> = { seconds: 1, minutes: 60, hours: 3600, days: 86_400, weeks: 604_800 };

/** Solidity or TS number literal: "1.5e18", "8 hours", "1 days", "53_551_627n". */
export function solidityNumber(literal: string): number {
  const [num = "", unit, ...rest] = literal.trim().split(/\s+/);
  if (rest.length > 0) throw new Error(`unexpected literal: ${literal}`);
  const n = Number(num.replace(/_/g, "").replace(/n$/, ""));
  if (!Number.isFinite(n)) throw new Error(`not a number literal: ${literal}`);
  if (unit === undefined) return n;
  const k = UNITS[unit];
  if (k === undefined) throw new Error(`unknown unit in ${literal}`);
  return n * k;
}

/** Right-hand side of the first `NAME = value;`. */
export function constantValue(src: string, name: string): string {
  const m = new RegExp(`\\b${name}\\s*=\\s*([^;]+);`).exec(stripComments(src));
  if (!m?.[1]) throw new Error(`constant ${name} not found`);
  return m[1].trim();
}

/** Every `field: value` in struct literals, in source order. */
export function fieldValues(src: string, field: string): string[] {
  return [...stripComments(src).matchAll(new RegExp(`\\b${field}\\s*:\\s*([^,\\n})]+)`, "g"))].map((m) =>
    (m[1] ?? "").trim(),
  );
}

export interface ParsedParam {
  type: string;
  indexed: boolean;
  name: string;
}

export function eventParams(src: string, name: string): ParsedParam[] {
  const m = new RegExp(`event\\s+${name}\\s*\\(([^)]*)\\)`).exec(stripComments(src));
  if (!m?.[1]) throw new Error(`event ${name} not found`);
  return m[1].split(",").map((p) => {
    const parts = p.trim().split(/\s+/);
    return { type: parts[0] ?? "", indexed: parts.includes("indexed"), name: parts[parts.length - 1] ?? "" };
  });
}

export function pragmaVersion(src: string): string {
  const m = /pragma solidity\s+([^;]+);/.exec(src);
  if (!m?.[1]) throw new Error("pragma not found");
  return m[1].trim();
}
