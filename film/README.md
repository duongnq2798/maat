# Film

The demo film: 100 seconds, captions burned in, in two cuts, 16:9 (1920x1080) and 9:16 (1080x1920). Its picture is
built only from the live site, [maatonbase.xyz](https://maatonbase.xyz), which Playwright opens read-only, from Base
mainnet transactions shown as text beside a Basescan link card, and from the published agent journal. ffmpeg assembles
it. Nothing here signs, sends or uploads anything.

The film has a voice-over and music, both made with ElevenLabs: the narration with its text-to-speech, the score with
Eleven Music. They are mixed onto the picture after the render, outside this folder: this pipeline renders the picture
with a silent audio track, and `film/` holds no audio file (`web/test/film-identity.test.ts` checks both); it holds the
narration's words and times, in `narration.json`, for the landing's captions. The same step draws one more line on the
end card, under its disclaimer, from 93.9 s; the landing prints it under the player too:

> Voice and music: AI-generated with ElevenLabs

The landing serves the 16:9 cut itself ([On the landing](#on-the-landing)).

It opens on the title card and closes on the end card, and both draw the mark of `web/brand/src/mark.svg`, so the
first and the last frame show it: the cut fades at the edges of each beat, but never on its first or last frame.

The render runs on a PC, never in CI: it needs Chromium, ffmpeg and the network. CI runs the unit tests of the beat
plan, the caption sources, the cards, the tx cards, the journal reader and the ffmpeg arguments, which need neither
ffmpeg nor the network, and one Playwright spec that lays the cards out in Chromium from local files.

## The beats

| # | Beat | Shots | Until its transactions exist |
| --- | --- | --- | --- |
| 1 | The frozen feed | title card: the mark, the positioning line, the mechanism line, what Maat is; `/gap-index`, the NVDAc panel of the 6 Nov window | |
| 2 | Claude proposes. The vault decides. | the landing's How it works; the owner's Basescan Decision clip, or the landing's refusal codes without it | |
| 3 | The basket and the approved mandate | `/ledger`, the mandate the vault holds | shows the timelock line until the vault's cap equals the reserve cap |
| 4 | The sourced proposal and its hash tick | `/ledger`, the decision trail with its hash tick; the owner's Basescan input clip, or `/ledger`'s verify-by-hand commands without it | |
| 5 | Thanksgiving: `MARKET_CLOSED` from Maat's agent | the simulator on Thanksgiving; the tx card of Maat's agent's Decision on Thanksgiving | |
| 6 | The early-close probes | the simulator after the early close; the two tx cards of the probes sent before and after the 13:00 ET early close | placeholder cards |
| 7 | A stranger's brief and the vault's answer | `/ask` under the invitation line while it takes briefs; one card: an outside wallet's brief, Maat's agent's reply from the published journal, then the vault's verdict on the intent that adopted the brief | the two tx cards labelled PLACEHOLDER; while `/ask` is closed, its caption says the inbox is on Base and the invitation waits for `/ask` to open |
| 8 | Receipts | the deployed contracts; the README's CI figures under a dated heading; `/proof`; the end card: the mark, the sign-off, the short myth line, the builder line | |

`lib/beats.mjs` holds the plan: every shot, its length, its page steps and its caption cues. The title card holds 6 s
and the end card 6.5 s, the time their words take (`CARD_READING` in `lib/cards.mjs`); the decision trail, the one shot
with Claude's own words, holds 7.5 s; beat 7's card holds 11.5 s, since no card has more to read. How it works, the two
simulator shots and both clip slots are kept short, so the cut lasts 100 s. No caption, and neither card, reads faster
than 25 characters a second (`READ_PACE` in `lib/cards.mjs`): `web/test/film-identity.test.ts` checks each one, and the
capture warns when a caption with the numbers it read, or beat 7's card with its brief, reply, verdict and caption,
would go faster. A page shot's scroll stops before the site's footer enters the frame, so its display line never sits
behind a caption (`scrollGoal` in `lib/beats.mjs`), and the capture warns if a shot still ends with the footer in the
frame.

## The frame of a page shot

- **No reload between shots of one page.** A shot with `continue: true` goes on from where the page shot before it left
  the same page (the landing's How it works to its refusal codes, `/ledger`'s mandate to its decision trail to its
  verify-by-hand commands, the two simulator shots), so the page's top does not flash between them. The cards are
  rendered in a page of their own, so the site's page keeps its place.
- **No line cut at the top.** Each scroll stop moves by a few px so that no line of text is cut in two by the top edge,
  or by the desktop nav bar that stays there (`unsliceGoal` in `lib/beats.mjs`). The 16:9 offset also leaves room for
  the section label or tabs above a heading.
- **Nothing per viewer, nothing relative.** The capture adds a style (`FRAME_CSS` in `lib/frame.mjs`) that hides the
  landing's "Last Decision … ago" line and plate, `/ledger`'s "since your last look" line and "New" marks, the desktop
  nav's live readout (a block number and the market session), and the phone layout's bottom bar, and wraps code blocks
  so the 9:16 cut films a cast command whole.
- **Captions on an opaque box**, so the page under a caption cannot show through it. In 9:16 the box spans the frame
  less 8 px each side, over the phone layout's 16 px text gutter, so no cut glyph of the page shows beside it.
- **Per-format steps.** A scroll's target and `top` may differ per format (`{ wide, tall }`); a scroll given for one
  format only does not run in the other. A scroll with `over: 0` jumps before the shot's first frame and films none.
- **Kept clear.** A shot's `keepClear` names what its caption must not cover: the NVDAc chart on `/gap-index` (in 9:16
  the shot jumps to the NVDAc panel before its first frame, so the chart's drop sits above the caption and the first
  caption never opens over the page's heading), `/ask`'s form or its notice that the inbox is not open yet, and
  `/proof`'s six counts. The capture warns when the caption band would cover it at a scroll's stop.
- **`/proof` is filmed only once its counts are read** ("Counted to block …"), never while it is still reading. In 9:16
  the shot opens on that line, with the counts under it, instead of midway through the notes above them.

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
| `vtt.mjs` | Writes a cut's two text tracks as WebVTT from `work/manifest.json`, for the landing's player: the captions of the voice-over, from `narration.json`, and the on-screen text, its burned-in captions ([On the landing](#on-the-landing)) |
| `captions.json` | Every caption. Each number in a caption is a `{placeholder}` |
| `narration.json` | The voice-over, word for word, each line under the shot it is spoken over, with its times in that shot |
| `txs.json` | The transactions of beats 5 to 7, by hash, and what each receipt must show |
| `input/` | Where the owner drops the two Basescan clips; git ignores everything in it but its README |
| `lib/` | The beat plan, the caption sources, the cards, the frame style and measures (`frame.mjs`), the tx decoder, the journal reader (`journal.mjs`, beat 7's reply), the ffmpeg argument builder and the WebVTT writer (`vtt.mjs`) |

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
| `--final` | off | Stops before capturing while any transaction of beats 5 to 7 has no hash, so a final cut never shows a PLACEHOLDER card |

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
| `deployments.*` | the address table of `deployments/README.md`, the verification note under it and each later contract's own paragraph |
| `readme.*` | the "Tested, in numbers" table of the root `README.md` |
| `reserve.*` | `RESERVE_CAP_BPS` in `contracts/script/QueueReserveCaps.s.sol` and the basket in `contracts/script/MaatConfig.sol` |
| `ledger.*` | the live `/ledger` page's mandate panel, read by the capture once the panel shows the onchain mandate; a cell it cannot read, or one tagged `configured` (the panel could not read the vault), stops the render |
| `ask.open` | the live `/ask` page, read by the capture on beat 7's `/ask` shot; set only while the page takes briefs |

`web/test/film-captions.test.ts` fails on a digit typed into a caption, on a placeholder no source fills, and when a
source no longer reads its file the way the test reads it. A change to one of those files flows into the next render.

Some captions show only while a condition holds, and another caption otherwise (`when` and `else` in `captions.json`):

| Caption | Shows when | Otherwise |
| --- | --- | --- |
| `mandate-reserve` | the vault's weight cap, as `/ledger` reads it, equals `RESERVE_CAP_BPS` | `mandate-timelock`, and the render warns |
| `brief-ask`, the invitation line | the live `/ask` takes briefs: the capture finds its form, not its notice "The inbox is not open yet.", and the site's `/data/ask.json` (the owner's switch, `web/content/ask-open.ts`) says open, in both cuts (`askOpenValue` in `lib/sources.mjs`; the render warns when the two disagree) | `brief-ask-soon`: "The inbox contract is on Base. Once /ask opens, …", while `deployments/README.md` has a Base mainnet `MaatInbox` row; otherwise `brief-ask-later`, which says the inbox opens once it is on Base |
| `receipts-contracts`, with the day Basescan showed each contract verified | `deployments/README.md` gives that day for every Base mainnet row: the note under the table for the contracts it counts, the contract's own paragraph for a later one | `receipts-contracts-listed`, which claims no verification; the contracts card leaves the note out, and the render warns |

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
   - `thanksgiving`: Maat's agent's Decision refused with `MARKET_CLOSED` on Thu 26 Nov (New York date). Set:
     `0xca9e2dfe…bed6`, block 62,776,552, sent by the executor of Maat's agent;
   - `earlyCloseAllowed` and `earlyCloseRefused`: the two probes on Fri 27 Nov (`agent/src/probes.ts`: fixed-time
     intents that no Claude call wrote, with `k = "probe"` in their blob), allowed before the 13:00 ET early close and
     refused with `MARKET_CLOSED` at or after it (not a refusal before the open). The film calls them probes, never
     Decisions or proposals of Maat's agent;
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
   Brief), has another reason, was sent by someone else than `expect.sender` says, falls on another New York date than
   `expect` says, or for the early-close pair falls on the wrong side of 13:00 ET (`etBefore`, `etFrom`). A hash it
   cannot read stops the render too: it never shows a row it did not read.

   `sender` is required in every entry. For a Decision it is `/ledger`'s sender label, read from the tx's calldata
   (`eth_getTransactionByHash`) and the vault's `owner()` (`txSender` in `lib/tx.mjs`, held to `/ledger`'s
   `senderLabel` by a test): `owner, by hand` when the owner sent it; otherwise `probe` when its maat:v1 blob says
   `k = "probe"`, `brief-driven` when it adopts a brief, and `agent` for Maat's agent's own intent, each only from a
   direct `execute` call whose blob hashes to the Decision's `rationaleHash`. For a Brief it is `outside`, or `team`
   when a `/proof` team wallet or the vault's owner sent it. So a probe can never be shown as Claude's intent.
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

## On the landing

The landing's film band, `#film` under the hero after "On the record" (`web/components/sections/Film.tsx`, spec
2026-11-27 section 2, amended by spec 2026-11-28 section 2), plays the 16:9 cut from the site itself. Its four files are in `web/public/film/`:

| File | What it is |
| --- | --- |
| `maat-film-720p.mp4` | The 16:9 cut at 1280x720: H.264 High, CRF 26, 30 fps, AAC 128 kbps 48 kHz stereo, its index at the front of the file (`+faststart`) so it starts before it has loaded; 5,129,355 bytes |
| `maat-film-poster.webp` | The poster: the 9:16 cut's frame at 53.5 s, cropped to the tx card of Maat's agent's Thanksgiving Decision, its heading "Thanksgiving: MARKET_CLOSED from Maat's agent" and its rows down to "Refused · Market closed (MARKET_CLOSED)", at 1280x720; 51,962 bytes |
| `maat-film.en.vtt` | The captions track: the voice-over's 16 lines from `narration.json`, in 19 cues at the cut's times, on the top line of the picture, written by `vtt.mjs` |
| `maat-film.on-screen.en.vtt` | The on-screen text track: the cut's 18 burned-in captions, at the cut's times, written by `vtt.mjs` |

The player has `preload="none"` and no autoplay, so a visitor's browser fetches the poster on arrival and no byte of
the cut before play, and nothing on the band loads from a third party (`checkExport` in `web/lib/check-out.ts` and
`web/e2e/film.spec.ts` check both). `web/test/film-band.test.tsx` checks the four files: the cut's codec, size, weight
and index, the poster's size and weight, that the captions are what `vtt.mjs` writes from `narration.json` over the
beat plan's shots, and that every on-screen cue says the words of its caption in `captions.json`, with only the
placeholders filled.

### The two text tracks

Both are off by default, and the browser fetches neither until a viewer turns one on.

- **Captions** (`<track kind="captions">`, "English", the one the player's captions menu lists): the voice-over, the
  sound a viewer who cannot hear the film misses. The captions in the picture are burned in already, but the 16
  spoken lines are other words ("Maat's agent runs on Claude, and only proposes.", "On Basescan, a refusal reads
  Success."), so the track carries those, at the times the voice says them. Each cue sits on the top line of the
  picture (`line:0`), so it never covers the captions burned in at the bottom.
- **On-screen text** (`<track kind="descriptions">`, "English, on-screen text"): the burned-in captions as text, for
  screen readers and search. A player draws no descriptions track, so turning captions on never draws the burned-in
  words a second time.

The spec of 27 Nov asked for one captions track built from `captions.json`. That track gave a viewer who cannot hear
the film none of the narration and drew the picture's own captions twice, so it became the descriptions track and the
captions track carries the voice-over (review of PR #112, 28 Nov).

`narration.json` gives each cue's time in its shot: from the line's first to its last sound in the v1 mix, held 0.3 s
longer, never past the shot's end; lines 1, 4 and 12, of two long sentences, split at the pause between them. A cut
with the same shot list keeps these times. A new shot list moves the voice too, so it needs a new mix, and new times
here.

### The cut there today

`FILM.youtubeUrl` in `web/content/film.ts` is null. Once the owner has uploaded the film to YouTube, set it to the
video's URL, and the band shows a plain "Watch on YouTube" link under the player. The landing never embeds a player.

The cut there today is the v1 cut of 27 Nov 2026 with beat 6 rendered again on 28 Nov: its tx shot (59.5 to 66.5 s)
shows the two early-close probes of Fri 27 Nov from Base, both hashes set in `txs.json`, under the caption `early-tx`.
Every other segment is the v1 file as `assemble.mjs` wrote it on 27 Nov, joined with the 28 Nov segment by the same
concat step, and the sound is the v1 mix, unchanged, since the shot list is the same. Beat 7 still shows its labelled
placeholders: no outside brief was on Base yet.

Only beat 6 was taken from the 28 Nov render because that render warned about beat 8: `/proof` now also counts the
Decision lines, so its counts run lower on the page, and the `/proof` shot's caption would cover a row of them.
Before the next full render, move that shot's scroll stop so the counts end above the caption band (`keepClear` in
`lib/beats.mjs`).

### Put a new cut on the landing

Run from the repository root, with `<cut>` the 16:9 MP4 with its sound, `<tall>` the 9:16 one, and `<work>` the work
folder of the render their picture comes from:

```bash
ffmpeg -i <cut> -map 0:v:0 -map 0:a:0 -map_metadata -1 -vf "scale=1280:720:flags=lanczos" \
  -c:v libx264 -preset slow -crf 26 -profile:v high -level:v 3.1 -pix_fmt yuv420p -r 30 \
  -c:a aac -b:a 128k -ar 48000 -ac 2 -movflags +faststart web/public/film/maat-film-720p.mp4
ffmpeg -ss 53.5 -i <tall> -frames:v 1 -vf "crop=1080:720:0:410,pad=1280:720:100:0:white" -map_metadata -1 \
  -c:v libwebp -quality 82 -compression_level 6 web/public/film/maat-film-poster.webp
node film/vtt.mjs --manifest <work>/manifest.json --captions web/public/film/maat-film.en.vtt \
  --on-screen web/public/film/maat-film.on-screen.en.vtt
```

53.5 s is the middle of the Thanksgiving tx shot (51 to 56 s) in today's beat plan; if the plan moves that shot, take
the middle of its new span. The poster comes from the 9:16 cut because its card is laid out for a phone: the same card
in the 16:9 frame is small at the player's width, about 8 px of verdict at 1440 px and 4 px at 390 px, and its
burned-in caption sits where the player draws its controls. The crop starts 43 px above the card's heading and keeps
the whole card, with the verdict about 60% down the frame, above the controls' shade, and no caption in it; the pad
widens it to 16:9 in the frame's own white. If the card moves, set the crop's top from a new frame.
`film-band.test.tsx` keeps the cut between 5 and 6 MB: raise the CRF a step if a cut comes out heavier. `vtt.mjs`
writes nothing while a narration cue leaves its shot or a cue's words are not its caption's.
