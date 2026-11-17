import { Children, type ComponentProps, isValidElement, type ReactNode } from "react";
import { REASON_MEANING_DOCS, REASONS } from "@/content/reasons";
import { decisionEventSource, forkLedger, GROUP_OF, mandateTable } from "@/lib/docs/content-data";
import { READER_PATHS, type ReaderPath } from "@/lib/docs/reader-paths";
import { ScrollPre, ScrollRegion } from "./ScrollRegion";

export { READER_PATHS, type ReaderPath };

// Tables and cards the docs share with the landing page's data, so a page and the site never disagree. The rows
// and captions come from lib/docs/content-data.ts, which the Markdown copies of the pages print too. MarkdownTable
// holds the tables the pages write in Markdown; it is here, not in mdx.tsx, so a unit test renders it without mocking
// lib/docs-source, which mdx.tsx imports.

/**
 * A table that scrolls inside its own region on small screens, never the page; the region is a tab stop only while it
 * scrolls (ScrollRegion.tsx).
 */
function ScrollTable({ label, caption, children }: { label: string; caption?: string; children: ReactNode }) {
  return (
    <figure className="my-6">
      <ScrollRegion label={label} className="relative overflow-x-auto">
        <table className="my-0">{children}</table>
      </ScrollRegion>
      {caption ? <figcaption className="mt-2 text-sm text-fd-muted-foreground">{caption}</figcaption> : null}
    </figure>
  );
}

/** The text a node renders: its strings and numbers, and the text of each element's children. */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") return String(node);
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return Array.isArray(node) ? node.map(textOf).join("") : "";
}

/** The text of each header cell of a table, in order. MDX hands a Markdown table's cells over as plain `th` and `td`. */
function headerCells(node: ReactNode): string[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return [];
    if (child.type === "th") return [textOf(child.props.children).trim()];
    return child.type === "td" ? [] : headerCells(child.props.children);
  });
}

/**
 * A Markdown table, in place of Fumadocs' own, whose box is always a tab stop. It scrolls inside its own region on small
 * screens, never the page, and is a tab stop, named by its column headers, only once the page has measured it wider
 * than its box; until then, and without JavaScript, it is one (ScrollRegion.tsx). The classes are Fumadocs' own, and
 * prose-no-margin is how e2e/docs.spec.ts tells this region from a reference block's, so it checks a table's links.
 */
export function MarkdownTable(props: ComponentProps<"table">) {
  const headers = headerCells(props.children).filter((h) => h !== "");
  const label = headers.length > 0 ? `Table: ${headers.join(", ")}` : "Table";
  return (
    <ScrollRegion label={label} className="relative my-6 overflow-auto prose-no-margin">
      <table {...props} />
    </ScrollRegion>
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
    // A tab stop only while it is wider than the column (ScrollRegion.tsx).
    <ScrollPre
      label={`${name} event declaration`}
      className="not-prose my-4 overflow-x-auto rounded-lg border border-fd-border bg-fd-muted px-4 py-3 font-mono text-[13px] leading-6 text-fd-foreground"
    >
      <code>{source}</code>
    </ScrollPre>
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
