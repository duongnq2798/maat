/**
 * The owner's hide-list for /ask: ids of briefs whose text is abusive. A hidden brief is left out of the feed only. It
 * still counts in the brief and wallet counters, and `/proof` lists it on its own line (inbox spec §5), so hiding never
 * changes a number. The owner adds an id here in a pull request; removing one shows that brief again.
 */
export const HIDDEN_BRIEFS: readonly number[] = [];
