import { FACTS } from "@/content/facts";
import { mandateRows } from "@/content/mandate";

export function Mandate() {
  const hours = FACTS.timelockHours.value;
  const chips = [`timelock ${hours}h`, "executor can only call execute()", "mandateHash [after deploy]"];
  return (
    <section id="mandate" aria-labelledby="mandate-title" className="border-y border-line bg-surface-soft">
      <div className="wrap grid grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] items-center gap-14 py-20 md:py-32">
        <div className="flex flex-col gap-5">
          <span className="eyebrow">The mandate</span>
          <h2 id="mandate-title" className="h2">
            Rules the agent can&apos;t loosen.
          </h2>
          <p className="lead">
            The owner commits the mandate onchain. Any change is queued in public with its full contents and waits {hours}{" "}
            hours, so neither the agent nor a stolen key can relax a limit in the moment.
          </p>
          <ul className="m-0 flex list-none flex-wrap gap-2.5 p-0">
            {chips.map((t) => (
              <li key={t} className="rounded-full border border-line bg-white px-3 py-2 font-mono text-xs">
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="card overflow-hidden">
          <div className="flex justify-between gap-4 border-b border-line bg-surface-head px-[22px] py-3.5 font-mono text-xs">
            <span className="font-semibold">mandate · Maat #1</span>
            <span className="text-ink-2">default · not deployed yet</span>
          </div>
          <dl className="m-0 px-[22px] pb-3.5 pt-2">
            {mandateRows(FACTS.mandate.value).map((r) => (
              <div key={r.k} className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] items-baseline gap-4 border-b border-line-soft py-[11px]">
                <dt className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-ink">{r.label}</span>
                  <span className="font-mono text-[11px] text-ink-2">{r.k}</span>
                </dt>
                <dd className="m-0 text-right font-mono text-sm font-medium [overflow-wrap:anywhere]">{r.v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
