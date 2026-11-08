// Relative imports only: source.config.ts loads this file through the fumadocs-mdx bundler, outside Next.
import agent from "../../content/generated/agent.json";
import addresses from "../../content/generated/base-addresses.json";
import contracts from "../../content/generated/contracts.json";
import type { AgentData, BaseConstant, DocsData } from "./docs-data";
import type { SolSurface } from "./sol-surface";

/** The committed output of `npm run docs:gen`; test/docs-gen.test.ts keeps it in sync with the sources. */
export const docsData: DocsData = {
  surface: contracts as SolSurface,
  addresses: addresses as readonly BaseConstant[],
  agent: agent as AgentData,
};
