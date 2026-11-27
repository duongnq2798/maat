/**
 * How long after a round's note a Decision still belongs to that round. The agent writes the round's run row, with its
 * summary, before it sends the intents the round proposes, and Base includes them within seconds: on 2026-11-27 the
 * run row of journal line 20 is at 15:15:39 UTC and the round's last intent at 15:15:47. A Decision more than five
 * minutes after the note came from a later round, or from the owner.
 */
export const NOTE_ROUND_SEC = 300;

/**
 * Whether the vault's latest Decision is newer than the round the note sums up (review of PR #105): the landing then
 * shows no quote from that round, since it may say "I proposed nothing" beside a card that shows a buy. `noteTs` and
 * `decisionTs` are unix seconds; a Decision whose time was not read is never counted newer.
 */
export function noteSuperseded(noteTs: number, decisionTs: number | null): boolean {
  return decisionTs !== null && decisionTs > noteTs + NOTE_ROUND_SEC;
}
