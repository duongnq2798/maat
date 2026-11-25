"use client";

import { useEffect, useState, type ReactNode } from "react";
import { HIDDEN_BRIEFS } from "@/content/ask-hidden";
import { PROOF_BOUNTY } from "@/content/proof-bounty";
import { PROOF_SENDS } from "@/content/proof-sends";
import { PROOF_STOPS } from "@/content/proof-stops";
import { PROOF_TEAM } from "@/content/proof-team";
import { browserStorage } from "@/lib/chain/cache";
import type { InboxDeployment } from "@/lib/chain/inbox";
import { errorText } from "@/lib/chain/load";
import { createLedgerClient } from "@/lib/chain/rpc";
import { fetchSnapshotJson } from "@/lib/chain/snapshot";
import { fetchProofConfig, type ProofConfig } from "./config";
import { countBriefs, formatCount, type ProofLists } from "./count";
import { readProof, type ProofClient, type ProofRead } from "./load";
import { ProofCounts } from "./ProofCounts";
import { RuleText } from "./RuleText";
import { RULE_SPEC } from "./rule";
import { DECISION_NOTE, TEAM_SET_NOTE, type TeamTrace } from "./team";

const REPO = "https://github.com/duongnq2798/maat";
const LISTS: ProofLists = { team: PROOF_TEAM, hidden: HIDDEN_BRIEFS, bounty: PROOF_BOUNTY, sends: PROOF_SENDS, stops: PROOF_STOPS };

export interface ProofDeps {
  client?: ProofClient;
  fetchConfig?: () => Promise<ProofConfig>;
  lists?: ProofLists;
  /** The committed snapshot of the vault's logs, as /data/decisions-snapshot.json serves it. */
  fetchSnapshot?: () => Promise<unknown>;
  /** Where the ledger keeps its cache of the vault's logs (default: this browser's localStorage). */
  storage?: Storage | null;
}

/** Where the trace took the vault's logs from, when it did not read them all from Base. */
function seedText(seed: NonNullable<TeamTrace["seed"]>): string {
  const to = formatCount(Number(seed.to));
  return seed.source === "snapshot" && seed.anchor !== null
    ? `The vault's logs to block ${to} are from the committed snapshot of block ${formatCount(Number(seed.anchor))}: Base gave that block the same hash, and each log's transaction receipt holds it. The rest were read from Base.`
    : `The vault's logs to block ${to} are from this browser's ledger cache, and each log's transaction receipt on Base holds it. The rest were read from Base.`;
}

function Section({ id, title, lead, children }: { id: string; title: string; lead: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-5">
      <div className="flex max-w-[720px] flex-col gap-2">
        <h2 id={id} className="m-0 text-[24px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          {title}
        </h2>
        <p className="m-0 text-[15px] leading-relaxed text-ink-body">{lead}</p>
      </div>
      {children}
    </section>
  );
}

type Read = { state: "reading" } | { state: "read"; proof: ProofRead } | { state: "error"; message: string };

/**
 * The counts of a recorded inbox, read from its Brief logs and the team trace in the browser; nothing is shown that
 * was not read, and an incomplete read shows no brief number.
 */
function RecordedCounts({
  inbox,
  deployments,
  client,
  lists,
  fetchSnapshot,
  storage,
}: {
  inbox: InboxDeployment;
  deployments: ProofConfig["deployments"];
  client: ProofClient;
  lists: ProofLists;
  fetchSnapshot: () => Promise<unknown>;
  storage: Storage | null;
}) {
  const [read, setRead] = useState<Read>({ state: "reading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setRead({ state: "reading" });
    // The snapshot is fetched while the head and the Brief logs are read; the trace waits for it only at the vault.
    readProof(client, { inbox, deployments }, lists, controller.signal, { snapshot: fetchSnapshot(), storage })
      .then((proof) => setRead({ state: "read", proof }))
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setRead({ state: "error", message: errorText(e) });
      });
    return () => controller.abort();
  }, [client, inbox, deployments, lists, fetchSnapshot, storage, attempt]);

  const again = (
    <button type="button" onClick={() => setAttempt((n) => n + 1)} className="pill-line cursor-pointer bg-white">
      Read again
    </button>
  );
  if (read.state !== "read") {
    return (
      <div data-proof-state={read.state} className="flex flex-col gap-5">
        {read.state === "reading" ? (
          <p className="m-0 text-[15px] text-ink-2">Reading briefs from Base…</p>
        ) : (
          <p className="m-0 flex flex-wrap items-center gap-3 text-[15px] text-refuse">
            The briefs could not be read: {read.message} {again}
          </p>
        )}
        <ProofCounts count={null} verified={null} state="reading" />
      </div>
    );
  }
  const { proof } = read;
  return (
    <div data-proof-state={proof.complete ? "read" : "incomplete"} className="flex flex-col gap-5">
      {proof.complete ? (
        <p className="m-0 text-[15px] text-ink-2">
          Counted to block {formatCount(Number(proof.head))} of Base mainnet, from the Brief logs of MaatInbox{" "}
          <code className="font-mono text-[0.9em] [overflow-wrap:anywhere]">{inbox.inbox.toLowerCase()}</code>.
        </p>
      ) : (
        <div className="flex flex-col gap-2 text-[15px] text-refuse">
          <p className="m-0 flex flex-wrap items-center gap-3">The count is incomplete, so no brief line has a number. {again}</p>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
            {proof.problems.map((p) => (
              <li key={p} className="[overflow-wrap:anywhere]">
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}
      {proof.team.seed ? <p className="m-0 max-w-[720px] text-[13px] leading-normal text-ink-2">{seedText(proof.team.seed)}</p> : null}
      {proof.verifiedError ? (
        <p className="m-0 flex flex-wrap items-center gap-3 text-[15px] text-refuse">
          The Verified Account column could not be read: {proof.verifiedError} {again}
        </p>
      ) : null}
      <ProofCounts count={proof.count} verified={proof.verified} state={proof.complete ? "counted" : "incomplete"} team={proof.team} />
    </div>
  );
}

/** Before deployments/README.md records the inbox: no brief exists to count, so every brief line says not deployed. */
function NotRecorded({ lists }: { lists: ProofLists }) {
  return (
    <div data-proof-state="not-recorded" className="flex flex-col gap-5">
      <div className="card flex flex-col gap-2 p-5 sm:p-6">
        <p className="m-0 text-[17px] font-semibold text-ink">Counting starts when the inbox is recorded.</p>
        <p className="m-0 text-[15px] leading-relaxed text-ink-body">
          MaatInbox is not deployed on Base yet, or its address is not recorded in deployments/README.md. Until it is, there
          is no brief to count, and every brief line below says not deployed.
        </p>
      </div>
      <ProofCounts count={countBriefs([], lists)} verified={new Map()} state="not-deployed" />
    </div>
  );
}

/**
 * /proof: the counting rule of inbox spec §5, word for word, and the brief lines it gives, counted in the browser
 * from MaatInbox's Brief logs. `initial` is the build's deployments table; the page then reads /data/deployments.json
 * and keeps `initial` when that read fails.
 */
export function ProofApp({ initial, deps = {} }: { initial: ProofConfig; deps?: ProofDeps }) {
  const [config, setConfig] = useState(initial);
  // createLedgerClient builds a viem PublicClient, which has request as well.
  const [client] = useState<ProofClient>(() => deps.client ?? (createLedgerClient() as ProofClient));
  const [fetchConfig] = useState(() => deps.fetchConfig ?? (() => fetchProofConfig()));
  const [fetchSnapshot] = useState(() => deps.fetchSnapshot ?? (() => fetchSnapshotJson()));
  const [storage] = useState(() => (deps.storage === undefined ? browserStorage() : deps.storage));
  const lists = deps.lists ?? LISTS;

  useEffect(() => {
    let live = true;
    fetchConfig()
      .then((c) => live && setConfig(c))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [fetchConfig]);

  return (
    <div className="wrap flex flex-col gap-14 py-12 md:py-20">
      <header className="flex max-w-[820px] flex-col gap-4">
        <span className="eyebrow">Base mainnet</span>
        <h1 className="h2">Proof</h1>
        <p className="lead">
          How many wallets outside the team have briefed Maat&apos;s agent, counted from the MaatInbox contract&apos;s public
          logs by a rule published before /ask opens. A script in the repository rebuilds every number from Base logs, with
          no dependency.
        </p>
      </header>

      <Section
        id="counts-title"
        title="The counts"
        lead="Each line is kept apart and never added to another. The team's own briefs are on their own line, a brief the owner hid from the /ask feed still counts, and bounty claimants are listed apart."
      >
        <div data-proof-notes className="flex max-w-[720px] flex-col gap-2 text-[13px] leading-normal text-ink-2">
          <p className="m-0">{TEAM_SET_NOTE}</p>
          <p className="m-0">{DECISION_NOTE}</p>
        </div>
        {config.inbox ? (
          <RecordedCounts
            inbox={config.inbox}
            deployments={config.deployments}
            client={client}
            lists={lists}
            fetchSnapshot={fetchSnapshot}
            storage={storage}
          />
        ) : (
          <NotRecorded lists={lists} />
        )}
      </Section>

      <Section
        id="recount-title"
        title="Recount it yourself"
        lead="The script reads the deployments table from deployments/README.md and the five lists from web/content/, then every Brief log, the team trace and the Verified Accounts from a keyless Base RPC. It has no dependency, runs the team trace this page runs, and prints the lines above in the same words."
      >
        <pre className="card m-0 overflow-x-auto p-5 font-mono text-[13px] leading-relaxed text-ink">
          <code>{`git clone ${REPO}\ncd maat\n`}</code>
          <code>node scripts/recount.mjs</code>
        </pre>
        <p className="m-0 max-w-[720px] text-[15px] leading-relaxed text-ink-body">
          It runs on Node.js 24. <code className="font-mono text-[0.9em]">--rpc &lt;url&gt;</code> reads another RPC, and{" "}
          <code className="font-mono text-[0.9em]">--to-block &lt;n&gt;</code> stops at the block this page says it counted to.
          It reads every vault log from the vault&apos;s deploy block, while this page may take the older ones from the
          committed snapshot, or from this browser&apos;s ledger cache, once Base confirms each one;{" "}
          <code className="font-mono text-[0.9em]">--snapshot</code> makes the script take them from the snapshot the same
          way, and say so.
        </p>
      </Section>

      <Section
        id="rule-title"
        title="The counting rule"
        lead={
          <>
            Section 5 of the{" "}
            <a href={`${REPO}/blob/main/${RULE_SPEC}#5-the-proof-counting-rule`} className="underline underline-offset-2">
              MaatInbox design spec
            </a>
            , word for word. Its § numbers point into that spec, and its §4 into the rationale blob spec it names.
          </>
        }
      >
        <RuleText />
      </Section>
    </div>
  );
}
