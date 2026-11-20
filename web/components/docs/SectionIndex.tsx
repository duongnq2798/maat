import type { Root } from "fumadocs-core/page-tree";
import { type SectionCard, sectionIndex } from "@/lib/docs/sections";

function Cards({ cards }: { cards: readonly SectionCard[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {cards.map((c) => (
        <li key={c.url} className="relative rounded-xl border border-fd-border bg-fd-card p-4 transition-colors hover:bg-fd-accent">
          <a href={c.url} className="inline-flex min-h-11 items-center font-medium text-fd-primary after:absolute after:inset-0">
            {c.title}
          </a>
          {c.description ? <p className="text-sm text-fd-muted-foreground">{c.description}</p> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * The pages of one docs section as cards, in sidebar order and under the sidebar's group names, from the same page tree
 * as the sidebar, so no page is listed by hand. With no section, the docs home's map: one card per section.
 */
export function SectionIndex({ tree, section = "" }: { tree: Root; section?: string }) {
  const groups = sectionIndex(tree, section);
  return (
    <div className="not-prose my-8 grid gap-8" data-section-index={section}>
      {groups.map((g, i) =>
        g.name ? (
          <section key={i}>
            <h2 className="mb-3 text-sm font-semibold text-fd-foreground">{g.name}</h2>
            <Cards cards={g.cards} />
          </section>
        ) : (
          <Cards key={i} cards={g.cards} />
        ),
      )}
    </div>
  );
}
