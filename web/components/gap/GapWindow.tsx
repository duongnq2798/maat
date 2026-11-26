import { Command, commandParts } from "@/components/gap/Command";
import { GapChart } from "@/components/gap/GapChart";
import { TokenTabs } from "@/components/gap/TokenTabs";
import { BlockLink, INLINE_LINK, WindowTable } from "@/components/gap/WindowTable";
import { closureNote, type CompleteWindow, decisionsSentence, rowsInTabOrder } from "@/content/gap-index";
import type { EditionFile } from "@/lib/gap/schema";

type Win = EditionFile["windows"][number];

/**
 * One closed window: its headline, what closed it when that is not a plain weekend, then its command, its Decisions line
 * when its edition counts them, and its charts and table once it is measured, else when it will be.
 */
export function GapWindow({ w, edition }: { w: Win; edition: number }) {
  const headingId = `window-${w.id}`;
  const note = closureNote(w);
  return (
    <section aria-labelledby={headingId} data-window={w.id} data-status={w.status} className="flex min-w-0 flex-col gap-6">
      <div data-window-headline className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id={headingId} className="m-0 text-[clamp(20px,2.4vw,26px)] font-semibold leading-tight tracking-[-0.02em] text-ink">
          {w.closeLabel} → {w.openLabel}
        </h3>
        {w.status === "complete" ? (
          <p className="m-0 font-mono text-[13px] text-ink-2">
            <span aria-hidden="true" className="max-sm:hidden">
              {" · "}
            </span>
            window {w.id} · blocks <BlockLink block={w.blocks.from} /> → <BlockLink block={w.blocks.to} />
          </p>
        ) : null}
      </div>
      {note ? (
        <p data-window-note className="m-0 -mt-3 text-[14px] leading-5 text-ink-2">
          {note}
        </p>
      ) : null}
      {w.status === "complete" ? (
        // The window's own edition and id, so a reader of one of its rows never gets "edition 1 has no window".
        <p data-window-command className="m-0 -mt-3 font-mono text-[12px] leading-5 text-ink-2">
          <Command parts={commandParts(edition, w.id)} />
        </p>
      ) : null}
      {w.status === "complete" && w.decisions ? (
        <p data-window-decisions className="m-0 max-w-[820px] text-[15px] leading-relaxed text-ink-body">
          {decisionsSentence(w.decisions)}
          {w.decisions.count > 0 ? (
            <>
              {" "}
              Each one is on the{" "}
              <a href="/ledger" className={INLINE_LINK}>
                ledger
              </a>
              .
            </>
          ) : null}
        </p>
      ) : null}
      {w.status === "complete" ? <Measured w={w} /> : (
        <p className="card m-0 border-dashed px-5 py-6 text-[15px] text-ink-body">Measured after it ends, {w.openLabel}</p>
      )}
    </section>
  );
}

function Measured({ w }: { w: CompleteWindow }) {
  const rows = rowsInTabOrder(w);
  return (
    <>
      <TokenTabs
        windowId={w.id}
        label={`Tokens, window closing ${w.closeLabel}`}
        tabs={rows.map((r) => ({ id: r.symbol, label: r.symbol }))}
        panels={rows.map((r) => (
          <GapChart key={r.symbol} row={r} window={w} />
        ))}
      />
      <WindowTable window={w} />
    </>
  );
}
