import { formatUsd6 } from "@/lib/chain/ledger";
import type { Read, Treasury } from "@/lib/chain/treasury";
import { weightBps } from "@/lib/chain/treasury";
import { formatAge, formatBps, formatPrice8, formatQty } from "./format";

const NA = "unavailable";
const show = <T,>(r: Read<T>, f: (v: T) => string) => (r.ok ? f(r.value) : NA);

/**
 * Below 480 px the table is too wide for the screen (judge rehearsal 2026-11-27, m7), so each row turns into a card
 * there: the asset, then VALUE, WEIGHT and CAP on the first line, so a weight is always next to its cap, then the rest,
 * each under its column's name (data-label). The ARIA roles keep it a table for a screen reader at any width.
 */
// Written out whole, so Tailwind finds each class in the source.
const PHONE_TABLE = "max-[479px]:block max-[479px]:min-w-0";
const PHONE_ROW = "max-[479px]:grid max-[479px]:grid-cols-3 max-[479px]:gap-x-3 max-[479px]:gap-y-3 max-[479px]:px-4 max-[479px]:py-4";
const PHONE_ASSET = "max-[479px]:order-0 max-[479px]:col-span-3 max-[479px]:p-0";
const PHONE_CELL =
  "max-[479px]:flex max-[479px]:flex-col max-[479px]:items-start max-[479px]:gap-0.5 max-[479px]:p-0 max-[479px]:text-left max-[479px]:empty:hidden max-[479px]:before:font-mono max-[479px]:before:text-[10px] max-[479px]:before:tracking-[0.06em] max-[479px]:before:text-ink-2 max-[479px]:before:content-[attr(data-label)]";
/** VALUE, WEIGHT and CAP lead each card; the other columns follow. */
const KEY = "max-[479px]:order-1";
const REST = "max-[479px]:order-2";

/** What the vault holds at the block read: every value either read onchain or derived from reads, never guessed. */
export function TreasuryTable({ treasury }: { treasury: Treasury }) {
  const credit = treasury.credit;
  const equity = treasury.equityUsd6;
  const usdcWeight = treasury.usdc.ok && equity.ok ? weightBps(treasury.usdc.value, equity.value) : null;
  const base = `px-3 py-3 text-right font-mono text-[13px] tabular-nums ${PHONE_CELL}`;
  const cell = `${base} ${REST}`;
  const key = `${base} ${KEY}`;
  const asset = `py-3 pl-6 pr-3 font-mono text-[13px] font-medium text-ink ${PHONE_ASSET}`;
  const row = `border-b border-line-soft ${PHONE_ROW}`;
  return (
    <div role="region" aria-label="Treasury holdings" tabIndex={0} data-scroll-x className="card scroll-x-cue overflow-x-auto">
      <table role="table" aria-label="Treasury" className={`w-full min-w-[760px] border-collapse text-left ${PHONE_TABLE}`}>
        <thead role="rowgroup" className="bg-surface-head font-mono text-[11px] tracking-[0.06em] text-ink-2 max-[479px]:sr-only">
          <tr role="row" className="border-b border-line">
            <th role="columnheader" scope="col" className="py-3 pl-6 pr-3 font-normal">ASSET</th>
            <th role="columnheader" scope="col" className="px-3 py-3 text-right font-normal">HELD</th>
            {credit ? <th role="columnheader" scope="col" className="px-3 py-3 text-right font-normal">SUPPLIED</th> : null}
            <th role="columnheader" scope="col" className="px-3 py-3 text-right font-normal">PRICE</th>
            <th role="columnheader" scope="col" className="px-3 py-3 text-right font-normal">FEED AGE</th>
            <th role="columnheader" scope="col" className="px-3 py-3 text-right font-normal">VALUE</th>
            <th role="columnheader" scope="col" className="px-3 py-3 text-right font-normal">WEIGHT</th>
            <th role="columnheader" scope="col" className="py-3 pl-3 pr-6 text-right font-normal">CAP</th>
          </tr>
        </thead>
        <tbody role="rowgroup" className="max-[479px]:block">
          <tr role="row" className={row}>
            <th role="rowheader" scope="row" className={asset}>USDC</th>
            <td role="cell" data-label="HELD" className={cell}>{show(treasury.usdc, (v) => formatQty(v, 6))}</td>
            {credit ? <td role="cell" data-label="SUPPLIED" className={cell}>—</td> : null}
            <td role="cell" data-label="PRICE" className={cell}>—</td>
            <td role="cell" data-label="FEED AGE" className={cell}>—</td>
            <td role="cell" data-label="VALUE" className={key}>{show(treasury.usdc, formatUsd6)}</td>
            <td role="cell" data-label="WEIGHT" className={key}>{usdcWeight === null ? NA : formatBps(usdcWeight)}</td>
            <td role="cell" data-label="CAP" className={`${key} pr-6`}>—</td>
          </tr>
          {treasury.tokens.map((t) => {
            const dec = t.decimals;
            return (
              <tr role="row" key={t.address} className={row}>
                <th role="rowheader" scope="row" className={asset}>
                  {t.symbol}
                </th>
                <td role="cell" data-label="HELD" className={cell}>{t.ui.ok && dec.ok ? formatQty(t.ui.value, dec.value) : NA}</td>
                {credit ? (
                  <td role="cell" data-label="SUPPLIED" className={cell}>
                    {t.supplied.ok && dec.ok ? formatQty(t.supplied.value, dec.value) : NA}
                  </td>
                ) : null}
                <td role="cell" data-label="PRICE" className={cell}>{show(t.price8, formatPrice8)}</td>
                <td role="cell" data-label="FEED AGE" className={cell}>{show(t.feedAgeSec, formatAge)}</td>
                <td role="cell" data-label="VALUE" className={key}>{show(t.valueUsd6, formatUsd6)}</td>
                <td role="cell" data-label="WEIGHT" className={key}>{t.weightBps === null ? NA : formatBps(t.weightBps)}</td>
                <td role="cell" data-label="CAP" className={`${key} pr-6`}>{show(t.maxWeightBps, formatBps)}</td>
              </tr>
            );
          })}
          {credit ? (
            <tr role="row" className={row}>
              <th role="rowheader" scope="row" className={asset}>
                Debt
              </th>
              <td role="cell" className={cell} colSpan={4} />
              <td role="cell" data-label="VALUE" className={key}>{show(credit.debt, (v) => formatUsd6(-v))}</td>
              <td role="cell" className={key} />
              <td role="cell" className={`${key} pr-6`} />
            </tr>
          ) : null}
        </tbody>
      </table>
      <p className="border-t border-line px-6 py-3 font-mono text-[11px] leading-relaxed text-ink-2">
        HELD is balanceOfUI, the quantity a holder sees after splits; VALUE prices raw balanceOf plus supplied collateral at
        the Chainlink answer, as the vault does. A read that failed shows &quot;unavailable&quot;, never zero.
      </p>
    </div>
  );
}
