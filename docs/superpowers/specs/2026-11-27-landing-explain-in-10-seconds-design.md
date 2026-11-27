# Landing: explain Maat in 10 seconds, and show the film

Date: 2026-11-27. Status: design A approved by the owner on 2026-11-27. Evidence: a cold read of maatonbase.xyz by five
first-time-visitor personas (a Base hackathon judge, a DeFi skeptic from X, a retail investor, a Base developer, a phone
reader from an X post), each with a 5-second, 30-second and 3-minute test, at 1440x900 and 390x844.

## Problem

The landing proves a lot and explains little. All five readers had the same gaps:

1. Nothing in the first screen says what Maat is or who it is for. The clearest definition is in `/docs`. On a phone the
   lead ("Claude proposes every move. An onchain mandate weighs it...") is a full screen down, and "mandate" is never
   defined.
2. The first screen is full of unexplained terms: "All 13 B20s", the "c" in GOOGLc, "143 bps / 100 bps" with no label,
   "Fork replay", "HOLD / REFRESH", "gas 120,814", "READ TO BLOCK".
3. Three live widgets in the hero (the VaultPlate pill, the LiveStrip, the VaultCard) repeat each other, and with the
   market open they disagree: the strip says PREMIUM_TOO_HIGH now, the card shows the Thanksgiving refusal from hours ago,
   and the Problem chart one screen down shows a fork reading.
4. The line every reader liked best, "Tokenized stocks trade 24/7. Their prices don't.", starts on screen 2 (screen 3 on a
   phone).
5. Mainnet, fork and simulated data are mixed without labels ("is this table real or fake?").
6. Small numbers with no framing ($4.68, "Last Decision 12 h ago", "owner, by hand") read as a dormant project.
7. The middle of the page is reference material (the Solidity event, 19 codes, the mandate table, the planned treasury
   loop) before the builder section, which sits at about 80% of the page.
8. There is nothing to watch.

## Goals

- A first-time visitor can say what Maat is, who it is for and why it matters from the first screen, on desktop and phone.
- One live proof in the hero, not three, and it never contradicts itself.
- The 100 s film is on the landing without breaking the site's privacy claims ("no analytics and no cookies", "this site
  has no server": nothing loads from a third party until the visitor clicks a link).
- Every fork or simulated number is labelled as such.

Non-goals: a new interactive walkthrough (option C, later), new pages, changing the contracts or the agent, changing the
H1, the mechanism line "Claude proposes. The vault decides.", the brand lexicon, or the `/proof` section 5 sentence
(owner-locked; never edited).

## Design

### 1. Hero

- Keep the H1 "The AI agent that knows when not to trade." and its styles.
- Directly under the H1, one definition sentence (lexicon-checked):
  "Maat is a vault on Base. Maat's agent proposes trades in tokenized US stocks; the vault checks each one against public
  rules and records yes or no onchain."
- Then three plain steps in one row (a list, no icons needed): "1 Maat's agent proposes a trade · 2 The vault checks 9
  public rules · 3 Yes or no is recorded on Base". They link to `#how`.
- One live proof: the VaultCard keeps the latest mainnet Decision with its verdict and Basescan link. The LiveStrip's
  reading becomes one labelled line inside the hero ("Right now, a buy would be: Refused · Market closed" with its block
  and a "Read again" control); the per-token row stays on `/now`. The VaultPlate pill above the H1 is removed. When the
  live line and the latest Decision differ, each says its own time ("now" vs the Decision's date), so they never read as
  one claim.
- Under the card, the newest round summary of Maat's agent from the public journal (the same verified note `/now` shows),
  so a quiet day reads as a choice ("...so I proposed nothing this round"), not as a dead project.
- CTAs, in order: "Watch the film (1:40)" (to `#film`) and "Try to make it say no" (to `#try`). "Verify it in 5 minutes
  ->" stays as a text link.
- The spec plate (9 checks, 19 typed refusals, 24 h timelock) stays.

### 2. Film band (`#film`), directly under the hero

- `<video controls preload="none" playsinline poster=...>` with the 16:9 cut re-encoded to 720p H.264 (target 5-6 MB),
  served from `web/public/film/`. No autoplay, no sound until the visitor presses play. A `<video poster>` is not an
  `<img>`, so the "uses no raster images" rule holds; the poster is a JPEG/WebP frame of the Thanksgiving refusal.
- Title "One trade, weighed · 1:40". Caption: "Thanksgiving night, Maat's agent proposed BUY GOOGLc. The vault refused
  it, on the record." Under it, word for word: "Voice and music: AI-generated with ElevenLabs".
- A plain text link "Watch on YouTube ->" rendered only when `FILM.youtubeUrl` (in `web/content`) is set; it is null
  until the owner uploads the film. No iframe and no click-to-load facade: nothing loads from Google until a click.
- The film's captions are burned in. A WebVTT `<track kind="captions">` built from `film/captions.json` is added for
  screen readers and search, off by default.
- The footer's "Watch it say no." gains a "Watch the film" link to `#film`.
- `film/README.md` is updated: the film now has a voice-over and music (ElevenLabs), with the disclosure line.

### 3. Page order and labels

- New order: Hero, Film, Problem, HowItWorks, AgentBuilders, TryIt, Refusals, Mandate, TreasuryLoop. BuiltOn moves to
  just above the footer (credibility, not explanation).
- The fork ledger section leaves the landing; `/ledger` already has the fork tab. The hero's "Fork replay" tab is renamed
  "Before mainnet (fork test)".
- Every fork or simulated number carries a small badge, "fork · 5-7 Nov" or "simulated", including the Problem charts.
- Refusals: the five groups show by default with their counts; "Show all 19" expands the codes. MARKET_CLOSED stays
  highlighted.

### 4. Copy fixes

- "All 13 B20s ->" becomes "All 13 tokenized stocks ->". The first time a ticker appears: "GOOGLc (Alphabet, a B20 token
  on Base)".
- bps always labelled: "pool vs Chainlink 143 bps · limit 100".
- "HOLD / REFRESH" become "Pause / Read again".
- The bar: "Unaudited." becomes "Unaudited · small treasury on purpose".
- "mandate" is defined once, where it first appears: "the mandate (the vault's public rule set)".
- "uiMultiplier 1.000537..." becomes "split multiplier 1.0005 (+0.05%)".
- Fix the clipped DECISION column of the fork table on phones and the empty band above "Watch it say no.".

## Constraints and tests

- No new third-party request on page load; `lib/check-out.ts` third-party checks stay green.
- Brand lexicon (`web/test/lexicon.test.ts`) and verdict grammar ("Refused · Market closed (MARKET_CLOSED)") hold for all
  new copy.
- Tests that pin the current hero and order change deliberately, each in the PR that changes the behaviour:
  `instrument-hero.test.tsx` (lead after `[data-live-strip]`), `e2e/instrument.spec.ts` (Readout in the first screen),
  `e2e/landing-mainnet.spec.ts` (largest text after the H1 is a verdict; fork only on the replay tab), `page.test.tsx`
  (in-page ids gain `film`; section order), `top.test.tsx` (hero copy, CTAs), `vault-decisions.test.tsx` (plate removed).
  New tests cover: the definition sentence and three steps in the first screen at 1440x900 and 390x844; the film band
  (no request to the video before play, `preload="none"`, poster, disclosure line, YouTube link only when set); fork
  badges; the Refusals "Show all" toggle; axe on every changed section.
- No horizontal scroll at 360 px. 44 px touch targets.

## Implementation plan

Three PRs, in order, each from the latest `main`, each reviewed adversarially before merge:

1. `feat/landing-explain-hero`: section 1 and section 4 (hero definition, three steps, one live proof with the labelled
   live line, the journal note, CTAs incl. `#film` placeholder target, copy fixes) with their test changes.
2. `feat/landing-film`: section 2 (film band, encoded asset and poster, VTT track, `FILM.youtubeUrl` null, footer link,
   `film/README.md`). The asset is the current v1 cut; the final cut after the Fri 27 Nov probe pair replaces the file in
   a one-file data PR.
3. `feat/landing-order-and-labels`: section 3 (order, fork ledger off the landing, fork badges, Refusals toggle, tab
   rename, phone table fix).

Done when all three are merged, CI is green, and a repeat cold read at 1440x900 and 390x844 can state what Maat is from
the first screen.
