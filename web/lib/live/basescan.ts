import { REASONS, type RefusalCode } from "../../content/reasons";

/** Basescan pages for what the live reader names, React-free so server and client components can both link them. */
export const basescanBlock = (n: bigint) => `https://basescan.org/block/${n}`;
export const basescanTx = (tx: string) => `https://basescan.org/tx/${tx}`;
export const basescanAddress = (address: string) => `https://basescan.org/address/${address}`;

/**
 * A Decision's transaction on Basescan, opened on its Logs tab, where the Decision log shows allowed and reason. The
 * vault logs a refusal instead of reverting, so the transaction's own first screen reads "Success" either way. Only
 * Decision links take the tab: a deploy or a setExecutor has no verdict to show.
 */
export const basescanDecision = (tx: string) => `${basescanTx(tx)}#eventlog`;

/** Said beside a refused Decision's Basescan link where there is room, so "Success" there does not read as allowed. */
export function basescanRefusalNote(reason: RefusalCode): string {
  return `Basescan shows Success: the vault logs a refusal (allowed=false, reason ${REASONS.indexOf(reason) + 1} = ${reason}) instead of reverting.`;
}
