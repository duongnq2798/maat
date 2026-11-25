import { formatUsd6 } from "@/lib/chain/ledger";
import type { Read, Treasury } from "@/lib/chain/treasury";
import { weightBps } from "@/lib/chain/treasury";
import { formatAge, formatBps, formatPrice8, formatQty } from "./format";

const NA = "unavailable";
const show = <T,>(r: Read<T>, f: (v: T) => string) => (r.ok ? f(r.value) : NA);

/** What the vault holds at the block read: every value either read onchain or derived from reads, never guessed. */
export function TreasuryTable({ treasury }: { treasury: Treasury }) {
  const credit = treasury.credit;
  const equity = treasury.equityUsd6;
  const usdcWeight = treasury.usdc.ok && equity.ok ? weightBps(treasury.usdc.value, equity.value) : null;
  const cell = "px-3 py-3 text-right font-mono text-[13px] tabular-nums";
  return (
    <div role="region" aria-label="Treasury holdings" tabIndex={0} data-scroll-x className="card scroll-x-cue overflow-x-auto">
      <table aria-label="Treasury" className="w-full min-w-[760px] border-collapse text-left">
        <thead className="bg-surface-head font-mono text-[11px] tracking-[0.06em] text-ink-2">
          <tr className="border-b border-line">
            <th scope="col" className="py-3 pl-6 pr-3 font-normal">ASSET</th>
            <th scope="col" className="px-3 py-3 text-right font-normal">HELD</th>
            {credit ? <th scope="col" className="px-3 py-3 text-right font-normal">SUPPLIED</th> : null}
            <th scope="col" className="px-3 py-3 text-right font-normal">PRICE</th>
            <th scope="col" className="px-3 py-3 text-right font-normal">FEED AGE</th>
            <th scope="col" className="px-3 py-3 text-right font-normal">VALUE</th>
            <th scope="col" className="px-3 py-3 text-right font-normal">WEIGHT</th>
            <th scope="col" className="py-3 pl-3 pr-6 text-right font-normal">CAP</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-line-soft">
            <th scope="row" className="py-3 pl-6 pr-3 font-mono text-[13px] font-medium text-ink">USDC</th>
            <td className={cell}>{show(treasury.usdc, (v) => formatQty(v, 6))}</td>
            {credit ? <td className={cell}>—</td> : null}
            <td className={cell}>—</td>
            <td className={cell}>—</td>
            <td className={cell}>{show(treasury.usdc, formatUsd6)}</td>
            <td className={cell}>{usdcWeight === null ? NA : formatBps(usdcWeight)}</td>
            <td className={`${cell} pr-6`}>—</td>
          </tr>
          {treasury.tokens.map((t) => {
            const dec = t.decimals;
            return (
              <tr key={t.address} className="border-b border-line-soft">
                <th scope="row" className="py-3 pl-6 pr-3 font-mono text-[13px] font-medium text-ink">
                  {t.symbol}
                </th>
                <td className={cell}>{t.ui.ok && dec.ok ? formatQty(t.ui.value, dec.value) : NA}</td>
                {credit ? <td className={cell}>{t.supplied.ok && dec.ok ? formatQty(t.supplied.value, dec.value) : NA}</td> : null}
                <td className={cell}>{show(t.price8, formatPrice8)}</td>
                <td className={cell}>{show(t.feedAgeSec, formatAge)}</td>
                <td className={cell}>{show(t.valueUsd6, formatUsd6)}</td>
                <td className={cell}>{t.weightBps === null ? NA : formatBps(t.weightBps)}</td>
                <td className={`${cell} pr-6`}>{show(t.maxWeightBps, formatBps)}</td>
              </tr>
            );
          })}
          {credit ? (
            <tr className="border-b border-line-soft">
              <th scope="row" className="py-3 pl-6 pr-3 font-mono text-[13px] font-medium text-ink">
                Debt
              </th>
              <td className={cell} colSpan={4} />
              <td className={cell}>{show(credit.debt, (v) => formatUsd6(-v))}</td>
              <td className={cell} />
              <td className={`${cell} pr-6`} />
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
