import { CodePanel } from "@/components/ui/CodePanel";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { FACTS } from "@/content/facts";
import { numberWord } from "@/content/format";
import { REASON_LABEL } from "@/content/reasons";
import { basescanDecision, basescanRefusalNote } from "@/lib/live/basescan";
import { HeroReason } from "./HeroReason";
import { RECORDED_ROWS } from "./vault-rows";

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

/** "0xb8552684…a6c1", as cast's outputs on /ledger shorten a hash. */
const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-4)}`;

/** The first refusal of Maat's agent on Base mainnet, as this build records it (content/facts.ts mainnetDecisions). */
function agentRefusal() {
  const row = [...RECORDED_ROWS].reverse().find((r) => r.sender === "agent" && !r.allowed);
  const log = FACTS.mainnetDecisions.value.find((l) => l.transactionHash === row?.txHash);
  if (!row || !log || row.reason === "OK") throw new Error("this build records no refusal of Maat's agent to decode");
  // The Decision log's data, one word each: action, amount, allowed, reason, rationaleHash.
  const amount = BigInt(`0x${log.data.slice(2 + 64, 2 + 128)}`);
  return { row, reason: row.reason, amount: `${(Number(amount) / 1e6).toFixed(6)} USDC` };
}

export function HowItWorks() {
  const { row, reason, amount } = agentRefusal();
  const decoded: readonly { k: string; v: string; title?: string; tone?: "hot" | "muted"; note?: string }[] = [
    { k: "action", v: row.action },
    { k: "token", v: row.symbol },
    { k: "amount", v: amount },
    { k: "allowed", v: String(row.allowed), tone: "hot" },
    // The card shows the decoded log, so the value stays the code; its plain label follows as a comment.
    { k: "reason", v: reason, tone: "hot", note: REASON_LABEL[reason] },
    { k: "rationaleHash", v: shortHash(row.rationaleHash), title: row.rationaleHash, tone: "muted" },
  ];
  const toneClass = { hot: "font-semibold text-refuse", muted: "text-ink-2" } as const;

  return (
    <section id="how" aria-labelledby="how-title" className="border-y border-line bg-surface-soft">
      <div className="wrap flex flex-col gap-14 py-20 md:py-32">
        <SectionHeading
          id="how-title"
          eyebrow="How it works"
          title="Claude proposes. The vault decides."
          lead="Claude never holds the keys to the rules. It writes intents. The vault checks them against the mandate (the vault's public rule set), which Claude cannot change, then emits a Decision either way."
        />
        {/* Below sm, Claude's reason for its first allowed trade shows here, not at the foot of the hero, so a phone
            reader reaches the "why" sooner (cold read of 2026-11-28, gap 6). From sm it stays in the hero. */}
        <HeroReason className="bg-bg sm:hidden" />
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
              DECODED · {row.timeLabel.toUpperCase()} ET · BASE MAINNET · SENT BY MAAT&apos;S AGENT
            </span>
            <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-3 font-mono text-sm">
              {/* Every dt/dd pair sits in its own div: a <dl> may not mix bare pairs with wrapped ones. */}
              {decoded.map((d) => (
                <div key={d.k} className="contents">
                  <dt className="text-ink-2">{d.k}</dt>
                  <dd title={d.title} className={`m-0 [overflow-wrap:anywhere] ${d.tone ? toneClass[d.tone] : ""}`}>
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
            <p className="m-0 text-sm leading-[1.6] text-ink-2">
              <a href={basescanDecision(row.txHash)} className="font-medium">
                See it on Basescan, on the Logs tab<span aria-hidden="true"> ↗</span>
              </a>{" "}
              {basescanRefusalNote(reason)}
            </p>
            <p className="m-0 mt-auto text-sm leading-[1.6] text-ink-2">
              Every transaction carries a Base Builder Code (ERC-8021), so each decision is attributable to Maat onchain.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
