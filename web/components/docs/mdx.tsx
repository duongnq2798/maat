import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";

// <Fact /> is replaced with text at build time (lib/docs/remark-facts.ts). Reaching render means that plugin did not run.
function Fact({ name }: { name?: string }): never {
  throw new Error(`<Fact name="${name ?? ""}" /> reached render: remarkFacts is missing from source.config.ts`);
}

/** Components available in every docs MDX page. */
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return { ...defaultMdxComponents, Fact, ...components };
}
