# Journal publisher

`publish.mjs` copies the agent's journal to the public `agent-journal` branch of
[duongnq2798/maat](https://github.com/duongnq2798/maat), so anyone can read every round the agent ran and check that
no line was changed afterwards. The owner starts it on the PC that runs the agent, beside the agent's restart loop.
Every 15 minutes it:

1. reads `journal.jsonl` in the agent's data folder;
2. checks the agent's hash chain: each row's `hash` must match its public fields and its `prev` must be the hash of
   the row before it;
3. keeps only the public fields of each new row (the allowlist below);
4. refuses to go on if a new line matches a URL, key or token pattern, and says which line and field, never the text;
5. appends the new lines to `journal/YYYY-MM-DD.jsonl` (the UTC date of the row) and rewrites `journal/index.json`, in
   a checkout of the branch of its own;
6. commits, and pushes with a plain `git push`, using your own git login.

It never force-pushes and never rewrites history. When the branch on GitHub changed in a way that is not a
fast-forward of what it pushed, it stops and says so.

The formats are those of the maat:v1 spec, `docs/superpowers/specs/2026-11-25-maat-v1-rationale-blob-design.md`:
§3.1 (the row hash), §3.2 (the allowlist), §3.4 (the branch) and §3.5 (the publisher's rules). The agent writes `prev`
and `hash` only from the release that adds the journal chain; an agent on an older release has no chained row, and each
round of the publisher then prints `has no chained row yet` and pushes nothing. As of 2026-11-27 the live agent runs a
chaining release (tag `agent-r2`), and the publisher's first push to `agent-journal` was commit `23e2df8`, at 01:23 UTC
that day.

## What leaves the PC

Only these fields of each row, as they are on disk. A field the row does not have is left out.

| Row kind | Fields |
| --- | --- |
| every kind | `ts`, `kind`, `runId`, `commit`, `prev`, `hash` |
| `run` | `block`, `day`, `mode`, `ok`, `costUsd6`, `suggestions`, `proposals`, `summary` (sanitized to 600 characters; left out when nothing is left of it, as of a summary of only spaces or emoji), `capped` (`true` when the daily LLM cap stopped the round) |
| `intent` | `index`, `intentId`, `action`, `symbol`, `amountUsd6`, `rationaleHash`, `blob`, `preview`, `gate`, `txHash`, `gasUsed`, `decision` |
| `sent` | `index`, `intentId`, `action`, `symbol`, `amountUsd6`, `rationaleHash`, `blob`, `preview`, `gate`, `txHash`, `gas` |
| `reconcile` | `intentId`, `action`, `txHash`, `outcome`, `decision` |
| `mismatch` | `intentId`, `preview`, `decision` |
| `housekeeping` | `call`, `token`, `txHash`, `gas`, `gasUsed` |
| `skip` | `index`, `symbol`, `action` |
| `brief` | `briefId`, `from`, `txHash`, `logIndex`, `block`, `outcome`, `cap`, `adopted`, `reply` (sanitized to 200 characters; left out like a summary). The brief's own text is never in the row |
| `error` and any other kind | the common fields only |

The raw model text (`rationale`), `previewError`, `error`, `message`, `note` and every other field stay on the PC. So
no key, `.env` value, RPC address or provider error text can reach the branch. The publisher reads one line of
`agent/.env`, `MAAT_DATA_DIR`, to find the data folder, as the restart loop does.

## Start it (Windows)

You need Node.js 22.9 or later and Git for Windows, which the agent already uses. The publisher has no npm
dependencies, so there is nothing to install.

1. Open a new PowerShell window or tab yourself, beside the one where `npm run agent:loop` runs.
2. Go to the root of the clone the agent runs from, the folder that holds `agent\` and `ops\`.
3. Run:

```powershell
node ops\journal\publish.mjs
```

It prints one line when it starts, with the journal it reads, the remote and its checkout, then one line per round.
Leave the window open; it runs a round at once and then every 15 minutes.

On its first run it creates its checkout, `maat-agent-journal`, in the folder that holds your clone (beside it, never
inside it). That checkout has one branch, `agent-journal`, and its `origin` is
`https://github.com/duongnq2798/maat.git`. The first push creates the branch on GitHub. Git signs in with your own
login, through Git Credential Manager; if it opens a sign-in window, sign in there within 5 minutes. The publisher
never asks for a password or a token, and Git never prompts in the terminal (`GIT_TERMINAL_PROMPT=0`): a missing login
shows as a failed push, and the next round tries again. No git command can hold the loop for good: a fetch or push
that takes more than 5 minutes, any other git command that takes more than 1 minute, and a transfer that stalls under
1,000 bytes a second for 60 seconds are ended, and the next round tries again.

If the agent runs from another folder than this clone, or `MAAT_DATA_DIR` in `agent\.env` names a folder other than
the live agent's, give the folder yourself, relative to `agent\` or absolute:

```powershell
node ops\journal\publish.mjs --data-dir .\data
```

## Stop it

Press **Ctrl+C** in its window. Between rounds it stops at once and prints `stopped by Ctrl-C`. You can stop it at any
time and start it again later with the same command: it appends every row the branch does not have yet, and never
one that it already has.

If Ctrl+C lands while git is writing, a later start can stop with `Unable to create '...index.lock': File exists`.
When no git command is running, delete `maat-agent-journal\.git\index.lock` and start it again.

## What it prints

| Line | Meaning |
| --- | --- |
| `appended <N> rows to journal/<YYYY-MM-DD>.jsonl; the agent-journal branch has <ROWS> rows, head <HASH>` | One commit pushed |
| `nothing new: the branch has all <ROWS> chained rows, head <HASH>` | The agent wrote no new row since the last round |
| `... has no chained row yet (rows with prev and hash)` | The agent does not chain its rows yet: it runs an older release |
| `...; passed over journal.jsonl line <N>, cut short by a crash` | A crash or power loss cut one of the agent's writes short. The agent started a fresh line after it, and its chain goes on from the last whole row, so nothing is missing. Nothing to do; leave the line in the file |
| `will try again in 15 min: git push failed: ...` | The network or the login failed. It keeps running; a commit it could not push goes up with the next round |
| `will try again in 15 min: git fetch did not finish within 300 s and was ended` (or `git push`, or another command within 60 s) | GitHub stalled, or a sign-in window was left open. It keeps running and tries again next round |
| `STOPPED: ...` | It exited (code 1) and pushes nothing until you start it again. See below |

## When it stops

It stops, rather than guess, in these cases. It never repairs the branch by force: what the branch should hold after
someone else changed it is for you to decide.

| `STOPPED:` line says | What happened | What to do |
| --- | --- | --- |
| `not a fast-forward of what this checkout last fetched`, `have diverged`, or `rejected the push as a non-fast-forward` | The branch on GitHub was force-pushed, rewritten or moved by someone else | Compare the branch's history on GitHub with `git -C ..\maat-agent-journal log --oneline -10`, which is what the publisher last pushed, and find out who changed it. Start the publisher again only once the branch on GitHub contains that history |
| `the remote has no agent-journal branch any more` | The branch was deleted on GitHub | Push it back from the checkout with `git -C ..\maat-agent-journal push origin agent-journal`, a plain push (the branch does not exist, so it overwrites nothing), then start again |
| `journal.jsonl line N: ...` with `hash`, `prev` or `no hash` | The local journal's chain is broken: a line was edited or removed, or written by code that does not chain. A line a crash cut short is not one of these: it is passed over | Do not edit `journal.jsonl`. Keep a copy of the file and report it |
| `journal.jsonl line N: its published line would match URL_RE in field ...` (or `KEY_RE`, `HEX_RE`, `LONG_RE`) | A public field would carry a URL, key or token. The agent sanitizes these fields, so this is a bug | Nothing was pushed. The publisher cannot skip the line without breaking the chain; report it |
| `journal.jsonl line N is a dry-run row` | The data folder is a dry run's, such as the soak's `data-dryrun` | Point it at the live agent's folder with `--data-dir` |
| `--allow-dry-run is for a rehearsal against a remote of your own` | A rehearsal would have pushed dry-run rows to the public branch, where they would stay and block the live journal | Give `--remote` and a new `--checkout`, as in the rehearsal below |
| `the branch's head ... is not in the local journal` | The branch was published from another journal: the wrong data folder, or the journal was replaced | Check `--data-dir` and `MAAT_DATA_DIR` |
| `the published chain on the branch is broken` | A line on the branch fails its hash check | Look at the branch's history on GitHub |
| `is on ..., not the agent-journal branch`, `origin is ..., not ...`, `is not a git checkout of its own` | Its checkout was changed by hand, or `--checkout` points at another folder | Point `--checkout` at its own checkout or at an empty folder |

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `--data-dir <dir>` | `MAAT_DATA_DIR` from the environment, else from `agent\.env`, else `./data` | The agent's data folder, relative to `agent\` |
| `--checkout <dir>` | `maat-agent-journal` beside the clone | The publisher's own checkout of the branch, relative to the current folder |
| `--remote <url>` | `https://github.com/duongnq2798/maat.git` | The remote a new checkout pushes to. An existing checkout keeps its `origin`, and the publisher stops if this option names another |
| `--interval-min <n>` | `15` | Minutes between rounds |
| `--once` | off | Run one round and exit: code 0 when it worked, 3 when it should be tried again, 1 when it stopped |
| `--allow-dry-run` | off | Publish dry-run rows too, for a rehearsal against a remote of your own. It stops before any fetch when the remote is the public `duongnq2798/maat` repository, given, by default or as an existing checkout's `origin` |

## Rehearse against a local remote

To see what it writes without touching GitHub, point it at a bare repository on the PC. For the soak's journal, run
from the clone's root:

```powershell
git init --bare $env:TEMP\journal-rehearsal.git
node ops\journal\publish.mjs --once --allow-dry-run --data-dir .\data-dryrun --checkout $env:TEMP\journal-rehearsal --remote $env:TEMP\journal-rehearsal.git
git --git-dir $env:TEMP\journal-rehearsal.git log --stat agent-journal
```

## Read the branch

The files are at `https://raw.githubusercontent.com/duongnq2798/maat/agent-journal/journal/index.json` and
`.../journal/<YYYY-MM-DD>.jsonl`. `index.json` is `{"days":[...],"head":"0x...","rows":N,"v":1}`: the day files in
order, the last line's hash and the line count. It is for finding the files only; a verifier checks the lines
themselves: each one is canonical JSON, its `hash` is keccak256 of its other fields, and its `prev` is the hash of the
line before it (`0x` and 64 zeros for the first).

## Tests

```powershell
cd ops\journal
npm test
```

They need Node.js and git, and no network: the end-to-end tests push to a temporary bare repository, and the stalled
fetch goes to a server on `127.0.0.1`. They cover the spec's vectors, the allowlist, the deny check, a broken chain, a
line a crash cut short, a row that is never appended twice, `index.json`, two pushes, a forced remote change that stops
the next round, a rehearsal refused on the public remote, a stalled fetch that is ended, and the guard that lets it
push nothing but `agent-journal`. CI does not run them; the web unit test `web/test/journal-publisher.test.ts`, which CI runs, checks the fixture chain
with viem's keccak256 and that the publisher writes exactly the fixture's files.

| File | What it holds |
| --- | --- |
| `publish.mjs` | The command: options, the 15-minute loop, Ctrl+C |
| `lib/publisher.mjs` | One round: the checkout, the fetch, the commit and the push |
| `lib/chain.mjs` | The local chain, the branch's chain and the plan of what to append |
| `lib/spec.mjs` | Canonical JSON, the sanitizer and its patterns, the allowlist, the row hash, the deny check |
| `lib/keccak.mjs` | Keccak-256, so the publisher needs no package |
| `lib/git.mjs` | The guard every git command goes through |
| `test/` | The tests, the spec's vectors and the fixture journal with the files published from it |
