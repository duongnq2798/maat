/**
 * The team set of the /proof counting rule (inbox spec §5). A brief from one of these wallets counts on the Team
 * briefs line and never as an outside brief. The owner approves this list: an address is added or removed only in a
 * pull request the owner reviews. The rule's team set also takes in every wallet a team wallet funded within 2 hops;
 * nothing traces those hops yet, so such a wallet counts as a team wallet only once it is added here.
 *
 * Plain data with no import, so that `node scripts/recount.mjs` reads this file with Node's own type stripping and
 * counts by the same list as the page.
 */
export interface TeamWallet {
  /** 0x and 40 hex digits. */
  address: string;
  /** Why the wallet is on the team. */
  role: string;
}

export const PROOF_TEAM: readonly TeamWallet[] = [
  // At Base block 62,146,556 (2026-11-25) the vault's owner(), executor() and only payee, and the sender of the four
  // deploy transactions of deployments/README.md.
  { address: "0x3c3a66f713DAE7e4A03Bbd81dB79FF65F42C1D6a", role: "owner" },
  // The agent's executor wallet, which the owner hands the vault's executor role with setExecutor. At block 62,146,556
  // the vault's executor() still returned the owner.
  { address: "0x9bC6E49d42e0659f3ef667B09B67506B348e115A", role: "agent executor" },
];
