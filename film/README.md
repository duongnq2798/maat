# Film

The demo film: 100 seconds, no voice and no sound (the audio track is silent), captions burned in, in two cuts, 16:9
(1920x1080) and 9:16 (1080x1920). It is built only from the live site, [maatonbase.xyz](https://maatonbase.xyz), which
Playwright opens read-only, from Base mainnet transactions shown as text beside a Basescan link card, and from the
published agent journal. ffmpeg assembles it. Nothing here signs, sends or uploads anything.

It opens on the title card and closes on the end card, and both draw the mark of `web/brand/src/mark.svg`, so the
first and the last frame show it: the cut fades at the edges of each beat, but never on its first or last frame.

The render runs on a PC, never in CI: it needs Chromium, ffmpeg and the network. CI runs the unit tests of the beat
plan, the caption sources, the cards, the tx cards, the journal reader and the ffmpeg arguments, which need neither
ffmpeg nor the network, and one Playwright spec that lays the cards out in Chromium from local files.

## The beats

| # | Beat | Shots | Until its transactions exist |
| --- | --- | --- | --- |
| 1 | The frozen feed | title card: the mark, the positioning line, the mechanism line; `/gap-index`, the NVDAc panel of the 6 Nov window | |
| 2 | Claude proposes. The vault decides. | the landing's How it works; the owner's Basescan Decision clip, or the landing's refusal codes without it | |
| 3 | The brief and the approved mandate | `/ledger`, the mandate the vault holds | shows the timelock line until the vault's cap equals the reserve cap |
| 4 | The sourced proposal and its hash tick | `/ledger`, the decision trail with its hash tick; the owner's Basescan input clip, or `/ledger`'s verify-by-hand commands without it | |
| 5 | Thanksgiving: `MARKET_CLOSED` from the agent | the simulator on Thanksgiving; the tx card | placeholder card |
| 6 | The early-close pair | the simulator after the early close; the two tx cards | placeholder cards |
| 7 | A stranger's brief and the vault's answer | `/ask` under the invitation line; one card: an outside wallet's brief, Maat's agent's reply from the published journal, then the vault's verdict on the intent that adopted the brief | the two tx cards labelled PLACEHOLDER; `/ask`'s caption says the inbox opens once it is on Base |
| 8 | Receipts | the deployed contracts; the README's CI figures; `/proof`; the end card: the mark, the sign-off, the short myth line, the builder line | |

`lib/beats.mjs` holds the plan: every shot, its length, its page steps and its caption cues. The end card holds 6 s, so
its lines can be read, and beat 7's card 11.5 s, since no card has more to read; How it works, the decision trail, the
two simulator shots and both clip slots are kept short for it, so the cut lasts 100 s. No caption reads faster than 25
characters a second (`READ_PACE` in `lib/cards.mjs`, about the pace of the CI caption):
`web/test/film-identity.test.ts` checks each one, and the capture warns when a caption with the numbers it read, or
beat 7's card with its brief, reply, verdict and caption, would go faster. A page shot's scroll stops before the site's
footer enters the frame, so its display line never sits behind a caption (`scrollGoal` in `lib/beats.mjs`), and the
capture warns if a shot still ends with the footer in the frame.

## The title and end cards

They carry Maat's identity, in the words of the culture plan's phrase table (`LINES` in `lib/cards.mjs`), each word
for word:

| Card | What it shows |
| --- | --- |
| Title | The mark and "maat"; "The AI agent that knows when not to trade."; "Claude proposes. The vault decides." |
| End | The mark and "maat"; "Every trade is weighed."; "Named for Ma'at, whose feather every heart was weighed against. Here the feather is the mandate."; "Built by one developer with Claude Code."; `maatonbase.xyz`, the repository and @maatonbase; the footer "Own treasury only. No investment advice. Not offered to US persons." |

The capture reads the mark from `web/brand/src/mark.svg` and draws it as it is; a card asked to draw without it stops
the render. The cards use the site's colours and its Geist type only, and balance the lines of each text, and of each
caption, so none ends on one word alone (`web/e2e/film-cards.spec.ts` measures it in both cuts). `web/test/film-identity.test.ts` checks the
lines, the mark, the first and last shots and the silent track, and that every caption that says who proposes and who
decides says the mechanism line word for word.

## Files

| File | What it is |
| --- | --- |
| `render.mjs` | The one command: `capture.mjs`, then `assemble.mjs` |
| `capture.mjs` | Opens each page with Playwright at each cut's viewport (16:9 at 1920x1080; 9:16 at 540x960 with a pixel ratio of 2, the site's phone layout) and screenshots every frame of each scroll; renders the cards and the caption overlays; reads the tx receipts; writes `work/manifest.json` |
| `assemble.mjs` | Runs ffmpeg: one H.264 segment per shot with its captions burned in, then the segments joined, with a silent audio track |
| `captions.json` | Every caption. Each number in a caption is a `{placeholder}` |
| `txs.json` | The transactions of beats 5 to 7, by hash, and what each receipt must show |
| `input/` | Where the owner drops the two Basescan clips; git ignores everything in it but its README |
| `lib/` | The beat plan, the caption sources, the cards, the tx decoder, the journal reader (`journal.mjs`, beat 7's reply) and the ffmpeg argument builder |

## Commands

From the repository root, on Windows (Git Bash or PowerShell), macOS or Linux, with Node.js 24:

```bash
cd web && npm ci && npx playwright install chromium && cd ..   # once: Playwright comes from web/
ffmpeg -version && ffprobe -version                            # both must be on PATH
node film/render.mjs
```

It writes `film/out/maat-film-16x9.mp4`, `film/out/maat-film-9x16.mp4` and `film/out/report.json`, and prints each
cut's path, size and length (from ffprobe), the beats that still show a placeholder, which owner clips were used, and
any warning. git ignores `film/out/`. Options:

| Option | Default | What it does |
| --- | --- | --- |
| `--out <dir>` | `film/out` | Where the cuts, the report and the `work/` folder go |
| `--input <dir>` | `film/input` | Where the owner's clips are |
| `--formats <list>` | `wide,tall` | `wide` is 16:9, `tall` is 9:16 |
| `--site <url>` | `https://maatonbase.xyz` | The site to capture, for example a local `npm run dev` |

`node film/capture.mjs --work <dir>` and `node film/assemble.mjs --work <dir> --out <dir>` run the two halves alone,
for example to assemble again without capturing again.

The tests run with the website's unit tests (`npm test` in `web/`) and its Playwright tests (`npm run e2e`), or alone:

```bash
cd web && npx vitest run test/film-beats.test.ts test/film-captions.test.ts test/film-txcards.test.ts test/film-ffmpeg.test.ts test/film-identity.test.ts
cd web && npx playwright test e2e/film-cards.spec.ts --project=chromium
```

The Playwright spec opens no site: it writes the cards to local files and checks, in both cuts, that no caption the
shot can show covers a row of its card, with the longest content each card can hold (beat 7's card with the longest
brief the inbox takes and the longest reply the journal keeps), that the title and end cards fit the frame with the
mark drawn and no text on them ending on one word alone, and that no caption in `film/captions.json` ends on one word
alone either.

## Captions and their numbers

A caption never has a number typed into it. `captions.json` writes it as a placeholder, which `lib/sources.mjs` fills
at render time from:

| Placeholder | Read from |
| --- | --- |
| `gap.*` | `web/content/gap-index/edition-0.json`: NVDAc in the window that closed on Fri 6 Nov |
| `deployments.*` | the address table of `deployments/README.md` and its verification note |
| `readme.*` | the "Tested, in numbers" table of the root `README.md` |
| `reserve.*` | `RESERVE_CAP_BPS` in `contracts/script/QueueReserveCaps.s.sol` and the basket in `contracts/script/MaatConfig.sol` |
| `ledger.*` | the live `/ledger` page's mandate panel, read by the capture once the panel shows the onchain mandate; a cell it cannot read, or one tagged `configured` (the panel could not read the vault), stops the render |

`web/test/film-captions.test.ts` fails on a digit typed into a caption, on a placeholder no source fills, and when a
source no longer reads its file the way the test reads it. A change to one of those files flows into the next render.

Some captions show only while a condition holds, and another caption otherwise (`when` and `else` in `captions.json`):

| Caption | Shows when | Otherwise |
| --- | --- | --- |
| `mandate-reserve` | the vault's weight cap, as `/ledger` reads it, equals `RESERVE_CAP_BPS` | `mandate-timelock`, and the render warns |
| `brief-ask`, the invitation line | `deployments/README.md` has a Base mainnet `MaatInbox` row | `brief-ask-soon`, which says the inbox opens once it is on Base |
| `receipts-contracts` | the verification note under that table counts as many contracts as the table holds | `receipts-contracts-listed`, which claims no verification; the contracts card leaves the note out, and the render warns |

A tx shot of two transactions with only one hash set shows the real one and a placeholder card, under
`pair-partial`, a caption labelled PLACEHOLDER; the render warns.

The render also warns when the README's CI figures are more than 3 days older than the render (`CI_MAX_AGE_DAYS` in
`lib/sources.mjs`). Before the final render, refresh the "Tested, in numbers" table from a current CI run on `main`.

Before it assembles anything, the capture measures each card against each caption burned in over it, in both cuts,
and stops the render if a caption box would come within 16 px of the card's content (`overlapProblem` in
`lib/cards.mjs`), or a card's content within 16 px of the frame's bottom edge (`fitProblem`), captioned or not.

## Owner steps

1. **ffmpeg.** Install it if `ffmpeg -version` fails, for example with `winget install ffmpeg`, and open a new
   terminal. The v0 draft was rendered with ffmpeg 5.1.2.
2. **Two Basescan clips, by hand** (Basescan may block automated browsers). Record each as a 16:9 desktop screen
   recording of about 8 seconds; the film uses its first 5 seconds. Save them in `film/input/` under these names (any
   of `.mp4`, `.mov`, `.webm`, `.mkv`):
   - `basescan-decision-log`: a `Decision` event in the `MandateVault`'s Events tab, with its reason. Beat 2.
   - `basescan-input-utf8`: an agent Decision's input data viewed as UTF-8, showing the rationale. Beat 4. Record it
     once an agent Decision with a rationale blob is on Base.
   Without a clip, its beat shows a page of the site instead, for the same length.
3. **The transactions of beats 5 to 7.** When each is on Base mainnet, put its hash in `txs.json`:
   - `thanksgiving`: the agent's Decision refused with `MARKET_CLOSED` on Thu 26 Nov (New York date);
   - `earlyCloseAllowed` and `earlyCloseRefused`: the agent's Decisions on Fri 27 Nov, allowed before the 13:00 ET
     early close and refused with `MARKET_CLOSED` at or after it (not a refusal before the open);
   - `strangerBrief`: an outside wallet's `Brief` transaction to the inbox, once `deployments/README.md` records the
     `MaatInbox`. Pick a brief that `/proof` counts as an outside brief, and one that an intent adopted: Claude was
     persuaded, so the vault weighed it. `vaultAnswer`: the vault's Decision on that intent, the Decision `/ask` lists
     under the brief. Beat 7 shows Maat's agent's reply between the two, from the published journal (below). A brief
     Claude did not adopt has no verdict to show.
4. **Render, review, upload.** Refresh the root README's "Tested, in numbers" table from a current CI run on `main`,
   run `node film/render.mjs`, watch both cuts, then upload the 16:9 cut to Loom (a free account) on Wed 9 Dec.
   Uploads are the owner's: nothing in this folder posts anything.

## Render again once beats 5 to 7 exist

1. Put the hashes in `txs.json` (step 3 above).
2. Run `node film/render.mjs`. For each hash it reads the receipt from `https://mainnet.base.org` (then
   `https://base-rpc.publicnode.com`) and stops, naming the entry, if the tx reverted, has no event of the expected
   kind from the expected contract of `deployments/README.md` (`MandateVault` for a Decision, `MaatInbox` for a
   Brief), has another reason, falls on another New York date than `expect` says, or for the early-close pair falls
   on the wrong side of 13:00 ET (`etBefore`, `etFrom`). A hash it cannot read stops the render too: it never shows a
   row it did not read.
3. Check the printed summary: `placeholders: none` once all five hashes are set, and each placeholder caption replaced
   by the beat's own.

Once both of beat 7's hashes are set, the capture also reads the public `agent-journal` branch
(`https://raw.githubusercontent.com/duongnq2798/maat/agent-journal/journal/`, the files the site's `/ledger` reads),
checks every line's hash chain as the browser verifier does, and takes the `brief` row that names the brief by its id,
tx hash and log index. Its sanitized reply shows between the brief and the verdict, with its day file, line and row
hash, the git commit of the agent code that wrote the row ("agent commit", as `/ledger` labels it; it is not a commit
of the `agent-journal` branch), and "Claude persuaded: yes, adopted into an intent" from its `adopted` flag. While the
branch does not exist or has no row for the brief, the card says the reply is not in the journal yet, labelled NOT IN
THE JOURNAL YET, and the render warns. A branch it cannot read, or a line that does not verify, stops the render.

The card shows the brief, and the reply, as `/ask` does (`plainBriefText` in `web/lib/chain/inbox.ts`): every control,
format and other invisible code point as U+FFFD, so a brief cannot hide text, smuggle text in tag characters or
reorder what the viewer reads.

Before it shows the verdict as the vault's verdict on Maat's agent's answer, the capture checks the pair, and stops,
naming each problem, unless all of these hold (`persuasionProblems` in `lib/tx.mjs`, the rules of `/ledger`'s sender
label and `/ask`'s brief-to-Decision map):

- `vaultAnswer` is a direct `execute` call to the vault, which only the vault's executor can make, and its sender is
  not the vault's `owner()`, read with `eth_call`: an owner Decision is "owner, by hand", never Maat's agent's;
- its calldata, read with `eth_getTransactionByHash`, ends with a maat:v1 blob whose keccak256 is the Decision's
  `rationaleHash` and whose `q` names the brief's id: the intent adopted that brief ("brief-driven" on `/ledger`);
- it is in a later block than the brief;
- the brief's sender is not a team wallet: not in `web/content/proof-team.ts`, not the vault's owner and not the
  executor that sent the Decision. The film does not run `/proof`'s trace of the wallets those funded, so check on
  `/proof` that the brief counts as an outside brief before setting its hash;
- when the journal has the brief's row, its `adopted` flag is `true`.

The verdict step then says what ties it to the brief: "brief-driven, adopts brief #N", and "sent by" the executor.
