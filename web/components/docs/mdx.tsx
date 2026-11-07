import { Step, Steps } from "fumadocs-ui/components/steps";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import type { ComponentProps } from "react";
import { pageExists } from "@/lib/docs-source";
import { docsSlug } from "@/lib/docs/links";
import { Callout } from "./Callout";
import { EventSignature, ForkLedger, MandateTable, ReasonTable, RouterCards } from "./content";
import { Architecture, DecisionLoop, MarketWeek, TimelockFlow, TreasuryLoop } from "./diagrams";
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

/** Components available in every docs MDX page. */
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
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
    DecisionLoop,
    Architecture,
    TimelockFlow,
    TreasuryLoop,
    MarketWeek,
    ...components,
  };
}
