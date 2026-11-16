import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import { Step, Steps } from "fumadocs-ui/components/steps";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import type { ComponentProps, HTMLAttributes } from "react";
import { pageExists, source } from "@/lib/docs-source";
import { excerptHref } from "@/lib/docs/content-checks";
import { docsSlug } from "@/lib/docs/links";
import { SITE } from "@/lib/site";
import { Callout } from "./Callout";
import { EventSignature, ForkLedger, MandateTable, ReasonTable, RouterCards } from "./content";
import { Architecture, DecisionLoop, MarketWeek, TimelockFlow, TreasuryLoop } from "./diagrams";
import {
  AddressTable,
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

/**
 * A link to a docs page that is in the IA but not written yet renders as plain text until the page ships, so
 * no build ever ships a dead docs link. test/docs-content.test.ts still fails on a link outside the IA.
 */
function DocsLink(props: ComponentProps<"a">) {
  const slug = props.href ? docsSlug(props.href) : null;
  if (slug && !pageExists(slug.join("/"))) return <span>{props.children}</span>;
  return <BaseLink {...props} />;
}

/**
 * Fumadocs' code block, with an excerpt's title (contracts/src/GuardLib.sol#L44-L62) linked to those lines on main: the
 * range the excerpt gate in test/docs-content.test.ts compares with the file. Any other title stays text.
 */
function CodeBlockPre({ title, ...props }: HTMLAttributes<HTMLPreElement>) {
  const href = title ? excerptHref(title, SITE.repoUrl) : null;
  return (
    <CodeBlock
      {...props}
      title={
        href ? (
          // The full height of the title bar, and a ring drawn inside the link: the caption clips anything outside it.
          <a
            href={href}
            className="block truncate rounded-sm leading-9.5 text-fd-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-fd-ring focus-visible:outline-none focus-visible:ring-inset"
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
    MarketWeek,
    AddressTable,
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
