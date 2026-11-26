// Beat 7's middle step: Maat's agent's reply to the brief the film shows, from the public agent-journal branch
// (docs/superpowers/specs/2026-11-25-maat-v1-rationale-blob-design.md §3.4). The capture reads the branch only once the
// brief's hash is in film/txs.json, checks its hash chain as the browser verifier does (verifyPublished, from the
// journal publisher), and takes the brief row that names the brief's log. No branch yet, or no row for the brief: the
// card says the reply is not in the journal yet. A branch it cannot read, or one that does not verify, stops the render.

import { verifyPublished } from "../../ops/journal/lib/chain.mjs";

/** The raw files of the agent-journal branch; web/lib/chain/ledger.ts reads the same (JOURNAL_RAW_URL). */
export const JOURNAL_RAW_URL = "https://raw.githubusercontent.com/duongnq2798/maat/agent-journal/journal/";

const DAY_RE = /^\d{4}-\d{2}-\d{2}(?:\.jsonl)?$/;

/**
 * @typedef {{ status: number, ok: boolean, json(): Promise<unknown>, text(): Promise<string> }} JournalResponse
 * @typedef {{ state: "absent" } | { state: "read", files: { name: string, text: string }[] }} Journal
 */

/** A GET with a timeout; GitHub's raw files need no login. */
const get = (/** @type {string} */ url) => fetch(url, { signal: AbortSignal.timeout(20_000) });

/**
 * The published journal: `absent` while GitHub answers 404 for journal/index.json (the branch does not exist yet),
 * otherwise every day file index.json lists, in order, with the chain verified. Throws when GitHub cannot be read, a
 * listed file is missing, or a line does not verify.
 * @param {(url: string) => Promise<JournalResponse>} [fetchImpl]
 * @param {string} [base]
 * @returns {Promise<Journal>}
 */
export async function readJournal(fetchImpl = get, base = JOURNAL_RAW_URL) {
  const index = await fetchImpl(`${base}index.json`);
  if (index.status === 404) return { state: "absent" };
  if (!index.ok) throw new Error(`the published journal: GitHub answered HTTP ${index.status} for journal/index.json`);
  const body = /** @type {{ v?: unknown, days?: unknown }} */ (await index.json());
  if (body?.v !== 1 || !Array.isArray(body.days)) throw new Error("the published journal: journal/index.json does not have the spec's shape (v 1 and a list of days)");
  const files = [];
  for (const day of body.days) {
    if (typeof day !== "string" || !DAY_RE.test(day)) throw new Error(`the published journal: journal/index.json lists ${JSON.stringify(day)}, which is not a day file`);
    const name = day.endsWith(".jsonl") ? day : `${day}.jsonl`;
    const res = await fetchImpl(`${base}${name}`);
    if (!res.ok) throw new Error(`the published journal: GitHub answered HTTP ${res.status} for journal/${name}, which index.json lists`);
    files.push({ name, text: await res.text() });
  }
  try {
    verifyPublished(files);
  } catch (e) {
    throw new Error(`the published journal does not verify: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { state: "read", files };
}

/**
 * Maat's agent's reply to one brief: the first well-formed `brief` row of a read journal that names the brief's log by
 * its id, tx hash and log index, as the /ask feed matches it (web/lib/chain/inbox.ts briefAnswers). A row for the same
 * id in another tx or at another log index is another brief's. The reply text is the agent's sanitized text.
 * @param {Journal} journal
 * @param {{ id: bigint | number, txHash: string, logIndex: number }} brief
 */
export function briefReply(journal, brief) {
  const id = Number(brief.id);
  if (journal.state !== "read") return { kind: "missing", why: "the agent-journal branch has no journal yet" };
  for (const { name, text } of journal.files) {
    for (const [i, line] of text.split("\n").entries()) {
      if (line === "") continue;
      const f = JSON.parse(line);
      if (f.kind !== "brief" || f.briefId !== id || typeof f.txHash !== "string" || f.txHash.toLowerCase() !== brief.txHash.toLowerCase() || f.logIndex !== brief.logIndex) continue;
      const at = { file: `journal/${name}`, line: i + 1, hash: String(f.hash), ...(typeof f.commit === "string" ? { commit: f.commit } : {}) };
      if (f.outcome === "replied" && typeof f.reply === "string") return { kind: "reply", outcome: "replied", text: f.reply, adopted: f.adopted === true, ...at };
      if (f.outcome === "unanswered") return { kind: "reply", outcome: "unanswered", adopted: f.adopted === true, ...at };
      if (f.outcome === "skipped" && typeof f.cap === "string") return { kind: "reply", outcome: "skipped", cap: f.cap, ...at };
    }
  }
  return { kind: "missing", why: `the published journal has no row for brief #${id} yet` };
}
