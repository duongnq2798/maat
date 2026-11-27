import type { ReactNode } from "react";
import {
  emptyCount,
  formatCount,
  proofLines,
  splitText,
  valueText,
  verifiedText,
  type DecisionCount,
  type LinesState,
  type ProofCount,
  type ProofLine,
  type VerifiedColumn,
} from "./count";
import type { TeamTrace } from "./team";

const MONO = "font-mono text-[13px] text-ink [overflow-wrap:anywhere]";

function Table({ label, head, rows, kind }: { label: string; head: readonly string[]; rows: readonly (readonly ReactNode[])[]; kind: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="m-0 text-[15px] font-semibold text-ink">{label}</h3>
      <div className="overflow-x-auto">
        <table aria-label={label} className="w-full border-collapse text-left text-[14px]">
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h} scope="col" className="border-b border-line py-2 pr-4 font-medium text-ink-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} data-proof-row={kind}>
                {row.map((cell, j) => (
                  <td key={j} className={`border-b border-line py-2 pr-4 align-top ${j === 0 ? MONO : ""}`}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The traced team set, the hop stops and what the trace cannot see, as plain text with no link. */
function TeamSet({ team }: { team: TeamTrace }) {
  return (
    <>
      <Table
        label="Team set"
        kind="team-set"
        head={["Wallet", "Hop", "Why"]}
        rows={team.members.map((m) => [m.address, String(m.hop), <span className="[overflow-wrap:anywhere]">{m.why.join("; ")}</span>])}
      />
      <Table label="Hop stops" kind="stop" head={["Address", "What", "Source"]} rows={team.stops.map((s) => [s.address, s.name, s.source])} />
      {team.notes.length > 0 ? (
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[13px] leading-normal text-ink-2">
          {team.notes.map((n) => (
            <li key={n} className="[overflow-wrap:anywhere]">
              Not seen: {n}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/**
 * The ten lines of the rule and the rows behind them, as plain text: every address and UID is text, never a link.
 * While the briefs are read (`state` "reading", `count` null) every line shows "…". When the read is incomplete or no
 * inbox is recorded, the brief lines say so in place of a number and list no row; the Decision lines, from the vault's
 * Decision logs, and the bounty line, from a committed list, keep their number. A Decision line gives under its number
 * how many of its Decisions the vault allowed and refused, and says "not read" while `decisions` is null.
 */
export function ProofCounts({
  count,
  verified,
  state,
  team = null,
  decisions = null,
}: {
  count: ProofCount | null;
  verified: VerifiedColumn | null;
  state: "reading" | LinesState;
  team?: TeamTrace | null;
  decisions?: DecisionCount | null;
}) {
  const c = count ?? emptyCount();
  const reading = state === "reading" || count === null;
  const lines = proofLines(c, verified, decisions);
  const shown = (l: ProofLine) => (reading ? "…" : valueText(l, state));
  const counted = state === "counted" && count !== null;
  return (
    <div className="flex flex-col gap-8">
      <dl className="m-0 grid grid-cols-1 gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
        {lines.map((l) => (
          <div key={l.key} className="flex flex-col gap-1 border-b border-line py-2.5">
            <dt className="text-[13px] text-ink-2">{l.label}</dt>
            <dd data-testid={`proof-${l.key}`} className="m-0 font-mono text-[20px] font-medium text-ink">
              {shown(l)}
            </dd>
            {!reading && l.split ? (
              <dd data-testid={`proof-${l.key}-split`} className="m-0 text-[13px] text-ink-2">
                {splitText(l.split)}
              </dd>
            ) : null}
          </div>
        ))}
      </dl>
      {counted && c.outsideWallets.length > 0 ? (
        <Table
          label="Outside wallets"
          kind="outside"
          head={["Wallet", "Briefs", "Verified Account (EAS UID)"]}
          rows={c.outsideWallets.map((w) => [w.address, formatCount(w.briefs), <span className={MONO}>{verifiedText(verified, w.address)}</span>])}
        />
      ) : null}
      {counted && c.teamWallets.length > 0 ? (
        <Table label="Team wallets" kind="team" head={["Wallet", "Briefs"]} rows={c.teamWallets.map((w) => [w.address, formatCount(w.briefs)])} />
      ) : null}
      {counted && c.hidden.length > 0 ? (
        <Table label="Hidden briefs" kind="hidden" head={["From", "Brief"]} rows={c.hidden.map((h) => [h.from, `#${h.id}`])} />
      ) : null}
      {state !== "reading" && count !== null && c.bounty.length > 0 ? (
        <Table label="Bounty claimants" kind="bounty" head={["Wallet", "Reproduction"]} rows={c.bounty.map((b) => [b.address, b.evidence])} />
      ) : null}
      {team ? <TeamSet team={team} /> : null}
    </div>
  );
}
