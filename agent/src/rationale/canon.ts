/**
 * Canonical JSON (docs/superpowers/specs/2026-11-25-maat-v1-rationale-blob-design.md §2.2): object keys sorted at
 * every level, undefined keys left out, no whitespace, integers only. The maat:v1 blob and every journal row hash
 * (§3.1) are this serialization. Throws on any value it has no canonical form for, rather than writing something a
 * decoder would read differently.
 */
export function canon(v: unknown): string {
  if (v === null || typeof v === "string" || typeof v === "boolean") return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new Error("integers only");
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (typeof v !== "object") throw new Error(`no canonical form for ${typeof v}`);
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(",")}}`;
}
