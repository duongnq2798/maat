import type { ReactNode } from "react";
import { formatCount, proofLines, verifiedText, emptyCount, type ProofCount, type VerifiedColumn } from "./count";

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

/**
 * The six lines of the rule and the rows behind them, as plain text: every address and UID is text, never a link.
 * `count` is null while the briefs are being read, and every line then shows "…".
 */
export function ProofCounts({ count, verified }: { count: ProofCount | null; verified: VerifiedColumn | null }) {
  const lines = proofLines(count ?? emptyCount(), verified);
  const shown = (v: number | null) => (count === null || v === null ? "…" : formatCount(v));
  const c = count ?? emptyCount();
  return (
    <div className="flex flex-col gap-8">
      <dl className="m-0 grid grid-cols-1 gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
        {lines.map((l) => (
          <div key={l.key} className="flex flex-col gap-1 border-b border-line py-2.5">
            <dt className="text-[13px] text-ink-2">{l.label}</dt>
            <dd data-testid={`proof-${l.key}`} className="m-0 font-mono text-[20px] font-medium text-ink">
              {shown(l.value)}
            </dd>
          </div>
        ))}
      </dl>
      {c.outsideWallets.length > 0 ? (
        <Table
          label="Outside wallets"
          kind="outside"
          head={["Wallet", "Briefs", "Verified Account (EAS UID)"]}
          rows={c.outsideWallets.map((w) => [w.address, formatCount(w.briefs), <span className={MONO}>{verifiedText(verified, w.address)}</span>])}
        />
      ) : null}
      {c.teamWallets.length > 0 ? (
        <Table label="Team wallets" kind="team" head={["Wallet", "Briefs"]} rows={c.teamWallets.map((w) => [w.address, formatCount(w.briefs)])} />
      ) : null}
      {c.hidden.length > 0 ? (
        <Table label="Hidden briefs" kind="hidden" head={["From", "Brief"]} rows={c.hidden.map((h) => [h.from, `#${h.id}`])} />
      ) : null}
      {c.bounty.length > 0 ? (
        <Table label="Bounty claimants" kind="bounty" head={["Wallet", "Reproduction"]} rows={c.bounty.map((b) => [b.address, b.evidence])} />
      ) : null}
    </div>
  );
}
