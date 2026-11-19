import { decisionLabel, gasLabel, getDecisions, intentLabel } from "../../content/decisions";
import { FACTS } from "../../content/facts";
import { mandateRows } from "../../content/mandate";
import { REASON_GROUPS, type RefusalCode } from "../../content/reasons";
import { factFor } from "./fact-text";

// Relative imports only: source.config.ts loads this file through the fumadocs-mdx bundler, outside Next.

// The tables the docs share with the landing page's data. components/docs/content.tsx shows them;
// lib/docs/component-text.ts prints the same rows in the Markdown copies.

/** The group (Hours, Prices, ...) each refusal code belongs to. */
export const GROUP_OF = new Map<RefusalCode, string>(REASON_GROUPS.flatMap((g) => g.codes.map((c) => [c, g.title] as const)));

export interface MandateTableData {
  readonly caption: string;
  readonly rows: readonly { readonly label: string; readonly field: string; readonly value: string }[];
}

/** The default mandate, the same rows the landing page shows. */
export function mandateTable(): MandateTableData {
  return {
    caption: "Set in contracts/script/MaatConfig.sol; contracts/script/Deploy.s.sol uses these values when the owner deploys.",
    rows: mandateRows(FACTS.mandate.value).map((r) => ({ label: r.label, field: r.k, value: r.v })),
  };
}

export interface ForkLedgerData {
  readonly caption: string;
  readonly rows: readonly { readonly time: string; readonly intent: string; readonly decision: string; readonly gas: string; readonly note?: string }[];
}

/** The decisions the agent made in the fork run, as the landing page's ledger shows them. */
export function forkLedger(): ForkLedgerData {
  return {
    caption: `Base mainnet fork at block ${factFor("forkBlock").text}, recorded by agent/test/integration/agent.fork.test.ts.`,
    rows: getDecisions().map((r) => ({
      time: r.timeLabel,
      intent: intentLabel(r),
      decision: decisionLabel(r),
      gas: gasLabel(r),
      note: r.note,
    })),
  };
}

/** The Decision event as declared in contracts/src/IMandateVaultEvents.sol (parity-tested in test/facts.test.ts). */
export function decisionEventSource(name: string): string {
  if (name !== "Decision") throw new Error(`<EventSignature name="${name}" />: only Decision is in FACTS; use <EventEntry> on reference pages`);
  const params = FACTS.decisionEvent.value.map((p) => [p.type, p.indexed ? "indexed" : "", p.name].filter(Boolean).join(" "));
  return `event Decision(\n  ${params.join(",\n  ")}\n)`;
}
