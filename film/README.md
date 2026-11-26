# Film

The demo film: about 100 seconds, no voice, captions burned in, in two cuts, 16:9 (1920x1080) and 9:16 (1080x1920).
It is built only from the live site, [maatonbase.xyz](https://maatonbase.xyz), which Playwright opens read-only, and
from Base mainnet transactions shown as text beside a Basescan link card. ffmpeg assembles it. Nothing here signs,
sends or uploads anything.

The render runs on a PC, never in CI: it needs Chromium, ffmpeg and the network. CI runs the unit tests of the beat
plan, the caption sources, the tx cards and the ffmpeg arguments, which need neither ffmpeg nor the network.

## The beats

| # | Beat | Shots | Until its transactions exist |
| --- | --- | --- | --- |
| 1 | The frozen feed | title card; `/gap-index`, the NVDAc panel of the 6 Nov window | |
| 2 | Claude proposes, the vault decides | the landing's How it works; the owner's Basescan Decision clip, or the landing's refusal codes without it | |
| 3 | The brief and the approved mandate | `/ledger`, the mandate the vault holds | shows the timelock line until the vault's cap equals the reserve cap |
| 4 | The sourced proposal and its hash tick | `/ledger`, the decision trail with its hash tick; the owner's Basescan input clip, or `/ledger`'s verify-by-hand commands without it | |
| 5 | Thanksgiving: `MARKET_CLOSED` from the agent | the simulator on Thanksgiving; the tx card | placeholder card |
| 6 | The early-close pair | the simulator after the early close; the two tx cards | placeholder cards |
| 7 | A stranger's brief and the vault's answer | `/ask`; the brief and Decision tx cards | placeholder cards |
| 8 | Receipts | the deployed contracts; the README's CI figures; `/proof`; the end card | |

`lib/beats.mjs` holds the plan: every shot, its length, its page steps and its caption cues.

## Files

| File | What it is |
| --- | --- |
| `render.mjs` | The one command: `capture.mjs`, then `assemble.mjs` |
| `capture.mjs` | Opens each page with Playwright at each cut's viewport (16:9 at 1920x1080; 9:16 at 540x960 with a pixel ratio of 2, the site's phone layout) and screenshots every frame of each scroll; renders the cards and the caption overlays; reads the tx receipts; writes `work/manifest.json` |
| `assemble.mjs` | Runs ffmpeg: one H.264 segment per shot with its captions burned in, then the segments joined, with a silent audio track |
| `captions.json` | Every caption. Each number in a caption is a `{placeholder}` |
| `txs.json` | The transactions of beats 5 to 7, by hash, and what each receipt must show |
| `input/` | Where the owner drops the two Basescan clips; git ignores everything in it but its README |
| `lib/` | The beat plan, the caption sources, the cards, the tx decoder and the ffmpeg argument builder |

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

The tests run with the website's unit tests (`npm test` in `web/`), or alone:

```bash
cd web && npx vitest run test/film-beats.test.ts test/film-captions.test.ts test/film-txcards.test.ts test/film-ffmpeg.test.ts
```

## Captions and their numbers

A caption never has a number typed into it. `captions.json` writes it as a placeholder, which `lib/sources.mjs` fills
at render time from:

| Placeholder | Read from |
| --- | --- |
| `gap.*` | `web/content/gap-index/edition-0.json`: NVDAc in the window that closed on Fri 6 Nov |
| `deployments.*` | the address table of `deployments/README.md` and its verification note |
| `readme.*` | the "Tested, in numbers" table of the root `README.md` |
| `reserve.*` | `RESERVE_CAP_BPS` in `contracts/script/QueueReserveCaps.s.sol` and the basket in `contracts/script/MaatConfig.sol` |
| `ledger.*` | the live `/ledger` page's mandate panel, read by the capture; a cell it cannot read stops the render |

`web/test/film-captions.test.ts` fails on a digit typed into a caption, on a placeholder no source fills, and when a
source no longer reads its file the way the test reads it. A change to one of those files flows into the next render.

Beat 3's last caption, `mandate-reserve`, shows only when the vault's weight cap, as `/ledger` reads it, equals
`RESERVE_CAP_BPS`. Until then the render shows `mandate-timelock` in its place and prints a warning.

## Owner steps

1. **ffmpeg.** Install it if `ffmpeg -version` fails, for example with `winget install ffmpeg`, and open a new
   terminal. The v0 draft was rendered with ffmpeg 5.1.2.
2. **Two Basescan clips, by hand** (Basescan may block automated browsers). Record each as a 16:9 desktop screen
   recording of about 8 seconds; the film uses its first 6 seconds. Save them in `film/input/` under these names (any
   of `.mp4`, `.mov`, `.webm`, `.mkv`):
   - `basescan-decision-log`: a `Decision` event in the `MandateVault`'s Events tab, with its reason. Beat 2.
   - `basescan-input-utf8`: an agent Decision's input data viewed as UTF-8, showing the rationale. Beat 4. Record it
     once an agent Decision with a rationale blob is on Base.
   Without a clip, its beat shows a page of the site instead, for the same length.
3. **The transactions of beats 5 to 7.** When each is on Base mainnet, put its hash in `txs.json`:
   - `thanksgiving`: the agent's Decision refused with `MARKET_CLOSED` on Thu 26 Nov (New York date);
   - `earlyCloseAllowed` and `earlyCloseRefused`: the agent's Decisions on Fri 27 Nov, allowed before the 13:00 ET
     early close and refused with `MARKET_CLOSED` after it;
   - `strangerBrief`: an outside wallet's `Brief` transaction to the inbox; `vaultAnswer`: the vault's Decision on the
     agent's answer to it.
4. **Render, review, upload.** Run `node film/render.mjs`, watch both cuts, then upload the 16:9 cut to Loom (a free
   account) on Wed 9 Dec. Uploads are the owner's: nothing in this folder posts anything.

## Render again once beats 5 to 7 exist

1. Put the hashes in `txs.json` (step 3 above).
2. Run `node film/render.mjs`. For each hash it reads the receipt from `https://mainnet.base.org` (then
   `https://base-rpc.publicnode.com`) and stops, naming the entry, if the tx reverted, has no event of the expected
   kind, has another reason, or falls on another New York date than `expect` says. A hash it cannot read stops the
   render too: it never shows a row it did not read.
3. Check the printed summary: `placeholders: none` once all five hashes are set, and each placeholder caption replaced
   by the beat's own.
