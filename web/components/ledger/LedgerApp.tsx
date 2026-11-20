"use client";

import { useState } from "react";
import { DecisionsPerDayChart } from "@/components/charts/DecisionsPerDayChart";
import { HealthFactorChart } from "@/components/charts/HealthFactorChart";
import { RefusalsByReasonChart } from "@/components/charts/RefusalsByReasonChart";
import { WeightsChart } from "@/components/charts/WeightsChart";
import { FACTS } from "@/content/facts";
import type { RefusalCode } from "@/content/reasons";
import type { LedgerSnapshot } from "@/lib/chain/load";
import type { Treasury } from "@/lib/chain/treasury";
import { DecisionTimeline } from "./DecisionTimeline";
import { KpiTiles } from "./KpiTiles";
import { MandatePanel } from "./MandatePanel";
import { ConnectingStrip, ErrorStrip, MainnetStrip, WaitingStrip } from "./StatusStrip";
import { TreasuryTable } from "./TreasuryTable";
import { useLedger } from "./useLedger";

const WAD = 1e18;
/** Aave reports type(uint256).max as the health factor of a position with no debt. */
const NO_DEBT = 10n ** 30n;

function healthFactor(t: Treasury | null): { hf: number | null; emptyText: string } {
  if (!t) return { hf: null, emptyText: "Shown once the vault is deployed and borrows." };
  if (!t.credit) return { hf: null, emptyText: "No credit adapter is set, so the vault does not borrow." };
  const r = t.credit.healthFactor;
  if (!r.ok) return { hf: null, emptyText: "Health factor unavailable: the read failed." };
  if (r.value >= NO_DEBT) return { hf: null, emptyText: "No debt, so no health factor to watch." };
  return { hf: Number(r.value) / WAD, emptyText: "" };
}

function Charts({ snapshot, reason, onReason }: { snapshot: LedgerSnapshot | null; reason: RefusalCode | null; onReason: (c: RefusalCode | null) => void }) {
  const t = snapshot?.treasury ?? null;
  const m = FACTS.mandate.value;
  const { hf, emptyText } = healthFactor(t);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <DecisionsPerDayChart days={snapshot?.summary.perDay ?? []} />
      <RefusalsByReasonChart reasons={snapshot?.summary.byReason ?? []} selected={reason} onSelect={onReason} />
      <WeightsChart
        holdings={(t?.tokens ?? []).map((h) => ({ symbol: h.symbol, weightBps: h.weightBps, maxWeightBps: h.maxWeightBps.ok ? h.maxWeightBps.value : null }))}
        targetPct={FACTS.targetWeightPct.value}
      />
      <HealthFactorChart
        hf={hf}
        min={t ? Number(t.mandate.minHealthFactor) / WAD : m.minHealthFactor}
        target={t ? Number(t.mandate.targetHealthFactor) / WAD : m.targetHealthFactor}
        emptyText={emptyText}
      />
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold tracking-[-0.01em] text-ink">{title}</h2>
      {children}
    </div>
  );
}

/**
 * The mainnet ledger. `initial` comes from the build's deployments table, so the static HTML shows the same state the
 * page settles on: the waiting view before the deploy, a connecting line after it.
 */
export function LedgerApp({ initial }: { initial: "waiting" | "loading" }) {
  const state = useLedger();
  const [reason, setReason] = useState<RefusalCode | null>(null);
  const mode = state.mode === "loading-config" ? initial : state.mode;
  const snapshot = state.mode === "mainnet" ? state.snapshot : null;

  return (
    <div className="wrap flex flex-col gap-10 py-12 md:py-20">
      <header className="flex max-w-[820px] flex-col gap-4">
        <span className="eyebrow">Base mainnet</span>
        <h1 className="h2">Mainnet ledger</h1>
        <p className="lead">
          Every intent the agent sends, every answer the vault gives and what it holds, read from Base by your browser.
          Refusals included.
        </p>
      </header>

      {mode === "waiting" ? <WaitingStrip /> : null}
      {mode === "loading" ? <ConnectingStrip /> : null}
      {state.mode === "error" ? <ErrorStrip message={state.message} vault={state.vault} onRetry={state.retry} /> : null}
      {state.mode === "mainnet" ? (
        <MainnetStrip snapshot={state.snapshot} endpoints={state.endpoints} loading={state.loading} refreshError={state.refreshError} onRetry={state.retry} />
      ) : null}

      {snapshot ? <KpiTiles summary={snapshot.summary} treasury={snapshot.treasury} /> : null}

      {mode === "waiting" || snapshot ? <Charts snapshot={snapshot} reason={reason} onReason={setReason} /> : null}

      {snapshot?.treasury ? (
        <Block title="Treasury">
          <TreasuryTable treasury={snapshot.treasury} />
        </Block>
      ) : null}

      {snapshot ? (
        <Block title="Decisions">
          <DecisionTimeline
            decisions={snapshot.decisions}
            rationales={snapshot.rationales}
            reason={reason}
            onReason={setReason}
            scanning={state.mode === "mainnet" && state.loading && !snapshot.scan.done}
          />
        </Block>
      ) : null}

      {mode === "waiting" || snapshot ? (
        <Block title="Mandate">
          <MandatePanel treasury={snapshot?.treasury ?? null} pending={snapshot?.summary.pending ?? []} />
        </Block>
      ) : null}
    </div>
  );
}
