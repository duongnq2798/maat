/**
 * Bounty claimants (inbox spec §6), on their own /proof line. The bounty is only for a reproduced vault false ALLOW:
 * an intent outside the published mandate that `previewIntent` or `execute` on the live vault allows, shown with a
 * free `previewIntent` call or a fork test, so no brief is needed to claim it. The owner adds a claimant here in a pull
 * request once the claim is reproduced. A claimant is never added to a brief count.
 *
 * Plain data with no import, so that `node scripts/recount.mjs` reads this file with Node's own type stripping.
 */
export interface BountyClaim {
  /** The claimant's wallet: 0x and 40 hex digits. */
  address: string;
  /** Where the reproduction is, as plain text: the URL of its issue or pull request. */
  evidence: string;
}

export const PROOF_BOUNTY: readonly BountyClaim[] = [];
