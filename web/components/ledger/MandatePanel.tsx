"use client";

import { useState } from "react";
import type { Address, Hex } from "viem";
import { FACTS } from "@/content/facts";
import { mandateRows } from "@/content/mandate";
import { basescanAddress } from "@/lib/chain/basescan";
import { etLabel, GRACE_PERIOD_SEC, type PendingChange } from "@/lib/chain/ledger";
import { onchainMandateRows } from "@/lib/chain/mandate";
import { shortAddress } from "@/lib/chain/tokens";
import type { Treasury } from "@/lib/chain/treasury";
import { repoFileUrl } from "@/lib/site";

const KIND: Record<PendingChange["kind"], string> = { mandate: "Mandate change", token: "Token config change", payee: "Payee change" };
const DEFAULTS = mandateRows(FACTS.mandate.value);

function CopyHash({ hash }: { hash: Hex }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <code className="font-mono text-xs text-ink [overflow-wrap:anywhere]">{hash}</code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(hash).then(() => setCopied(true), () => {});
        }}
        className="rounded-md border border-line-strong px-2 py-0.5 text-xs text-ink hover:border-ink"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

function AddressLink({ label, address }: { label: string; address: Address }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 py-1.5 text-sm">
      <span className="text-ink-2">{label}</span>
      <a href={basescanAddress(address)} className="font-mono text-xs">
        {shortAddress(address)}
        <span aria-hidden="true"> ↗</span>
      </a>
    </div>
  );
}

/**
 * The rules the vault enforces. Before the deploy: the configured defaults. After: the onchain mandate, each row flagged
 * where it differs from the default, the rule addresses, and any change waiting out the timelock.
 */
export function MandatePanel({ treasury, pending }: { treasury: Treasury | null; pending: readonly PendingChange[] }) {
  const caps = treasury?.tokens.map((t) => (t.maxWeightBps.ok ? t.maxWeightBps.value : null)) ?? [];
  const sharedCap = caps.length > 0 && caps.every((c) => c !== null && c === caps[0]) ? caps[0]! : null;
  const rows = treasury ? onchainMandateRows(treasury.mandate, sharedCap) : DEFAULTS;
  const byKey = new Map(DEFAULTS.map((r) => [r.k, r.v]));

  return (
    <section aria-label="Mandate" className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="card overflow-hidden">
        <table className="w-full table-fixed border-collapse text-left">
          <caption className="px-5 pt-4 pb-2 text-left text-sm font-semibold text-ink">
            {treasury ? "The mandate onchain" : "The mandate as configured for the deploy"}
          </caption>
          <tbody>
            {rows.map((r) => {
              const def = byKey.get(r.k);
              const differs = treasury !== null && def !== undefined && def !== r.v;
              return (
                <tr key={r.k} className="border-t border-line-soft">
                  <th scope="row" className="w-[55%] px-5 py-2.5 align-top text-sm font-normal text-ink-body [overflow-wrap:anywhere]">
                    {r.label}
                    <span className="block font-mono text-[11px] text-ink-2">{r.k}</span>
                  </th>
                  <td className="px-5 py-2.5 text-right align-top font-mono text-[13px] text-ink [overflow-wrap:anywhere]">
                    {r.v}
                    {treasury === null ? (
                      <span className="ml-2 rounded bg-surface-soft px-1.5 py-0.5 text-[11px] text-ink-2">configured</span>
                    ) : differs ? (
                      <span className="mt-0.5 block text-[11px] text-refuse">
                        <span className="font-semibold">changed</span> · default {def}
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="border-t border-line px-5 py-3 font-mono text-[11px] text-ink-2 [&_a]:underline [&_a]:underline-offset-2">
          {treasury ? (
            <>
              Read from mandate() at block {treasury.blockNumber.toString()}; defaults from{" "}
              <a href={repoFileUrl("contracts/script/MaatConfig.sol")}>MaatConfig.sol</a>.
            </>
          ) : (
            <>
              Source: <a href={repoFileUrl("contracts/script/MaatConfig.sol")}>contracts/script/MaatConfig.sol</a>.
            </>
          )}
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {treasury ? (
          <div className="card px-5 py-4">
            <h3 className="text-sm font-semibold text-ink">Who and what</h3>
            <div className="mt-2 divide-y divide-line-soft">
              <AddressLink label="Owner" address={treasury.owner} />
              {/* The chain names the executor's address, not who runs it; the owner can hold the role, as at the deploy. */}
              <AddressLink
                label={treasury.executor.toLowerCase() === treasury.owner.toLowerCase() ? "Executor · same address as the owner" : "Executor"}
                address={treasury.executor}
              />
              <AddressLink label="Market calendar" address={treasury.mandate.calendar} />
              <AddressLink label="Swap adapter" address={treasury.mandate.swapAdapter} />
              <AddressLink label="Credit adapter" address={treasury.mandate.creditAdapter} />
            </div>
            <p className="mt-3 text-xs text-ink-2">mandateHash</p>
            <CopyHash hash={treasury.mandateHash} />
          </div>
        ) : null}
        <div className="card px-5 py-4">
          <h3 className="text-sm font-semibold text-ink">Rule changes waiting out the timelock</h3>
          {pending.length === 0 ? (
            <p className="mt-2 text-sm text-ink-2">
              {treasury ? "None pending." : "None yet."} Every change waits {FACTS.timelockHours.value} hours in public before the
              owner can apply it.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {pending.map((p) => (
                <li key={p.changeHash} className="text-sm">
                  <span className="font-medium text-ink">{KIND[p.kind]}</span>
                  {p.subject ? <span className="ml-2 font-mono text-xs text-ink-2">{shortAddress(p.subject)}</span> : null}
                  <span className="block text-xs text-ink-2">
                    {p.status === "waiting"
                      ? `can apply from ${etLabel(p.eta)} ET`
                      : `ready to apply until ${etLabel(p.eta + GRACE_PERIOD_SEC)} ET`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
