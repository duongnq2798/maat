import type { ReactNode } from "react";
import { decisionLabel, gasLabel, getDecisions, intentLabel } from "@/content/decisions";
import { FACTS } from "@/content/facts";
import { mandateRows } from "@/content/mandate";
import { REASON_GROUPS, REASON_MEANING, REASONS, type RefusalCode } from "@/content/reasons";
import { factFor } from "@/lib/docs/fact-text";

// Tables and cards the docs share with the landing page's data, so a page and the site never disagree.

/** A table that scrolls inside its own focusable region on small screens, never the page. */
function ScrollTable({ label, caption, children }: { label: string; caption?: string; children: ReactNode }) {
  return (
    <figure className="my-6">
      {/* tabIndex: a scrollable region must be reachable by keyboard (axe rule scrollable-region-focusable). */}
      <div className="relative overflow-x-auto" role="region" aria-label={label} tabIndex={0}>
        <table className="my-0">{children}</table>
      </div>
      {caption ? <figcaption className="mt-2 text-sm text-fd-muted-foreground">{caption}</figcaption> : null}
    </figure>
  );
}

const GROUP_OF = new Map<RefusalCode, string>(REASON_GROUPS.flatMap((g) => g.codes.map((c) => [c, g.title] as const)));

/** Every refusal code with its enum id (OK is 0), its group and what it means. */
export function ReasonTable() {
  return (
    <ScrollTable label="Refusal codes">
      <thead>
        <tr>
          <th>Code</th>
          <th>Id</th>
          <th>Group</th>
          <th>Meaning</th>
        </tr>
      </thead>
      <tbody>
        {REASONS.map((code, i) => (
          <tr key={code}>
            <td>
              <a href={`/docs/concepts/refusal-codes#${code.toLowerCase()}`}><code>{code}</code></a>
            </td>
            <td>{i + 1}</td>
            <td>{GROUP_OF.get(code)}</td>
            <td>{REASON_MEANING[code]}</td>
          </tr>
        ))}
      </tbody>
    </ScrollTable>
  );
}

/** The default mandate, the same rows the landing page shows. */
export function MandateTable() {
  return (
    <ScrollTable label="Default mandate" caption="Set in contracts/script/MaatConfig.sol and deployed by contracts/script/Deploy.s.sol.">
      <thead>
        <tr>
          <th>Setting</th>
          <th>Field</th>
          <th>Default</th>
        </tr>
      </thead>
      <tbody>
        {mandateRows(FACTS.mandate.value).map((r) => (
          <tr key={r.k}>
            <td>{r.label}</td>
            <td><code>{r.k}</code></td>
            <td>{r.v}</td>
          </tr>
        ))}
      </tbody>
    </ScrollTable>
  );
}

/** The Decision event as declared in contracts/src/IMandateVaultEvents.sol (parity-tested in test/facts.test.ts). */
export function EventSignature({ name }: { name: string }) {
  if (name !== "Decision") throw new Error(`<EventSignature name="${name}" />: only Decision is in FACTS; use <EventEntry> on reference pages`);
  const params = FACTS.decisionEvent.value.map((p) => [p.type, p.indexed ? "indexed" : "", p.name].filter(Boolean).join(" "));
  return (
    <pre className="not-prose my-4 overflow-x-auto rounded-lg border border-fd-border bg-fd-muted px-4 py-3 font-mono text-[13px] leading-6 text-fd-foreground">
      <code>{`event Decision(\n  ${params.join(",\n  ")}\n)`}</code>
    </pre>
  );
}

/** The decisions the agent made in the fork run, as the landing page's ledger shows them. */
export function ForkLedger() {
  return (
    <ScrollTable
      label="Decisions from the fork run"
      caption={`Base mainnet fork at block ${factFor("forkBlock").text}, recorded by agent/test/integration/agent.fork.test.ts.`}
    >
      <thead>
        <tr>
          <th>Time (ET)</th>
          <th>Intent</th>
          <th>Decision</th>
          <th>Gas</th>
          <th>Note</th>
        </tr>
      </thead>
      <tbody>
        {getDecisions().map((r) => (
          <tr key={`${r.timeLabel} ${intentLabel(r)}`}>
            <td>{r.timeLabel}</td>
            <td>{intentLabel(r)}</td>
            <td><code>{decisionLabel(r)}</code></td>
            <td>{gasLabel(r)}</td>
            <td>{r.note}</td>
          </tr>
        ))}
      </tbody>
    </ScrollTable>
  );
}

export interface ReaderPath {
  readonly reader: string;
  readonly want: string;
  /** Docs slug of the first page, as in content/docs. */
  readonly slug: string;
  readonly cta: string;
}

/** One path per reader in the docs spec §1, each naming its first page. */
export const READER_PATHS: readonly ReaderPath[] = [
  { reader: "New to Maat", want: "Know what it is and why it matters.", slug: "get-started/what-is-maat", cta: "What is Maat" },
  { reader: "Watching the agent", want: "Understand a decision you saw on X or on the site.", slug: "get-started/read-a-decision", cta: "Read a decision" },
  { reader: "Developer or judge", want: "Verify the claims and read the code.", slug: "get-started/quickstart", cta: "Verify it in five minutes" },
  { reader: "Builder", want: "Run your own vault and agent.", slug: "guides/deploy-your-own-vault", cta: "Deploy your own vault" },
  { reader: "Evaluator or partner", want: "Decide whether to trust it or build on it.", slug: "security/model", cta: "Security model" },
];

/** The docs home router. A path whose page has not shipped yet shows without a link, never as a dead one. */
export function RouterCards({ exists }: { exists: (slug: string) => boolean }) {
  return (
    <ul aria-label="Where to start" className="not-prose my-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {READER_PATHS.map((p) => {
        const live = exists(p.slug);
        return (
          <li key={p.slug} className="relative rounded-xl border border-fd-border bg-fd-card p-4 transition-colors hover:bg-fd-accent">
            <p className="text-xs font-medium uppercase tracking-wide text-fd-muted-foreground">{p.reader}</p>
            <p className="mt-1 text-sm text-fd-card-foreground">{p.want}</p>
            {live ? (
              <a href={`/docs/${p.slug}`} className="mt-3 inline-flex min-h-11 items-center font-medium text-fd-primary after:absolute after:inset-0">
                {p.cta} →
              </a>
            ) : (
              <p className="mt-3 flex min-h-11 items-center font-medium text-fd-muted-foreground">{p.cta} (coming soon)</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
