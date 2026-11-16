import type { ReactNode } from "react";
import { REASON_MEANING_DOCS, REASONS } from "@/content/reasons";
import { decisionEventSource, forkLedger, GROUP_OF, mandateTable } from "@/lib/docs/content-data";
import { READER_PATHS, type ReaderPath } from "@/lib/docs/reader-paths";

export { READER_PATHS, type ReaderPath };

// Tables and cards the docs share with the landing page's data, so a page and the site never disagree. The rows
// and captions come from lib/docs/content-data.ts, which the Markdown copies of the pages print too.

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
            <td>{REASON_MEANING_DOCS[code]}</td>
          </tr>
        ))}
      </tbody>
    </ScrollTable>
  );
}

/** The default mandate, the same rows the landing page shows. */
export function MandateTable() {
  const { caption, rows } = mandateTable();
  return (
    <ScrollTable label="Default mandate" caption={caption}>
      <thead>
        <tr>
          <th>Setting</th>
          <th>Field</th>
          <th>Default</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.field}>
            <td>{r.label}</td>
            <td><code>{r.field}</code></td>
            <td>{r.value}</td>
          </tr>
        ))}
      </tbody>
    </ScrollTable>
  );
}

/** The Decision event as declared in contracts/src/IMandateVaultEvents.sol (parity-tested in test/facts.test.ts). */
export function EventSignature({ name }: { name: string }) {
  const source = decisionEventSource(name);
  return (
    // tabIndex: a scrollable region must be reachable by keyboard (axe rule scrollable-region-focusable).
    <pre
      className="not-prose my-4 overflow-x-auto rounded-lg border border-fd-border bg-fd-muted px-4 py-3 font-mono text-[13px] leading-6 text-fd-foreground"
      tabIndex={0}
    >
      <code>{source}</code>
    </pre>
  );
}

/** The decisions the agent made in the fork run, as the landing page's ledger shows them. */
export function ForkLedger() {
  const { caption, rows } = forkLedger();
  return (
    <ScrollTable label="Decisions from the fork run" caption={caption}>
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
        {rows.map((r) => (
          <tr key={`${r.time} ${r.intent}`}>
            <td>{r.time}</td>
            <td>{r.intent}</td>
            <td><code>{r.decision}</code></td>
            <td>{r.gas}</td>
            <td>{r.note}</td>
          </tr>
        ))}
      </tbody>
    </ScrollTable>
  );
}

/** The docs home router. A path whose page has not shipped yet shows without a link, never as a dead one. */
export function RouterCards({ exists }: { exists: (slug: string) => boolean }) {
  return (
    <ul aria-label="Where to start" className="not-prose my-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {READER_PATHS.map((p) => {
        const live = exists(p.slug);
        // Hover feedback only on a card that is a link; each variant is a complete literal class string.
        const card = live
          ? "relative rounded-xl border border-fd-border bg-fd-card p-4 transition-colors hover:bg-fd-accent"
          : "relative rounded-xl border border-fd-border bg-fd-card p-4";
        return (
          <li key={p.slug} className={card}>
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
