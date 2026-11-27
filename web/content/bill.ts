/**
 * How a PAY_EXPENSE reads, in the same words on the landing and on the Weighing card: as a bill, never as a trade.
 * "Compute bill" only when the Decision's own calldata carries a maat:v1 blob of kind "bill" whose keccak256 the
 * Decision logged as its rationaleHash, the blob the agent's code writes for its Claude bill
 * (docs/superpowers/specs/2026-11-25-maat-v1-rationale-blob-design.md, key `k`); any other payment is an "Expense".
 */
export type BillName = "Compute bill" | "Expense";

export interface Bill {
  name: BillName;
  /** The USDC amount as written, "$1.00". */
  amount: string;
  /** The Decision's `allowed`: the vault paid it. */
  allowed: boolean;
  /** The intent's payee, or null when it was not read. */
  payee: string | null;
  /** The vault's owner(), or null when it was not read. */
  owner: string | null;
}

/** "0x3c3a…1D6a", as the address is written. */
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * "Compute bill paid · $1.00 · to the owner's allowlisted address". The vault pays only a payee on its allowlist
 * (MandateVault._checkExpense returns PAYEE_NOT_ALLOWED otherwise), so a paid bill's payee is allowlisted; it is called
 * the owner's only when the owner was read and is that address. A refused one reads "Compute bill not paid · $1.00".
 */
export function billLine(b: Bill): string {
  if (!b.allowed) return `${b.name} not paid · ${b.amount}`;
  const to =
    b.payee === null
      ? "payee not read"
      : b.owner !== null && b.payee.toLowerCase() === b.owner.toLowerCase()
        ? "to the owner's allowlisted address"
        : `to the allowlisted address ${short(b.payee)}`;
  return `${b.name} paid · ${b.amount} · ${to}`;
}
