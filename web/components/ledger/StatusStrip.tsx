import type { Address } from "viem";
import { formatInt } from "@/content/format";
import { basescanAddress } from "@/lib/chain/basescan";
import type { LedgerSnapshot } from "@/lib/chain/load";
import { SNAPSHOT_REORG_WINDOW, SNAPSHOT_URL } from "@/lib/chain/snapshot";
import { shortAddress } from "@/lib/chain/tokens";
import { repoFileUrl } from "@/lib/site";
import { etClock, hostOf } from "./format";

const card = "rounded-xl border px-5 py-4";

export function WaitingStrip() {
  return (
    <div className={`${card} border-line bg-surface-soft`}>
      <p className="flex items-center gap-2 text-sm font-semibold text-ink">
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-ink-3" />
        Waiting for the mainnet deploy
      </p>
      <p className="mt-2 max-w-[760px] text-sm leading-relaxed text-ink-2">
        The MandateVault is not on Base mainnet yet. Once the owner deploys it and the{" "}
        <a href={repoFileUrl("deployments/README.md")} className="underline underline-offset-2">deployments table</a> records its address, this page reads the
        vault&apos;s decisions, balances and rules straight from Base, in your browser. Until then the charts below are
        empty and the mandate shows the configured values.
      </p>
    </div>
  );
}

export function ConnectingStrip() {
  return (
    <div className={`${card} border-line bg-surface-soft`}>
      <p className="flex items-center gap-2 text-sm font-semibold text-ink">
        <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-accent" />
        Connecting to Base…
      </p>
    </div>
  );
}

export function ErrorStrip({ message, vault, onRetry }: { message: string; vault?: Address; onRetry: () => void }) {
  return (
    <div className={`${card} border-refuse-hatch bg-refuse-tint`}>
      <p className="text-sm font-semibold text-refuse">Base could not be read</p>
      <p className="mt-1 text-sm text-ink [overflow-wrap:anywhere]">{message}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <button type="button" onClick={onRetry} className="pill-dark px-4 py-2">
          Retry
        </button>
        {vault ? (
          <a href={`${basescanAddress(vault)}#events`}>
            See the vault&apos;s events on Basescan<span aria-hidden="true"> ↗</span>
          </a>
        ) : null}
      </div>
    </div>
  );
}

function blocksRead(scan: LedgerSnapshot["scan"]): bigint {
  const total = scan.head - scan.floor + 1n;
  return total - scan.gaps.reduce((n, g) => n + (g.to - g.from + 1n), 0n);
}

export function MainnetStrip({
  snapshot,
  endpoints,
  loading,
  refreshError,
  onRetry,
}: {
  snapshot: LedgerSnapshot;
  endpoints: readonly string[];
  loading: boolean;
  refreshError: string | null;
  onRetry: () => void;
}) {
  const { scan, vault, treasury } = snapshot;
  const total = scan.head - scan.floor + 1n;
  const pct = total > 0n ? Number((blocksRead(scan) * 1000n) / total) / 10 : 100;
  return (
    <div className={`${card} border-line bg-bg`}>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-ink">
          <span aria-hidden="true" className={`h-2 w-2 rounded-full bg-accent ${loading ? "animate-pulse" : ""}`} />
          Reading Base mainnet · block <span className="font-mono tabular-nums">{formatInt(Number(scan.head))}</span>
          <span className="text-ink-2">· read at {etClock(snapshot.updatedAt)}</span>
        </p>
        <a href={basescanAddress(vault)} className="text-sm font-medium">
          View the vault on Basescan<span aria-hidden="true"> ↗</span>
        </a>
      </div>
      <p className="mt-1 font-mono text-xs text-ink-2 [overflow-wrap:anywhere]">
        Vault {shortAddress(vault)} · via {endpoints.map(hostOf).join(", then ")}
        {treasury?.paused ? <span className="ml-2 rounded bg-refuse-tint px-1.5 py-0.5 font-semibold text-refuse">paused by the owner</span> : null}
      </p>
      {scan.fromSnapshot ? (
        <p className="mt-1 text-xs text-ink-2">
          Logs up to block {formatInt(Number(scan.fromSnapshot.block - SNAPSHOT_REORG_WINDOW - 1n))} are from the{" "}
          <a href={SNAPSHOT_URL} className="underline underline-offset-2">
            committed snapshot
          </a>{" "}
          of block {formatInt(Number(scan.fromSnapshot.block))}, whose hash Base confirmed.
        </p>
      ) : null}
      {!scan.done ? (
        loading ? (
          <p className="mt-2 text-xs text-ink-2">
            Reading the vault&apos;s history since block {formatInt(Number(scan.floor))}: {pct.toFixed(1)}% of blocks so far.
          </p>
        ) : (
          <p className="mt-2 text-xs text-refuse">
            {formatInt(scan.gaps.length)} block {scan.gaps.length === 1 ? "range" : "ranges"} could not be read, so decisions in them
            are missing here.{" "}
            <button type="button" onClick={onRetry} className="font-semibold underline">
              Read again
            </button>
          </p>
        )
      ) : null}
      {snapshot.treasuryError ? <p className="mt-2 text-xs text-refuse">Balances could not be read: {snapshot.treasuryError}</p> : null}
      {refreshError ? (
        <p className="mt-2 text-xs text-refuse">
          The last refresh failed ({refreshError}). Showing the read from {etClock(snapshot.updatedAt)}.
        </p>
      ) : null}
    </div>
  );
}
