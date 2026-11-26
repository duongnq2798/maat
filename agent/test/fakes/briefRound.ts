import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress, pad, size, toHex, type Address } from "viem";
import { builderSuffix } from "../../src/exec/builderCode.js";
import { GuardedSender } from "../../src/exec/sender.js";
import { Journal, type JournalRow } from "../../src/ledger/journal.js";
import { Store } from "../../src/ledger/store.js";
import type { BriefProposal, Proposer, ProposerInput, ProposerOutput } from "../../src/llm/proposer.js";
import { runOnce, type RunDeps } from "../../src/loop/runOnce.js";
import type { OnchainIntent } from "../../src/types.js";
import { EXECUTOR, VAULT, standardScene } from "./fakeChain.js";
import { FakeInbox, INBOX, INBOX_DEPLOY_TX } from "./fakeInbox.js";
import { FakeReceipts } from "./fakeReceipts.js";
import { FakeSender } from "./fakeSender.js";

export const SUFFIX = builderSuffix("bc_maattest");
export const COMMIT = "0123456789abcdef0123456789abcdef01234567";
export const MODEL = "claude-sonnet-5-5";
/** The UTC day of standardScene's state block. */
export const DAY = 1_794_000_000n / 86_400n;

/** Sender `i` of many: distinct checksummed addresses, for caps that count senders. */
export const sender = (i: number): Address => getAddress(pad(toHex(0xa000 + i), { size: 20 }));

type Ok = Extract<ProposerOutput, { ok: true }>;
/** A successful answer: no intents and no replies unless given. */
export const ok = (o: Partial<Ok> = {}): Ok => ({ ok: true, summary: "hold", proposals: [], costUsd6: 1_000n, model: MODEL, ...o });
/** Replies to every brief it was sent, and adopts none. */
export const replyAll = (i: ProposerInput): ProposerOutput => ok({ replies: (i.briefs ?? []).map((b) => ({ id: b.id, text: `Noted brief ${b.id}; the policy holds.` })) });
/** Adopts every brief it was sent into its own 5 USD NVDAc buy, and replies to each. */
export const adoptAll = (i: ProposerInput): ProposerOutput =>
  ok({
    proposals: (i.briefs ?? []).map((b): BriefProposal => ({ action: "BUY", symbol: "NVDAc", amountUsd: 5, rationale: `brief ${b.id} fits`, briefs: [b.id] })),
    replies: (i.briefs ?? []).map((b) => ({ id: b.id, text: `Adopted brief ${b.id}.` })),
  });

/** A fake Claude: answers each round with `answer`, and keeps what each round sent it. */
export class BriefModel implements Proposer {
  inputs: ProposerInput[] = [];
  constructor(public answer: (i: ProposerInput) => ProposerOutput | Promise<ProposerOutput> = replyAll) {}
  async propose(i: ProposerInput): Promise<ProposerOutput> {
    this.inputs.push(i);
    return this.answer(i);
  }
  /** The brief ids each call carried. */
  seen(): number[][] {
    return this.inputs.map((i) => (i.briefs ?? []).map((b) => b.id));
  }
}

/** The vault's mandate as far as these tests need it: the allowlisted basket and the $50 per-trade cap (MaatConfig.sol). */
export const mandate = (i: OnchainIntent): number => (i.action === 0 && i.amount > 50_000_000n ? 11 : 0);

export interface BriefRig {
  dir: string;
  deps: RunDeps;
  inbox: FakeInbox;
  model: BriefModel;
  inner: FakeSender;
  receipts: FakeReceipts;
  store: Store;
  journal: Journal;
  /** Runs round `n` (runId run-n). */
  round(n: number): ReturnType<typeof runOnce>;
  briefRows(): Promise<Extract<JournalRow, { kind: "brief" }>[]>;
}

/** A round with a recorded MaatInbox: briefs read from `inbox`, answered by `model`; live unless `mode` says dry-run. */
export async function briefRig(
  o: {
    mode?: "dry-run" | "live";
    inbox?: FakeInbox;
    model?: BriefModel;
    /** Answers in place of `model`: a ClaudeProposer over a fake create, say. */
    proposer?: Proposer;
    dir?: string;
    maxTxPerDay?: number;
    maxLlmUsd6PerDay?: bigint;
    preview?: (i: OnchainIntent) => number;
    briefs?: boolean;
  } = {},
): Promise<BriefRig> {
  const dir = o.dir ?? (await mkdtemp(join(tmpdir(), "maat-briefs-")));
  const store = await Store.open(dir);
  const journal = new Journal(dir, { commit: COMMIT });
  const inner = new FakeSender(EXECUTOR);
  const receipts = new FakeReceipts(inner, VAULT, size(SUFFIX));
  const preview = o.preview ?? mandate;
  receipts.verdict = (i) => ({ allowed: preview(i) === 0, reason: preview(i) });
  const inbox = o.inbox ?? new FakeInbox();
  const model = o.model ?? new BriefModel();
  const mode = o.mode ?? "live";
  const deps: RunDeps = {
    vault: VAULT,
    executor: EXECUTOR,
    expensePayee: "0x3333333333333333333333333333333333333333",
    mode,
    defaultDailyComputeUsd6: 500_000n,
    maxTxPerDay: o.maxTxPerDay ?? 40,
    // No compute bill: these rounds test briefs, and a bill would add its own intent.
    billMinUsd6: 10n ** 12n,
    maxLlmUsd6PerDay: o.maxLlmUsd6PerDay ?? 750_000n,
    stateClient: standardScene().client(),
    previewClient: { readContract: (async (p: { args: readonly [OnchainIntent] }) => preview(p.args[0])) as never },
    txClient: receipts.client(),
    proposer: o.proposer ?? model,
    sender: mode === "live" ? new GuardedSender(inner, { vault: VAULT, suffix: SUFFIX }) : null,
    store,
    journal,
    commit: COMMIT,
    ...(o.briefs === false ? {} : { briefs: { inbox: INBOX, deployTx: INBOX_DEPLOY_TX, client: inbox.client() } }),
  };
  return {
    dir,
    deps,
    inbox,
    model,
    inner,
    receipts,
    store,
    journal,
    round: (n) => runOnce({ ...deps, runId: `run-${n}` }),
    briefRows: async () => (await journal.read()).filter((r): r is Extract<JournalRow, { kind: "brief" }> => r.kind === "brief"),
  };
}
