import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import { Step, Steps } from "fumadocs-ui/components/steps";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { type ComponentProps, cache, type HTMLAttributes, type ReactNode } from "react";
import { pageExists, source } from "@/lib/docs-source";
import { excerptHref } from "@/lib/docs/content-checks";
import { GLOSSARY_URL, glossaryId, glossaryPreviews, previewRuns } from "@/lib/docs/glossary-preview";
import { docsSlug } from "@/lib/docs/links";
import { SITE } from "@/lib/site";
import { Callout } from "./Callout";
import { EventSignature, ForkLedger, MandateTable, ReasonTable, RouterCards } from "./content";
import { Architecture, DecisionLoop, HealthFactorScale, MarketWeek, MultiplierFlow, TimelockFlow, TreasuryLoop } from "./diagrams";
import { GlossaryTerm } from "./GlossaryTerm";
import {
  AddressTable,
  DeploymentTable,
  EnvTable,
  EnvVar,
  ErrorEntry,
  EventEntry,
  FactTable,
  Fn,
  FunctionIndex,
  ScriptEntry,
  ScriptFile,
  TypeEntry,
} from "./reference";
import { SectionIndex } from "./SectionIndex";
import { StatusBadge } from "./StatusBadge";

// <Fact /> is replaced with text at build time (lib/docs/remark-facts.ts). Reaching render means that plugin did not run.
function Fact({ name }: { name?: string }): never {
  throw new Error(`<Fact name="${name ?? ""}" /> reached render: remarkFacts is missing from source.config.ts`);
}

const BaseLink = defaultMdxComponents.a;

/** The glossary's previews as a term draws them, by entry: built once, and again only when the glossary changes. */
let glossary: { markdown: string; previews: ReadonlyMap<string, ReactNode> } | undefined;

async function glossaryPreview(id: string): Promise<ReactNode | undefined> {
  const page = source.getPage(docsSlug(GLOSSARY_URL) ?? []);
  const markdown = page ? await page.data.getText("processed") : "";
  if (glossary?.markdown !== markdown) {
    const previews = [...glossaryPreviews(markdown)].map(([entry, text]): [string, ReactNode] => [
      entry,
      previewRuns(text).map((run, i) => (run.code ? <code key={i}>{run.text}</code> : run.text)),
    ]);
    glossary = { markdown, previews: new Map(previews) };
  }
  return glossary.previews.get(id);
}

/**
 * The glossary entries whose preview the page being rendered has drawn: one set per page render. A page draws each
 * entry's preview once, beside its first link to the entry, and every later link names that one, so a page that links
 * an entry many times, as the glossary itself does, carries its text once.
 */
const drawnPreviews = cache(() => new Set<string>());

/** A link to a glossary entry, with the whole entry as its preview (components/docs/GlossaryTerm.tsx). */
async function GlossaryLink({ entry, ...props }: ComponentProps<"a"> & { entry: string }) {
  const drawn = drawnPreviews();
  const first = !drawn.has(entry);
  drawn.add(entry);
  const preview = await glossaryPreview(entry);
  if (preview === undefined) throw new Error(`${props.href ?? ""}: content/docs/help/glossary.mdx has no entry with this anchor`);
  return <GlossaryTerm {...props} previewId={`glossary-preview-${entry}`} preview={first ? preview : undefined} />;
}

/**
 * A link to a docs page that is in the IA but not written yet renders as plain text until the page ships, so
 * no build ever ships a dead docs link. test/docs-content.test.ts still fails on a link outside the IA. A link to a
 * glossary entry previews the entry. The Markdown copies keep it a plain link: they are printed from the source.
 */
function DocsLink(props: ComponentProps<"a">) {
  const slug = props.href ? docsSlug(props.href) : null;
  if (slug && !pageExists(slug.join("/"))) return <span>{props.children}</span>;
  const entry = props.href ? glossaryId(props.href) : null;
  if (entry !== null) return <GlossaryLink {...props} entry={entry} />;
  return <BaseLink {...props} />;
}

/**
 * Fumadocs' code block, with an excerpt's title (contracts/src/GuardLib.sol#L44-L62) linked to those lines on main: the
 * range the excerpt gate in test/docs-content.test.ts compares with the file. Any other title stays text.
 */
function CodeBlockPre({ title, className, ...props }: HTMLAttributes<HTMLPreElement>) {
  const href = title ? excerptHref(title, SITE.repoUrl) : null;
  return (
    <CodeBlock
      {...props}
      // Fumadocs fixes the title bar at h-9.5 (38 px). Below md the bar of a linked title grows to 44 px, a tap target.
      className={href ? `${className ?? ""} max-md:[&>div:has(>figcaption)]:h-11`.trim() : className}
      title={
        href ? (
          // The full height of the title bar, and a ring drawn inside the link: the caption clips anything outside it.
          <a
            href={href}
            className="block truncate rounded-sm leading-11 text-fd-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-fd-ring focus-visible:outline-none focus-visible:ring-inset md:leading-9.5"
          >
            {title}
          </a>
        ) : (
          title
        )
      }
    >
      <Pre>{props.children}</Pre>
    </CodeBlock>
  );
}

/** Components available in every docs MDX page. */
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    pre: CodeBlockPre,
    a: DocsLink,
    Fact,
    Callout,
    Steps,
    Step,
    StatusBadge,
    ReasonTable,
    MandateTable,
    EventSignature,
    ForkLedger,
    RouterCards: () => <RouterCards exists={pageExists} />,
    // The sidebar's own tree, so a section index lists what the sidebar shows.
    SectionIndex: ({ section }: { section?: string }) => <SectionIndex tree={source.getPageTree()} section={section} />,
    DecisionLoop,
    Architecture,
    TimelockFlow,
    TreasuryLoop,
    MultiplierFlow,
    HealthFactorScale,
    MarketWeek,
    AddressTable,
    DeploymentTable,
    EnvTable,
    EnvVar,
    ErrorEntry,
    EventEntry,
    FactTable,
    Fn,
    FunctionIndex,
    ScriptEntry,
    ScriptFile,
    TypeEntry,
    ...components,
  };
}
