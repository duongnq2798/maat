import { GENESIS, project, rowHash } from "../lib/spec.mjs";

export const COMMIT = "0123456789abcdef0123456789abcdef01234567";

/**
 * Chains rows as the agent does (spec §3.1): each row gets `prev`, the hash of the row before it (GENESIS for the
 * first), and `hash`, keccak256 of its projection without `hash`. Pass `prev` to continue a chain.
 * @param {Record<string, unknown>[]} rows
 * @param {string} [prev]
 */
export function chainRows(rows, prev = GENESIS) {
  return rows.map((r) => {
    const row = { ...r, prev };
    row.hash = rowHash(project(row));
    prev = row.hash;
    return row;
  });
}

/** Journal text as the agent writes it: one JSON object per line, each ending in a line feed. */
export const jsonl = (/** @type {unknown[]} */ rows) => rows.map((r) => `${JSON.stringify(r)}\n`).join("");

/** A live round's run row at `ts`. */
export function liveRun(/** @type {string} */ ts, /** @type {string} */ runId, extra = {}) {
  return { ts, commit: COMMIT, kind: "run", runId, block: "61800000", day: "20782", mode: "live", ok: true, summary: "Held: every weight is inside its band.", costUsd6: "3100", suggestions: 0, proposals: 0, ...extra };
}
