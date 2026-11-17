import type { AgentEnvVar, Deployment } from "./docs-data";
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

/** What a function does to state: a grouped <FunctionIndex> says only this, since its groups say who calls and what is state. */
export function stateLabel(f: SolFunction): string {
  return MUTABILITY_LABEL[f.mutability];
}

/** What a function does to state, then "Public state" for a getter: the words <Fn> and <FunctionIndex> both use. */
export function kindLabels(f: SolFunction): string[] {
  return f.kind === "getter" ? [stateLabel(f), "Public state"] : [stateLabel(f)];
}

/** The label of a function's or an error's selector, and of an event's topic 0. */
export const SELECTOR = "Selector";
export const TOPIC0 = "Topic 0";

/** Leads a NatSpec comment the entry quotes from the source, so it does not read as the docs' own words. */
export const SOURCE_COMMENT = "Source comment:";

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

/** Where the owner records a deployment. docs-gen reads its first table into content/generated/deployments.json. */
export const DEPLOYMENTS_FILE = "deployments/README.md";

/** The deployments table's columns, as the table in DEPLOYMENTS_FILE heads them. */
export const DEPLOYMENT_HEAD = ["Network", "Contract", "Address", "Tx", "Date"] as const;

/** A full address, as Basescan links it: 0x and 40 hex digits. docs-gen accepts only this, or nothing, as an Address. */
export const FULL_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Whether a row of the table has an address. While none has, the deployments table is one sentence that says so. */
export const hasAddress = (d: Deployment) => d.address !== "";

/**
 * Whether Maat is deployed to Base mainnet: a Base mainnet row has a full address. The launch list in
 * test/docs-content.test.ts waits for this, so a row on another network or a placeholder starts nothing.
 */
export const isDeployed = (rows: readonly Deployment[]) => rows.some((d) => d.network === "Base mainnet" && FULL_ADDRESS.test(d.address));

/** What the deployments table says, around a link to DEPLOYMENTS_FILE, while no row has an address. */
export const NO_DEPLOYMENT = ["No Maat contract is deployed: no row of the table in ", " has an address."] as const;

/** The caption under the deployments table, around a link to DEPLOYMENTS_FILE. */
export const DEPLOYMENTS_CAPTION = ["From the table in ", "."] as const;

/** Where a deployment's address or transaction links on Basescan: only a full address or hash, on a Base mainnet row. */
export function deploymentHref(d: Deployment, cell: "address" | "tx"): string | null {
  if (d.network !== "Base mainnet") return null;
  if (cell === "address") return FULL_ADDRESS.test(d.address) ? `https://basescan.org/address/${d.address}` : null;
  return /^0x[0-9a-fA-F]{64}$/.test(d.tx) ? `https://basescan.org/tx/${d.tx}` : null;
}
