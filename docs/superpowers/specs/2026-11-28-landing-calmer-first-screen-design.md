# Landing: a calmer first screen, and the vault's real answers under it

Date: 2026-11-28. Status: approved by the owner on 2026-11-28 ("Làm PR đó"), after a side-by-side review of
atropyle.xyz and maatonbase.xyz at 1440x900 and 390x844. It builds on
[2026-11-27, landing "explain in 10 seconds"](2026-11-27-landing-explain-in-10-seconds-design.md) and changes two of
its points, named below. Everything else in that spec still holds: the H1, the definition sentence, the audience line,
the three steps, the one live line, both CTAs and "Verify it in 5 minutes".

## What the review found

Atropyle reads calm because each screen carries one idea, and because right under its hero a visitor can tap a question
and get the product's own answer. Maat has the stronger material (a live line read from Base, real refusals with their
transactions, a simulator) but buries it: the first interactive proof is the sixth section, the hero's left column ends
in a third row of large numbers, and on a phone a black "View on GitHub" pill is the loudest thing in the bar (at 360 px
it pushes the bar to two rows, 125 px).

## Design

### 1. Hero

- The spec plate (9 checks per trade, 19 typed refusals, 24 h rule timelock) leaves the hero. It now closes section 2,
  under the vault's answers it explains. This changes 2026-11-27 section 1, "The spec plate stays."
- The left column gets a little more air: `gap-5` from `sm` (it was `gap-4`). The order and adjacency the cold read
  required are unchanged and still tested.

### 2. "On the record", right under the hero (`#record`)

- A white band between the hero and the film. This changes 2026-11-27 section 2, "Film band directly under the
  hero": the film now follows this block. The hero's first CTA still opens `#film`.
- Eyebrow "On the record", heading "Pick a moment. Read the vault's answer.", and a lead saying these happened on Base
  mainnet and link to their transactions.
- Three tabs, each a real Decision of the mainnet vault, the only three that tell the calendar's story end to end. Each
  tab reads the moment's weekday and time in New York over two or three words: "Thanksgiving", "Before close", "After
  close" ("before the bell" read as before the open).
  1. Thanksgiving night, Thu 26 Nov 21:14 ET: Claude's BUY GOOGLc $4.68, Refused · Market closed (MARKET_CLOSED), with
     Claude's own words from the transaction.
  2. 12:58, before the early close of Fri 27 Nov: a $1 probe, Allowed · All checks passed (OK).
  3. 13:01, after it: another $1 probe, of a different stock, Refused · Market closed (MARKET_CLOSED).
- Each panel shows: a "Base mainnet · block N" source plate, the intent, the time in New York, who sent it (a probe is
  named as one, in the engine card's words, never as Claude's), the verdict in the lexicon's grammar on the engine
  card's plates, the story, a bar of NYSE's regular day with the session the calendar allowed, a needle at the
  Decision's minute and a label that says the minute and "open" or "closed" in words (an early close ends the lit part
  square, so 12:58 and 13:01 never read as one picture), one sentence of what the calendar held, Claude's words when
  Claude proposed it, and "Open it on Basescan" with the short hash and, for a refusal, at every width, why Basescan
  reads "Success". From `lg` the answer and the way to the transaction share the left column and the why fills the
  right one; on a phone they stack in that order.
- Under the tabs: "Every Decision, on the ledger" (`/ledger`), "Price, size and the other checks: try the simulator"
  (`#try`), and the spec plate.
- Why only these three: up to block 63,206,748 (28 Nov 02:08 UTC) the vault had refused only for `MARKET_CLOSED`. Price
  drift, size caps and stale feeds have no mainnet refusal yet, so the block links to the simulator for them instead of
  showing a simulated answer next to real ones.

Truth rules:
- No number is typed by hand without a test that holds it to its source. `test/on-the-record.test.tsx`:
  - decodes the committed snapshot of the vault's logs (`content/generated/decisions-snapshot.json`) with the site's own
    decoder and holds each moment's block, intent, symbol, amount, verdict and reason to its Decision log;
  - holds each timestamp to the README's table of every Decision (block and UTC time, to the second), its table of the
    story's Decisions and its `isOpen` proof (the values were read with `eth_getBlockByNumber` on mainnet.base.org);
  - decodes each transaction's calldata, copied from Base into `test/fixtures/record-inputs.json`, and holds the
    maat:v1 blob's hash to the rationaleHash the vault logged; from that blob it holds who sent each moment (Claude's
    words for the holiday, a probe's for the other two, as `film/txs.json` also says), the quote, and the holiday
    story's figures (0% against a 23.3% target, a fresh price inside the premium cap, $4.68 under a tenth of the cap);
  - holds each verdict, and every minute a story counts ("two minutes before the close", "three minutes later", "a
    Friday that ended at 13:00"), to the site's calendar (`regularSession`, the contract's `isOpen` in its order), and
    holds that no story calls the two probes the same trade.
- The bar and its sentence come from `content/calendar.ts`, not from copy.
- Nothing in the block reads Base, so it adds no request on load. Only the open moment is drawn: the static HTML holds
  the first moment and the empty shells of the other two, so a reader without JavaScript gets the first, and the landing
  pays for one panel, not three. The block below the card moves when a taller moment opens; that move is the result of
  the visitor's own tap, and nothing moves on load.
- The block does not say "mandate" (How it works defines it where the page first says it), has no full hash in its text,
  and no uppercase "REFUSE" in the static HTML.

### 3. Phone header

- The "View on GitHub" pill shows from 721 px only. Below that, the phone menu ends on the same link, under the Pages
  list, so the bar holds the wordmark and Menu alone, on one row even at 360 px. The menu panel anchors to the right
  edge, where Menu now sits.
- The bar's page links and the pill hide with `max-[721px]`, the exact pair of the Menu's `min-[721px]`; with
  `max-[720px]` both the links and the Menu showed at exactly 720 px.

## Tests

- Changed deliberately: the hero and spec plate tests (`instrument-hero`, `top`), the section order (`page.test`,
  `landing-mainnet` `#top + #record + #film`), the nav link lists (`top`, `instrument-nav-dock`, `now-page`,
  `gap-page`), and the phone Problem position in `landing-mainnet` if the new block moves it.
- New: `test/on-the-record.test.tsx` (data against the snapshot, the README, the calldata and the calendar; tabs,
  keyboard, bar geometry and words, static HTML; the spec plate's test moves here from the hero's) and
  `e2e/on-the-record.spec.ts` (at 360, 390, 430, 768 and 1440: placement, each tab label inside its tab, tap targets,
  click and arrow keys, the plate on one line, the bar inside its card, the Basescan note on every refusal, no sideways
  scroll, axe with no violation on each moment; at 320 the tab labels; and the first panel without JavaScript).
- `e2e/landing-mainnet.spec.ts` keeps the phone Problem guard it had (3,200 px) for everything above the Problem but the
  new block, and bounds the block itself, both measured once the fonts are in.
- `e2e/nav.spec.ts` adds: on a phone the bar is one row (at most 82 px).
