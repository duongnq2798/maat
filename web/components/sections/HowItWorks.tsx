import { CodePanel } from "@/components/ui/CodePanel";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { getDecisions, SOURCE_LABEL } from "@/content/decisions";
import { FACTS } from "@/content/facts";
import { numberWord } from "@/content/format";
import { REASON_LABEL } from "@/content/reasons";

const STEPS = [
  {
    n: "01",
    code: "Intent[]",
    title: "Claude proposes",
    body: `Every ${FACTS.loopMinutes.value} minutes in session, Claude reads the vault, the market and the mandate, and returns intents with a rationale.`,
  },
  {
    n: "02",
    code: "eth_call",
    title: "Preview as executor",
    body: "Each intent is simulated against the live contract from the executor address, under the exact rules that will apply.",
  },
  {
    n: "03",
    code: "execute()",
    title: "The vault weighs it",
    body: `${numberWord(FACTS.checksPerTrade.value)} checks in order, from market session and feed age to premium, caps and weight. Credit moves also check health factor. One fails, it stops.`,
  },
  {
    n: "04",
    code: "Decision",
    title: "Recorded either way",
    body: "Allowed or refused, the Decision event lands onchain with its reason code, the rationale hash and a Builder Code.",
  },
] as const;

export function HowItWorks() {
  const refused = getDecisions().find((r) => !r.allowed);
  if (!refused) throw new Error("the ledger has no refusal to decode");
  const decoded: readonly { k: string; v: string; tone?: "hot" | "muted"; note?: string }[] = [
    { k: "action", v: refused.action },
    { k: "token", v: refused.symbol },
    { k: "amount", v: `${refused.amountUsd.toFixed(2)} USDC` },
    { k: "allowed", v: String(refused.allowed), tone: "hot" },
    // The card shows the decoded log, so the value stays the code; its plain label follows as a comment.
    { k: "reason", v: refused.reason, tone: "hot", note: REASON_LABEL[refused.reason] },
    // Exists only once the decision is a mainnet tx (spec §3): a placeholder, never a made-up hash.
    { k: "rationaleHash", v: "[from mainnet tx]", tone: "muted" },
  ];
  const toneClass = { hot: "font-semibold text-refuse", muted: "text-ink-2" } as const;

  return (
    <section id="how" aria-labelledby="how-title" className="border-y border-line bg-surface-soft">
      <div className="wrap flex flex-col gap-14 py-20 md:py-32">
        <SectionHeading
          id="how-title"
          eyebrow="How it works"
          title="Claude proposes. The vault decides."
          lead="Claude never holds the keys to the rules. It writes intents. The vault checks them against a mandate it cannot change, then emits a Decision either way."
        />
        <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,250px),1fr))] gap-4 p-0">
          {STEPS.map((s) => (
            <li key={s.n} className="card flex min-h-[220px] flex-col gap-3.5 p-6">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-semibold text-accent">{s.n}</span>
                <span className="rounded-md bg-line-soft px-2 py-1 font-mono text-[11px] text-ink-2">{s.code}</span>
              </div>
              <h3 className="m-0 text-[22px] font-semibold tracking-[-0.03em]">{s.title}</h3>
              <p className="m-0 text-[15px] leading-[1.6] text-ink-2">{s.body}</p>
            </li>
          ))}
        </ol>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,460px),1fr))] gap-4">
          <CodePanel />
          <div className="card flex flex-col gap-4 p-7">
            <span className="font-mono text-xs text-ink-2">
              DECODED · {refused.timeLabel.toUpperCase()} · {SOURCE_LABEL[refused.source].toUpperCase()}
            </span>
            <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-3 font-mono text-sm">
              {/* Every dt/dd pair sits in its own div: a <dl> may not mix bare pairs with wrapped ones. */}
              {decoded.map((d) => (
                <div key={d.k} className="contents">
                  <dt className="text-ink-2">{d.k}</dt>
                  <dd className={`m-0 [overflow-wrap:anywhere] ${d.tone ? toneClass[d.tone] : ""}`}>
                    {d.v}
                    {/* One inline block after a plain space: when the line runs out, "//" moves down with its label. */}
                    {d.note ? (
                      <>
                        {" "}
                        <span className="inline-block font-normal text-ink-2">{`// ${d.note}`}</span>
                      </>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="m-0 mt-auto text-sm leading-[1.6] text-ink-2">
              Every transaction carries a Base Builder Code (ERC-8021), so each decision is attributable to Maat onchain.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
