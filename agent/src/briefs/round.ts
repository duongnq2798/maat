import type { Address, Hex } from "viem";
import type { Journal } from "../ledger/journal.js";
import type { Store } from "../ledger/store.js";
import type { BriefProposal, ProposerOutput } from "../llm/proposer.js";
import { clean, sanitize } from "../rationale/sanitize.js";
import { oneLine } from "../redact.js";
import { MAX_BRIEFS_PER_INTENT, MAX_REPLY_CHARS, planBriefs } from "./caps.js";
import { briefKey, readBriefLogs, safeBlock, type Brief, type BriefClient } from "./inbox.js";

/** The MaatInbox deployments/README.md records, and the client its Brief logs are read with. */
export interface BriefSource {
  inbox: Address;
  /** The deploy transaction: its block is where the first read starts. */
  deployTx: Hex;
  client: BriefClient;
}

/** The briefs of one round (docs/superpowers/specs/2026-11-25-maat-inbox-design.md §3). */
export interface BriefRound {
  /** Sent to Claude this round, in id order: at most 3, each within the day and sender caps and the brief budget. */
  readonly send: readonly Brief[];
  /**
   * Journals what became of each brief sent: replied, or unanswered with why. `adopted` holds the ids an intent cited
   * and took to the vault (a send, or a dry-run's preview); an id an intent cited but that stopped short is not in it.
   */
  answer(out: ProposerOutput, adopted: ReadonlySet<number>): Promise<void>;
}

type Deps = { source: BriefSource; store: Store; journal: Pick<Journal, "append" | "briefOutcome">; runId: string; day: bigint; llmCapped: boolean };

/** A row of journal kind "brief": the brief's identity, never its text. */
const rowOf = (runId: string, b: Omit<Brief, "text">) =>
  ({ kind: "brief", runId, briefId: b.id, from: b.from, txHash: b.txHash, logIndex: b.logIndex, block: b.block }) as const;

/**
 * Reads this round's briefs and decides which reach Claude. First a brief Claude was answering when the agent last
 * stopped is journaled as unanswered, unless the journal already holds its row (the agent stopped after writing it,
 * before state.json was saved). Then the Brief logs from where the last read stopped (the deploy block on the first
 * read) up to the safe block: a decided brief whose log the read no longer finds is forgotten, and each new one meets
 * planBriefs. A skipped brief is journaled with its cap; a sent one is stored as started before Claude is called, so
 * a restart never sends it twice. A failed read is journaled and the round goes on without briefs.
 */
export async function openBriefRound(d: Deps): Promise<BriefRound> {
  const { store, journal, runId, day } = d;
  for (const r of store.briefsDone().filter((x) => x.outcome === "started")) {
    const b = { id: r.id, from: r.from as Address, txHash: r.txHash as Hex, logIndex: r.logIndex, block: BigInt(r.block) };
    const journaled = await journal.briefOutcome(r.key);
    if (journaled === null) await journal.append({ ...rowOf(runId, b), outcome: "unanswered", note: "the agent stopped before Claude's answer was journaled" });
    store.recordBrief(b, journaled ?? "unanswered");
  }

  let from: bigint;
  let safe: bigint;
  let logs: Brief[];
  try {
    safe = await safeBlock(d.source.client);
    from = store.briefFrom() ?? (await deployBlock(d.source));
    logs = from > safe ? [] : await readBriefLogs(d.source.client, d.source.inbox, from, safe);
  } catch (e) {
    await journal.append({ kind: "error", runId, message: `briefs not read: ${oneLine(e)}` });
    await store.save();
    return { send: [], answer: async () => {} };
  }

  const present = new Set(logs.map(briefKey));
  for (const r of store.briefsDone()) {
    const block = BigInt(r.block);
    if (block >= from && block <= safe && !present.has(r.key)) store.forgetBrief(r.key);
  }
  const fresh = logs.filter((b) => store.briefOutcome(briefKey(b)) === undefined);
  const plan = planBriefs(fresh, store.briefDay(day), { llmCapped: d.llmCapped });
  for (const { brief, cap } of plan.skip) {
    await journal.append({ ...rowOf(runId, brief), outcome: "skipped", cap });
    store.recordBrief(brief, "skipped");
  }
  for (const b of plan.send) {
    store.recordBrief(b, "started");
    store.recordBriefSent(day, b.from);
  }
  // The next read starts at the first brief left waiting, else past the safe block; never before this read's start.
  const next = plan.wait[0]?.block ?? safe + 1n;
  store.setBriefFrom(next > from ? next : from);
  await store.save();

  return {
    send: plan.send,
    answer: async (out, adopted) => {
      for (const b of plan.send) {
        const reply = out.ok ? out.replies?.find((r) => r.id === b.id && clean(r.text) !== "") : undefined;
        const why = out.ok ? "Claude gave no reply" : `no answer: ${out.error}`;
        await journal.append({
          ...rowOf(runId, b),
          outcome: reply ? "replied" : "unanswered",
          ...(reply ? { reply: sanitize(reply.text, MAX_REPLY_CHARS) } : { note: why }),
          ...(adopted.has(b.id) ? { adopted: true } : {}),
        });
        store.recordBrief(b, reply ? "replied" : "unanswered");
      }
      await store.save();
    },
  };
}

/** The block the inbox was deployed in, from its deploy transaction. */
async function deployBlock(s: BriefSource): Promise<bigint> {
  const tx = await s.client.getTransaction({ hash: s.deployTx });
  if (tx.blockNumber === null) throw new Error(`MaatInbox deploy tx ${s.deployTx} is not mined`);
  return tx.blockNumber;
}

/**
 * The brief ids `p` adopts, ascending and without repeats, or why the intent alone is dropped: more than
 * MAX_BRIEFS_PER_INTENT ids, an id this round did not send to Claude, or one an earlier intent of the same answer
 * adopted (`cited`, which this adds to). An intent of Claude's own adopts none.
 */
export function adoption(p: BriefProposal, sent: ReadonlySet<number>, cited: Set<number>): { q?: number[]; error?: string } {
  if (!p.briefs || p.briefs.length === 0) return {};
  const q = [...new Set(p.briefs)].sort((a, b) => a - b);
  if (q.length > MAX_BRIEFS_PER_INTENT) return { error: `adopts ${q.length} briefs, more than the ${MAX_BRIEFS_PER_INTENT} an intent may` };
  const unsent = q.find((id) => !sent.has(id));
  if (unsent !== undefined) return { error: `adopts brief ${unsent}, which this round did not send to Claude` };
  const again = q.find((id) => cited.has(id));
  if (again !== undefined) return { error: `adopts brief ${again}, which an earlier intent of this answer adopted` };
  for (const id of q) cited.add(id);
  return { q };
}
