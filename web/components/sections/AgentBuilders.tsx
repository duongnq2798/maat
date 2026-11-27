import { SectionHeading } from "@/components/ui/SectionHeading";
import { FACTS } from "@/content/facts";
import { numberWord } from "@/content/format";
import { SITE } from "@/lib/site";

/** The market-guard skill (skills/maat-market-guard): its SKILL.md is served at /skill.md. */
const SKILL = "maat-market-guard";

/** The skill's two chain checks, each with the command its SKILL.md gives. */
const CHECKS = [
  {
    name: "market",
    command: "node scripts/check.mjs market",
    body: "Is the NYSE session open now, on the calendar the vault checks, with its weekends, holidays and early closes?",
  },
  {
    name: "preview",
    command: "node scripts/check.mjs preview --action BUY --token NVDAc --amount 5",
    body: "Would the live vault accept this intent now? previewIntent gives the verdict execute() reaches before it acts.",
  },
] as const;

/**
 * For agent builders: the market-guard skill and its two chain checks. It follows How it works (spec 2026-11-27,
 * landing "explain in 10 seconds", section 3), so a builder reads the reuse story before the simulator and the
 * reference; the rule above it is How it works' own bottom border.
 */
export function AgentBuilders() {
  const refusals = numberWord(FACTS.refusalCount.value).toLowerCase();
  return (
    <section id="agents" aria-labelledby="agents-title">
      <div className="wrap flex flex-col gap-10 py-20 md:py-32">
        <SectionHeading
          id="agents-title"
          layout="split"
          eyebrow="For agent builders"
          title="Ask the vault before you trade."
          lead={`${SKILL} lets any agent on Base ask Maat's contracts first. No key, no wallet, no transaction: plain eth_call reads, and a typed answer back, OK or one of ${refusals} typed refusals.`}
        />
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,360px),1fr))] gap-3 p-0">
          {CHECKS.map((c) => (
            <li key={c.name} className="card flex flex-col gap-3 p-[22px]">
              <span className="font-mono text-xs font-semibold text-accent">{c.name.toUpperCase()}</span>
              <code className="block font-mono text-[13px] leading-normal text-ink-body [overflow-wrap:anywhere]">{c.command}</code>
              <p className="m-0 text-sm leading-[1.55] text-ink-2">{c.body}</p>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium">
          <a href="/skill.md">
            Read /skill.md
            <span aria-hidden="true"> →</span>
          </a>
          <a href="#reasons">
            See the {refusals} refusals
            <span aria-hidden="true"> ↑</span>
          </a>
          <a href={`${SITE.repoUrl}/tree/main/skills/${SKILL}`}>
            The skill on GitHub
            <span aria-hidden="true"> ↗</span>
          </a>
        </div>
      </div>
    </section>
  );
}
