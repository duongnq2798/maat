import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";

/** Components available in every docs MDX page. */
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return { ...defaultMdxComponents, ...components };
}
