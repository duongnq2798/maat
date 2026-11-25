"use client";

import { useRef, useState } from "react";
import type { Address } from "viem";
import { ReasonTag } from "@/components/ui/ReasonTag";
import { formatInt } from "@/content/format";
import deployments from "@/content/generated/deployments.json";
import type { ReasonCode } from "@/content/reasons";
import { type SimIntent, vaultComparison, vaultRequest, vaultRequestLabel } from "@/content/simulator";
import type { LedgerClient } from "@/lib/chain/load";
import type { PreviewRequest, PreviewResult } from "@/lib/chain/preview";

/** The fail-closed line: on any error the panel gives no answer from the vault, and says so. */
export const VAULT_UNREACHABLE = "The real vault could not be asked, so there is no answer from it.";

export interface RealVaultDeps {
  /** The Base client the call goes over; by default the site's keyless public RPCs (lib/chain/rpc.ts). */
  client?: LedgerClient;
  /** The vault asked; by default the Base mainnet MandateVault of deployments/README.md. */
  vault?: Address;
}

let sharedClient: LedgerClient | undefined;

/**
 * One previewIntent eth_call at the head block (lib/chain/preview.ts). The chain code loads on the first ask, so the
 * landing's first load carries no RPC client and no ABI. Every failure, a missing vault included, throws a short message.
 */
async function askVault(req: PreviewRequest, deps: RealVaultDeps): Promise<PreviewResult> {
  const [{ previewIntent }, { createLedgerClient }, { deploymentConfig }, { errorText }] = await Promise.all([
    import("@/lib/chain/preview"),
    import("@/lib/chain/rpc"),
    import("@/lib/chain/config"),
    import("@/lib/chain/load"),
  ]);
  const vault = deps.vault ?? deploymentConfig(deployments)?.vault;
  if (!vault) throw new Error("deployments/README.md records no Base mainnet MandateVault yet.");
  const client = deps.client ?? (sharedClient ??= createLedgerClient());
  try {
    return await previewIntent(client, vault, req);
  } catch (e) {
    throw new Error(errorText(e));
  }
}

type Ask =
  | { state: "idle" }
  | { state: "asking"; key: string }
  | { state: "answer"; key: string; reason: ReasonCode; blockNumber: bigint }
  | { state: "error"; key: string; message: string };

/** What the vault is asked: the token and the amount. The moment and the tape are not part of the call. */
const keyOf = (i: SimIntent) => `${i.token}:${i.usd6}`;

function Answer({ who, code }: { who: string; code: ReasonCode }) {
  return (
    <>
      <dt className="font-mono text-[11px] text-ink-2">{who}</dt>
      <dd className="m-0 mt-1 flex flex-col gap-0.5">
        <span className="text-sm font-semibold">{code === "OK" ? "Allowed" : "Refused"}</span>
        <ReasonTag code={code} tone={code === "OK" ? "neutral" : "refuse"} layout="inline" className="text-sm" />
      </dd>
    </>
  );
}

/**
 * "Ask the real vault": the simulated intent sent to the deployed vault as a free previewIntent, its typed reason shown
 * beside the simulation's. No wallet; nothing is signed or sent. An answer stays only while the token and amount it
 * was asked for do; a late answer to an older ask is dropped.
 */
export function RealVault({
  intent,
  sim,
  etDay,
  disabled,
  deps = {},
}: {
  intent: SimIntent;
  /** The simulation's answer for the intent at its moment. */
  sim: ReasonCode;
  etDay: number;
  /** True while the amount field does not parse. */
  disabled: boolean;
  deps?: RealVaultDeps;
}) {
  const [ask, setAsk] = useState<Ask>({ state: "idle" });
  const seq = useRef(0);
  const key = keyOf(intent);
  const view: Ask = ask.state !== "idle" && ask.key === key ? ask : { state: "idle" };
  const label = vaultRequestLabel(intent);

  const run = async () => {
    const n = ++seq.current;
    setAsk({ state: "asking", key });
    try {
      const r = await askVault(vaultRequest(intent), deps);
      if (seq.current === n) setAsk({ state: "answer", key, reason: r.reason, blockNumber: r.blockNumber });
    } catch (e) {
      if (seq.current === n) setAsk({ state: "error", key, message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div data-real-vault={view.state} className="border-t border-line px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-[11px] text-ink-2">THE REAL VAULT · BASE MAINNET</span>
        <button
          type="button"
          onClick={run}
          disabled={disabled || view.state === "asking"}
          className="min-h-9 cursor-pointer rounded-full border border-line-strong bg-white px-3.5 text-xs font-medium text-ink hover:border-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          Ask the real vault
        </button>
      </div>
      <p className="m-0 mt-2 text-[13px] leading-normal text-ink-2">
        Sends {label} to the deployed vault as previewIntent, a free eth_call at the latest block. No wallet: nothing is
        signed or sent.
      </p>
      {intent.token === "OTHER" ? (
        <p className="m-0 mt-1 text-[13px] leading-normal text-ink-2">USDC stands in for the other token: the mandate does not list it for BUY.</p>
      ) : null}
      {/* Its own polite region, so the simulated verdict stays the section's only status. */}
      <div aria-live="polite" aria-atomic="true">
        {view.state === "asking" ? <p className="m-0 mt-3 text-[13px] text-ink-2">Asking the vault on Base…</p> : null}
        {view.state === "error" ? (
          <p className="m-0 mt-3 text-[13px] leading-normal text-refuse [overflow-wrap:anywhere]">
            {VAULT_UNREACHABLE} <span className="font-mono text-xs">{view.message}</span>
          </p>
        ) : null}
        {view.state === "answer" ? <Compared sim={sim} vault={view.reason} blockNumber={view.blockNumber} etDay={etDay} minute={intent.minute} /> : null}
      </div>
    </div>
  );
}

function Compared({ sim, vault, blockNumber, etDay, minute }: { sim: ReasonCode; vault: ReasonCode; blockNumber: bigint; etDay: number; minute: number }) {
  const c = vaultComparison({ sim, vault, etDay, minute, blockNumber });
  return (
    <>
      <dl className="m-0 mt-3 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
        <div data-answer="simulation">
          <Answer who="SIMULATION" code={sim} />
        </div>
        <div data-answer="vault">
          <Answer who={`REAL VAULT · BLOCK ${formatInt(Number(blockNumber))}`} code={vault} />
        </div>
      </dl>
      <p data-vault-match={c.same ? "same" : "differ"} className="m-0 mt-3 text-[13px] leading-normal text-ink-2">
        {c.text}
      </p>
    </>
  );
}
