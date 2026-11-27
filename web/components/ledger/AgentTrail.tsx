import type { ReactNode } from "react";
import { formatInt } from "@/content/format";
import { etLabel, type AnchorState, type BuilderCodeCheck, type DecisionTrail, type SenderLabel } from "@/lib/chain/ledger";
import type { LedgerSnapshot } from "@/lib/chain/load";
import { GENESIS, type BlobV1, type DecodedBlob } from "@/lib/chain/rationale";
import { SITE } from "@/lib/site";

const CHIP = "inline-block rounded-md px-2 py-0.5 font-mono text-[11px] font-semibold";

const LABEL: Record<SenderLabel, { className: string; title: string }> = {
  "owner, by hand": {
    className: "bg-surface-soft text-ink",
    title: "Sent from the vault's owner address, which was then also the executor.",
  },
  agent: {
    className: "bg-accent-tint text-accent",
    title: "Sent by an executor that is not the vault's owner.",
  },
  probe: {
    className: "bg-accent-tint text-accent",
    title: "Its maat:v1 blob marks it as a fixed-time probe (k is probe), so its text is not a Claude proposal.",
  },
  "brief-driven": {
    className: "bg-accent-tint text-accent",
    title: "Its maat:v1 blob names the inbox brief ids (q) the intent adopts.",
  },
};

/** The blob status the page shows beside the sender label (spec §4). */
export function blobStatusText(trail: DecisionTrail): string {
  const blob = trail.call?.blob;
  if (!blob) return "not a direct execute call";
  switch (blob.status) {
    case "none":
      return "no blob";
    case "v1":
      return "maat:v1 blob";
    case "invalid":
      return "invalid maat:v1 blob";
    case "foreign":
      return `${formatInt(blob.bytes)} bytes that are not a blob`;
  }
}

/** The sender label and the blob status, or what is still unknown about them. */
export function SenderLine({ trail, txState }: { trail: DecisionTrail | undefined; txState: LedgerSnapshot["txState"] }) {
  if (!trail) {
    return (
      <p className="flex flex-wrap items-center gap-2">
        <span className={`${CHIP} bg-surface-soft text-ink-2`}>{txState === "checking" ? "Reading the calldata…" : "Calldata not read"}</span>
      </p>
    );
  }
  const label = trail.label ? LABEL[trail.label] : null;
  const unlabeled = trail.call
    ? { text: "sender unknown", title: "The vault's owner could not be read, so the sender cannot be labeled." }
    : { text: "sender not labeled", title: "This transaction is not a direct execute call to the vault, so its sender need not be the executor and is not labeled." };
  return (
    <p className="flex flex-wrap items-center gap-2">
      <span title={label?.title ?? unlabeled.title} className={`${CHIP} ${label?.className ?? "bg-surface-soft text-ink-2"}`}>
        {trail.label ?? unlabeled.text}
      </span>
      <span className={`${CHIP} border border-line text-ink-2`}>{blobStatusText(trail)}</span>
    </p>
  );
}

function codeList(codes: readonly string[]): string {
  return codes.map((c) => (c === "" ? "(empty)" : c)).join(", ");
}

/** The Builder Code of the calldata's ERC-8021 suffix, checked against the code on the vault's first Decision. */
export function BuilderCodeLine({ check }: { check: BuilderCodeCheck }) {
  if (check.state === "none") {
    return <p className="font-mono text-[12px] text-refuse">No Builder Code: the calldata ends with no ERC-8021 suffix.</p>;
  }
  const codes = <span className="break-all text-ink">{codeList(check.codes)}</span>;
  switch (check.state) {
    case "reference":
      return (
        <p className="font-mono text-[12px] text-ink-2" title="The owner sent the vault's first Decision by hand; every later Decision is checked against its code.">
          Builder Code {codes}: the vault&apos;s first Decision, the code the others are checked against
        </p>
      );
    case "match":
      return (
        <p className="font-mono text-[12px] text-ink-2" title="The ERC-8021 suffix of this transaction carries the code of the vault's first Decision, which the owner sent by hand.">
          <span className="text-accent">✓</span> Builder Code {codes}, the code on the vault&apos;s first Decision
        </p>
      );
    case "differs":
      return (
        <p className="font-mono text-[12px] text-refuse">
          ✗ Builder Code {codes}, not <span className="break-all">{check.reference}</span>, the code on the vault&apos;s first Decision
        </p>
      );
    case "no-reference":
      return (
        <p className="font-mono text-[12px] text-ink-2" title="Checked once the vault's first Decision has been read, when the owner sent it.">
          Builder Code {codes}
        </p>
      );
  }
}

const ANCHOR: Record<AnchorState, string> = {
  anchored: "found in the published journal",
  pending: "not in the published journal yet",
  broken: "does not match the published journal",
};

/**
 * What the page knows about the journal when it checks a blob's anchor. "chain-broken": no row that verified names the
 * transaction, and the chain breaks, so a row after the break may name it but cannot be trusted.
 */
export type AnchorView = AnchorState | "checking" | "absent" | "unreadable" | "chain-broken";

const ANCHOR_VIEW: Record<Exclude<AnchorView, AnchorState>, string> = {
  checking: "checking the journal…",
  absent: "no journal published yet",
  unreadable: "the journal could not be read",
  "chain-broken": "not checked: the published journal's chain is broken",
};

/** A dt/dd pair. Words wrap whole, so "journal" never splits on a phone; a hash breaks anywhere, in its own span. */
function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap gap-x-2">
      <dt className="text-ink-2">{term}</dt>
      <dd className="m-0 min-w-0 break-words text-ink">{children}</dd>
    </div>
  );
}

const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-4)}`;

function premium(bps: number | null): string {
  if (bps === null) return "premium unavailable";
  return `premium ${bps > 0 ? "+" : ""}${bps} bps`;
}

/** One dt/dd pair of the blob's fields: each source on its own line, so the Decisions list holds no nested list. */
function Sources({ s }: { s: BlobV1["s"] }) {
  if (s.length === 0) return <Fact term="Sources">none recorded</Fact>;
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-ink-2">Sources at that block: Chainlink round, its time, pool premium over the feed</dt>
      <dd className="m-0">
        <div role="group" aria-label="Sources" className="flex flex-col gap-1">
          {s.map((x, i) => (
            <span key={`${x.sym}-${i}`} data-source className="flex min-w-0 flex-wrap gap-x-3 text-ink">
              <span className="font-semibold">{x.sym}</span>
              <span className="break-all">round {x.roundId ?? "unavailable"}</span>
              <span>{x.updatedAt === null ? "updated unavailable" : `updated ${etLabel(x.updatedAt)} ET`}</span>
              <span>{premium(x.premiumBps)}</span>
            </span>
          ))}
        </div>
      </dd>
    </div>
  );
}

/**
 * An agent commit in a form `COMMIT_RE` accepts (spec §2.1): a link for a clean HEAD. A `-dirty` or `unknown` value is
 * shown as it is, with no link, since it does not pin the code that ran.
 */
export function CommitRef({ commit }: { commit: string }) {
  if (commit === "unknown") return <span title="git could not tell which commit the agent ran, so this does not pin its code.">unknown</span>;
  const sha = commit.slice(0, 40);
  if (commit.endsWith("-dirty")) {
    return <span title={`${commit}: tracked files under agent/ differed from this commit, so it does not pin the code that ran.`}>{`${sha.slice(0, 7)}-dirty`}</span>;
  }
  return (
    <a href={`${SITE.repoUrl}/commit/${sha}`} aria-label={`Agent commit ${sha.slice(0, 7)} on GitHub`}>
      {sha.slice(0, 7)}
      <span aria-hidden="true"> ↗</span>
    </a>
  );
}

/** The decoded maat:v1 blob of a Decision: the tick, Claude's words and where they came from. */
export function BlobView({ blob, hashOk, anchor }: { blob: Extract<DecodedBlob, { status: "v1" }>; hashOk: boolean; anchor: AnchorView }) {
  const f = blob.fields;
  const anchorText = anchor in ANCHOR ? ANCHOR[anchor as AnchorState] : ANCHOR_VIEW[anchor as Exclude<AnchorView, AnchorState>];
  return (
    <div className="flex flex-col gap-2">
      <span
        title={
          hashOk
            ? "Your browser hashed the blob in this transaction's input: keccak256 equals the rationaleHash the vault recorded."
            : "keccak256 of the blob in this transaction's input is not the rationaleHash the vault recorded, so its text is not shown."
        }
        className={`self-start rounded-md px-2 py-0.5 font-mono text-[11px] font-semibold ${hashOk ? "bg-accent-tint text-accent" : "bg-refuse-tint text-refuse"}`}
      >
        {hashOk ? "Hash verified" : "Hash mismatch"}
      </span>
      {hashOk ? <blockquote className="border-l-2 border-line pl-3 text-sm text-ink-body">{f.t}</blockquote> : null}
      {hashOk ? (
        <dl data-blob-fields className="m-0 flex flex-col gap-1 font-mono text-[12px]">
          {f.k === "probe" ? <Fact term="Kind">probe: a fixed-time check, not a Claude proposal</Fact> : null}
          {f.k === "bill" ? <Fact term="Kind">compute bill: the text is written by the agent&apos;s code</Fact> : null}
          {f.m !== undefined ? <Fact term="Model">{f.m}</Fact> : null}
          {f.q !== undefined ? <Fact term="Briefs">{f.q.map((id) => `#${id}`).join(", ")}</Fact> : null}
          <Fact term="State block">{formatInt(f.b)}</Fact>
          <Fact term="Run">{f.r}</Fact>
          <Fact term="Commit">
            <CommitRef commit={f.c} />
          </Fact>
          <Fact term="Journal head">
            {f.j === GENESIS ? "GENESIS (empty journal)" : <span className="break-all">{shortHash(f.j)}</span>} · {anchorText}
          </Fact>
          <Sources s={f.s} />
        </dl>
      ) : null}
    </div>
  );
}

/** Calldata between the intent and the suffix that is not a valid maat:v1 blob: its size, why, and its hash tick. */
export function UndecodedBlob({ blob, hashOk }: { blob: Extract<DecodedBlob, { status: "invalid" | "foreign" }>; hashOk: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="self-start rounded-md bg-refuse-tint px-2 py-0.5 font-mono text-[11px] font-semibold text-refuse">
        {blob.status === "invalid" ? "Blob not decoded" : "Unknown calldata"}
      </span>
      <p className="text-sm text-ink-2">
        {blob.status === "invalid"
          ? `The ${formatInt(blob.bytes)} bytes start with maat:v1: but break the spec: ${blob.problem}. No text is shown.`
          : `The ${formatInt(blob.bytes)} bytes after the intent are not a maat:v1 blob, so nothing is decoded from them.`}{" "}
        {hashOk ? "Their keccak256 equals the rationaleHash the vault recorded." : "Their keccak256 is not the rationaleHash the vault recorded."}
      </p>
    </div>
  );
}
