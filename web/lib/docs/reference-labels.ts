import type { AgentEnvVar } from "./docs-data";
import type { Mutability, SolFunction } from "./sol-surface";

// Relative imports only: source.config.ts loads this file through the fumadocs-mdx bundler, outside Next.

// The words of the reference entries. components/docs/reference.tsx shows them; lib/docs/component-text.ts prints
// the same words in the Markdown copies.

const MUTABILITY_LABEL: Readonly<Record<Mutability, string>> = {
  view: "Read only",
  pure: "Read only",
  nonpayable: "Changes state",
  payable: "Changes state, takes ETH",
};

/** What a function does to state, then "Public state" for a getter: the words <Fn> and <FunctionIndex> both use. */
export function kindLabels(f: SolFunction): string[] {
  return f.kind === "getter" ? [MUTABILITY_LABEL[f.mutability], "Public state"] : [MUTABILITY_LABEL[f.mutability]];
}

/** Who reads a setting, for the settings table. */
export const READ_BY = { agent: "Agent config", sdk: "SDK" } as const;

/** Whether a setting is required, in the settings table. */
export function requiredLabel(v: AgentEnvVar): string {
  return v.required ? "Yes" : v.requiredInLive ? "In live mode" : "No";
}

/** Whether a setting is required, on its own entry. */
export function requiredDetail(v: AgentEnvVar): string {
  return v.required ? "Yes, in every mode" : v.requiredInLive ? "In live mode" : "No";
}

/** What reads a setting, on its own entry. */
export function readByDetail(v: AgentEnvVar): string {
  return v.readBy === "agent" ? "agent/src/config.ts" : "the SDK that uses it, not agent/src/config.ts";
}

/** The default column when a setting has none. */
export const NO_DEFAULT = "None";

/** The .env.example column when a setting's line is empty. */
export const NO_EXAMPLE = "Empty: set your own";
