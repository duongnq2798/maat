/**
 * Hop stops of the /proof counting rule (inbox spec §5): addresses where the 2-hop funding trace of the team set stops,
 * such as pools, routers and exchange addresses. A stop is never on the team, and a wallet it funded is not traced. The
 * trace adds two stops itself: the zero address and the MandateVault of deployments/README.md. The owner adds a stop
 * here in a pull request, with the source that shows what the address is; the recount lists every stop with it.
 *
 * Plain data with no import, so that `node scripts/recount.mjs` reads this file with Node's own type stripping.
 */
export interface HopStopEntry {
  /** 0x and 40 hex digits. */
  address: string;
  /** What the address is, such as "Aerodrome router". */
  name: string;
  /** Where that is shown, as plain text: a URL or a file of this repository. */
  source: string;
}

export const PROOF_STOPS: readonly HopStopEntry[] = [];
