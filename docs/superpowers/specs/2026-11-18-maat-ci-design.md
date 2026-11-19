# Maat Continuous Integration. Design Spec

- **Date:** 2026-11-18
- **Status:** approved by the owner on 2026-11-18
  - Amended after review on 2026-11-19 (4.2, 4.4, 4.6, 5.1, 6.1, 6.2, 6.4 and 10); the owner confirmed the amendments that day.
  - Amended again on 2026-11-19, after the first CI runs (4.3, 4.4, 5.1, 6.1, 7.1 and 8).
- **Builds on:** `main` at 8608b7d. The owner approved the ecosystem plan on 2026-11-18, with CI as its first sub-project, and
  delegated one choice: CI holds no secret. The research behind the pins and versions below is in local, uncommitted notes; every
  fact this spec relies on is restated here with its source. Section 2 lists where this spec departs from that research, and why.

---

## 1. Goal & success criteria

**Problem.** The repository has no CI. `README.md:523` says so ("There is no CI in this repository yet"), and the docs center on
`feat/docs-center` says it in three more places. Every test count in the README was measured by hand, and some are stale: the badge
at `README.md:12` says "535 (511 offline)", the table says 7 end-to-end tests while `web/e2e/` on `main` defines 13, and the web unit
count of 124 is older than the current test files. The repository must be public before the submission deadline (2026-12-05), and no
tool has scanned its full history for secrets in a way that anyone can re-run. There is no `SECURITY.md`.

**Goal.** One GitHub Actions workflow that runs every offline test suite, a secret scan of the full history and of every commit
message, and a lint of the workflow itself, on each pull request and each push to `main`. It needs no secret, writes honest counts to
a job summary, and ends in one gate job, `summary`, that a ruleset can require once the repository is public. Around it: a
`SECURITY.md`, Dependabot for the pinned actions, a manual pre-flip scan, and README and docs text that says what CI runs and what
still runs by hand.

**Success criteria.**

1. On the pull request from `chore/ci`, every job passes and the `summary` table shows the counts each runner reported. For
   `main` at 8608b7d, the offline contracts suite reports 220 passed and the agent unit suite 167 passed (measured locally on
   2026-11-18 with the JSON reporters below, on a tree whose `contracts/` and `agent/` match `main`). The web unit and end-to-end
   counts are whatever the runner reports; nobody types them in. After `chore/ci` merges `main` (which by then holds PR #3), every
   job passes again on the merged tree.
2. A red-proof pull request with one failing test in each test job turns that job and `summary` red, and the table shows the failed
   counts. On every run, a canary inside the secret-scan job proves that the pinned scanner and the committed config catch four
   planted keys: one for a Maat rule, one for a default rule, one marked `gitleaks:allow`, and one written exactly like an agent test
   fixture.
3. The workflow defines and references no repository or environment secret: no `secrets.*` expression appears in it. The automatic
   `GITHUB_TOKEN` (`contents: read`) is used implicitly by `actions/checkout` and `actions/setup-node`, which do not persist it, and
   explicitly only in the dispatch-only `preflip` job (section 4.6), as `github.token` passed through `env:`.
4. Every action is pinned to a full commit SHA with a version comment, and both container images are pinned by digest.
5. Every job's token is read-only. No `pull_request_target` trigger. No `${{ }}` expression inside a `run:` block reads event data;
   such values reach scripts only through `env:`.
6. After the change, every number in the README's Development section comes from a CI run or is labelled as measured by hand, with
   the commit and the date. The "no CI" sentences are gone from the README and the docs.
7. The `node --test` suite for the counting script passes in CI.
8. The PR body records each job's duration and the billed minutes of the first green run next to the estimate of 18 to 26 Linux
   minutes plus 1 slim minute.

**Not goals.**

- The contracts fork suite (14 tests), the agent fork integration suite (3 tests) and Lighthouse. They need an archive RPC or a
  browser audit and stay owner-run, labelled as such.
- Deploys or any other continuous delivery. The owner signs every mainnet transaction.
- Slither, CodeQL, OpenSSF Scorecard and code-scanning uploads. A private repository on GitHub Free has no code scanning; revisit
  after the flip to public.
- `forge fmt --check` as a gate (19 of 46 Solidity files fail it with Foundry 1.9.0), new code linters (actionlint on the workflow
  file is the one exception), a Node version matrix, path filters (web tests read `contracts/`, `agent/`, `deployments/`,
  `docs/superpowers/specs/`, `README.md` and `LICENSE`, and the agent reads `contracts/src/Types.sol`), and Dependabot for npm.
- Branch protection or rulesets now: neither works on a private repository on GitHub Free, so until the flip CI reports and does not
  block. A `CODEOWNERS` file: with one maintainer it adds no reviewer.
- GitHub private vulnerability reporting: it is available to public repositories only.
- Fixing `contracts/foundry.lock` (its keys use Windows backslashes, `"lib\\forge-std"`), or the `.gitignore` gaps (`*.stackdump`,
  `.env*` variants). Each gets its own branch.

## 2. Approach

**Chosen: one workflow, parallel jobs, one gate, no secret.**

- One file, `.github/workflows/ci.yml`. Four work jobs run in parallel: `contracts`, `agent`, `web` and `hygiene` (the secret scan
  and actionlint). A fifth job, `summary`, needs all four, renders the counts table and fails unless all four succeeded. After the
  flip, a ruleset requires only `summary`, so adding or renaming a work job never touches the ruleset.
- A sixth job, `preflip`, runs only when the owner starts the workflow by hand with `pre_flip: true` (section 4.6). It is not part of
  `summary`.

**Rejected.**

- **One workflow per area.** Four required checks instead of one, and no single table of counts.
- **CI with a `BASE_RPC_URL` secret and a fork job.** The secret would live on GitHub, every push would spend archive-RPC quota,
  and pull requests from forks never receive secrets. A fork run in CI would prove nothing the owner's labelled fork evidence does
  not already prove, so fork evidence stays owner-run.
- **`gitleaks/gitleaks-action` v3.0.0.** On a pull request it lists the PR's commits without paging and scans only the first 30
  (PR #3 alone has 129), and it defaults to gitleaks 8.24.3. A digest-pinned image scans the full history instead.
- **Caching `contracts/out`.** A warm cache would save about 1.5 billed minutes ($0.009) a run, and whether Foundry's cache survives
  a fresh checkout's file times is unverified. Not worth a cache key to maintain.

**Changes from the research defaults.**

| Research default | This spec | Why |
| --- | --- | --- |
| An allowlist that exempts any `const …KEY = "…";` line in four agent test files | An allowlist of the seven known made-up values, in unit-test files only (6.1) | A real key pasted in the fixture form would pass the shape rule. For xAI, DeepSeek, Mistral, Qwen and Bankr keys, `generic-api-key` is the only default rule that could catch it |
| The default `git log` walk | Also each merge's diff against its first parent, every commit message, and `--ignore-gitleaks-allow` (6.2) | Lines that exist only in a merge result, text in commit messages, and keys marked `gitleaks:allow` are otherwise never scanned |
| An owner-run scan of a `git clone --mirror` before the flip | A dispatch-only `preflip` job (4.6) that also scans pull-request and issue text | The owner's machine has no Docker and no gitleaks; the job uses the same pinned image |
| Dependabot weekly | Monthly | Each update PR costs one CI run while the repository is private |
| Branch the CI after PR #3 merges | Branch now from 8608b7d and merge `main` later | CI runs on its own PR a week before the merge, so Linux problems surface early |
| The workflow badge only after the flip | The badge in this change | It merges a few days before the planned flip, and it renders once the repository is public |
| No workflow lint | actionlint in `hygiene` | The workflow file is the one file no test covers |

## 3. Workflow structure and hardening

**Triggers.** `push` to `main`, every `pull_request`, and `workflow_dispatch` with one boolean input, `pre_flip` (default false). No
`pull_request_target`. No `schedule` while the repository is private, because each run bills minutes. `workflow_dispatch` is only
offered once the workflow file is on `main`, the default branch.

**Token and defaults.**

- Top-level `permissions: contents: read`. Only `preflip` widens it, at job level, to `contents: read`, `pull-requests: read` and
  `issues: read`.
- Every checkout sets `persist-credentials: false`, so no later step finds a token in `.git/config`.
- `defaults.run.shell: bash` (GitHub runs it with `-eo pipefail`).
- Event data, `head_ref` and `needs.*` values reach a script only through `env:`, never as `${{ }}` inside `run:`.
- Tools come from the lockfiles only: every `npx` call passes `--no-install`, so a missing local binary fails instead of fetching
  the latest version from the registry.

**Concurrency.**

```yaml
concurrency:
  group: ci-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || format('run-{0}', github.run_id) }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

A new push to a pull request cancels that PR's older run, running or pending. Every push to `main` and every manual run gets a group
of its own, so none of them is ever cancelled or replaced. (With one group per branch, GitHub replaces a pending run with a newer
one even when `cancel-in-progress` is false, which could drop the pre-flip run.) The `queue:` key is not used: actionlint 1.7.12
rejects it.

**Runners.** `ubuntu-24.04` (a fixed label, not `-latest`) for the work jobs and `preflip`: 2 CPUs, 8 GB RAM and a 14 GB disk on a
private repository, with a Docker daemon. `ubuntu-slim` for `summary`: 1 CPU, $0.002 a minute, Node 24 and jq preinstalled, and no
Docker daemon, which is why gitleaks cannot run there.

**Timeouts (minutes).** contracts 15, agent 10, web 30 for the first runs (then about 1.5 times the measured time), hygiene 10,
summary 5, preflip 15. The default is 360, and on a private repository a hung job bills until it times out.

**Pins (read 2026-11-18).**

| Dependency | Version | Pin |
| --- | --- | --- |
| `actions/checkout` | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node` | v7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
| `foundry-rs/foundry-toolchain` | v1.9.2 | `dba66c27052e63476d886f22216e119ba7e615bf` |
| `actions/upload-artifact` | v7.0.2 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` |
| gitleaks image | v8.30.1 | `zricethezav/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f` |
| actionlint image | v1.7.12 (released 2026-03-30) | `rhysd/actionlint@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667` |
| Foundry | v1.9.0 (commit `6056c58`) | the toolchain's `version` input |
| Node | 24 (v24.22.3 today) | setup-node's `node-version` |

Each `uses:` line carries the version as a trailing comment (`# v7.0.1`), which Dependabot keeps in step with the SHA. The two images
are invoked with `docker run` inside a step, so Dependabot does not track them; a bump is a manual commit that also re-reads the
digest, and re-checks the stopword and allowlist notes in 6.1.

## 4. Jobs

Every work job runs `actions/setup-node` with `node-version: 24`, so the counting script (section 5) always runs on Node 24, the
same version it is tested on. Reports go to `$RUNNER_TEMP`, outside the tree. The script is called as
`node "$GITHUB_WORKSPACE/.github/scripts/ci-counts.mjs" …` from any working directory.

### 4.1 `contracts`

- Checkout with `submodules: true` (not recursive: v4-core's nested submodules are not needed) and the default depth.
- `foundry-rs/foundry-toolchain` with `version: v1.9.0` and `cache: false`. The default `version` is `stable`, and the release tagged
  `stable` is v1.5.1, which predates the Base hardfork support the contracts need (`hardfork = "base:Cobalt"` needs 1.8.4 or later).
- setup-node 24 with no cache.
- Working directory `contracts`. Steps:
  1. `forge --version`, failing unless the output contains `6056c58`.
  2. `forge build --sizes`.
  3. `forge test --no-match-path "test/fork/*" --json-file "$RUNNER_TEMP/forge.json"` (step id `test`). The flag exists in 1.9.0 and
     keeps the normal log. Its output is one object keyed by `path:Contract`, each holding `test_results`, a map from test name to a
     result whose `status` is `Success`, `Failure` or `Skipped`, with the failure text in `reason` (checked locally on 2026-11-18:
     8 suites, 220 `Success`).
  4. `extract forge` into the output `forge`, on `!cancelled()`, with `STEP_OUTCOME: ${{ steps.test.outcome }}` in `env:`.
  5. The clean-tree check (below).
- Job output: `forge`.
- No environment. `BASE_RPC_URL` stays **unset**, not empty; only fork cheatcodes read it, and the fork suite is excluded.
- Never `forge build --locked` (the Windows lock keys), never `forge fmt --check`, never the fork suite.

### 4.2 `agent`

- Checkout with the default depth, no submodules. setup-node 24 with `cache: npm` and
  `cache-dependency-path: agent/package-lock.json` (the repo has no `packageManager` field).
- Working directory `agent`. Steps: `npm ci`, `npm run typecheck`, then (step id `test`)
  `npm test -- --reporter=default --reporter=github-actions --reporter=json --outputFile.json="$RUNNER_TEMP/agent-unit.json"`, then
  `extract vitest` into the output `unit` (on `!cancelled()`, with the step's outcome), then the clean-tree check. Passing the
  reporters through `npm test --` keeps the package script authoritative. Naming reporters turns off Vitest's automatic GitHub
  Actions reporter, so it is listed explicitly; it writes one annotation per failed test and its own job summary.
- Job output: `unit`.
- Never `npm run agent`, `npm run test:integration` or any script under `agent/scripts/`. No environment, so no LLM key and no RPC
  URL exist to be read.

### 4.3 `web`

- Checkout with depth 1 and no submodules. Depth 1 is enough: the web code that calls git on `feat/docs-center` reads only `HEAD`
  (the build stamp, and `git cat-file -e` on it in the e2e suite) and `git ls-files`, which also lists the submodule pins.
  setup-node 24 with `cache: npm` and `cache-dependency-path: web/package-lock.json`.
- Job environment:
  - `NEXT_PUBLIC_SITE_URL: https://maatonbase.xyz`. Required once PR #3 merges: GitHub sets `CI=true`, the docs center's output check
    then treats the build as public and rejects a localhost site URL, and without the variable the site URL falls back to
    `http://localhost:3000`. On `main` today the variable is optional and harmless.
  - `NEXT_TELEMETRY_DISABLED: "1"` and `NO_UPDATE_CHECK: "1"` (the `serve` update check).
- Working directory `web`. The steps are the four parts of `npm run verify`, run one by one so the log shows which part failed and
  the unit suite can write a report:
  1. `npm ci`
  2. `npm run typecheck`
  3. `npm test -- --reporter=default --reporter=github-actions --reporter=json --outputFile.json="$RUNNER_TEMP/web-unit.json"` (id
     `unit`)
  4. `npm run build`
  5. `npm run check:out`
  6. `npx --no-install playwright install --with-deps --only-shell chromium`
  7. `npx --no-install playwright test --workers=1 --forbid-only --reporter=list,json` (id `e2e`) with
     `PLAYWRIGHT_JSON_OUTPUT_FILE: ${{ runner.temp }}/e2e.json`. One worker keeps the job the same on the 4-CPU public runners. No
     retries: a flaky test should be seen, not hidden.
  8. `extract vitest` into `unit` and `extract playwright` into `e2e`, each on `!cancelled()` with its own step's outcome.
  9. Only when the end-to-end step failed (`failure() && steps.e2e.outcome == 'failure'`), upload `web/test-results/` (Playwright's
     `outputDir` is `test-results/e2e`, with traces kept on failure) as the artifact `e2e-traces`, kept 7 days.
  10. The clean-tree check.
- Job outputs: `unit` and `e2e`.
- A test (section 5.3) fails if `verify` stops being exactly those four parts, so the job cannot drift from the local command.
- Never `npm run docs:gen`: CI checks the committed generated pages, it does not regenerate them.

**The clean-tree check** (contracts, agent and web). `git status --porcelain` must print nothing after the suites run: a build or a
test that writes a tracked file, or an untracked file that `.gitignore` does not cover, fails the job.

### 4.4 `hygiene`

- Checkout with `fetch-depth: 0` (every branch and tag, plus the triggering PR's merge ref) and `persist-credentials: false`. No
  submodules. setup-node 24 with no cache.
- The gitleaks image has no `USER` line, so it runs as root, and it presets git's `safe.directory '*'`. A first step creates one host
  directory, `$RUNNER_TEMP/gitleaks`, with `mkdir -p`. Every gitleaks `docker run` mounts exactly two paths: the workspace
  read-only (`-v "$GITHUB_WORKSPACE:/repo:ro"`) and that directory read-write (`-v "$RUNNER_TEMP/gitleaks:/out"`). `$RUNNER_TEMP`
  itself is never mounted, so the container sees no other file of the job. Inside it, the canary repository is `/out/canary`, the
  text to scan sits under `/out/text`, and each report is `/out/<scan>.json` (`$RUNNER_TEMP/gitleaks/<scan>.json` on the host).
  Every gitleaks call passes `--redact`, `--no-banner`, `--ignore-gitleaks-allow`, `--exit-code 3`, `--report-format json` and its
  report path. Exit 3 means findings; 1 means gitleaks failed (126 for an unknown flag). gitleaks also exits 0 when git writes an
  error during the walk (it logs `[git] …` and `stderr is not empty` and stops reading) or when it scans no commit, so each history
  scan step copies the log, prints gitleaks' `<n> commits scanned.` next to `git rev-list --all --count`, and fails when the log
  holds either error line or no count above 0.
- Steps:
  0. **No ignore file** (id `ignorefile`). The step fails when `.gitleaksignore` exists at the repository root. gitleaks reads that
     file from the tree it scans, so a pull request could otherwise silence a finding by its fingerprint. A symlink named
     `.gitleaksignore` counts as the file, even when its target does not exist on the runner, because the scan containers see the
     workspace at `/repo`.
  1. **Canary** (id `canary`). Build a throwaway repository at `$RUNNER_TEMP/gitleaks/canary` and commit four planted keys. Each value is
     derived on the runner from a fixed seed string with `sha256sum`, so no key-shaped literal ever enters this repository's git
     (the history scan would flag it) and the canary gives the same result on every run:
     - `canary.txt` with `PRIVATE_KEY=0x` and 64 hex digits,
     - in the same file, a GitHub-token-shaped string (`ghp_` and 36 hex digits),
     - in the same file, a second such string on a line that ends with `# gitleaks:allow`,
     - `agent/test/x.test.ts` with `const KEY = "<40 hex digits>";`.

     A default stopword inside a derived value would suppress a finding, so the plan checks the four values against the image's
     default config before the first push and changes a seed if one contains a stopword.

     Scan `/out/canary` with `git … --config /repo/.gitleaks.toml`. The check is containment, not an exact list. The step fails
     unless gitleaks exits with exactly 3 and its report holds at least one `maat-evm-private-key` finding, exactly two `github-pat`
     findings, and at least one `generic-api-key` finding whose `File` is `agent/test/x.test.ts`. Any other finding is allowed: the
     default `generic-api-key` rule may also flag the `PRIVATE_KEY` line. This proves, on every run, that the image and the committed
     config load, that the default rules are on, that `gitleaks:allow` is ignored, and that the allowlist exempts only its listed
     values.
  2. **History scan** (id `scan`), on `!cancelled()`, so a failed canary does not hide the real scan. The step first writes `* !diff`
     to `$GITHUB_WORKSPACE/.git/info/attributes` (6.2), then runs
     `git --log-opts="--all --full-history --diff-merges=first-parent --diff-filter=uxdb" /repo`, reading `/repo/.gitleaks.toml`.
     The filter leaves out unmerged, unknown, deleted and broken pairs but keeps type changes, which git prints as a deletion and a
     creation, so a file that replaced a symlink or a gitlink is scanned. gitleaks' log goes through `tee` to
     `$RUNNER_TEMP/gitleaks/history.log`. The step prints gitleaks' count next to `git rev-list --all --count`, and when the log
     holds a `[git] ` or `stderr is not empty` line, or no count above 0, it prints an error and turns an exit code of 0 into 1. It
     does not require the two counts to be equal: gitleaks counts only the commits that add a line. The step appends
     `exit=<that exit code>` and `commits=<git rev-list --all --count>` to `$GITHUB_OUTPUT`, then exits with that exit code.
  3. **Commit-message scan** (id `messages`), on `!cancelled()`. `git log --all --format='%H%n%B'` into
     `$RUNNER_TEMP/gitleaks/text/commit-messages.txt`, then `dir /out/text` with the same config and flags. The step appends
     `exit=<exit code>` to `$GITHUB_OUTPUT`, then exits with it.
  4. `extract gitleaks` for each scan into the outputs `history` and `messages`, on `!cancelled()`. Its `env:` carries
     `SCAN_EXIT: ${{ steps.scan.outputs.exit }}` and `COMMITS: ${{ steps.scan.outputs.commits }}` for `history`, and
     `SCAN_EXIT: ${{ steps.messages.outputs.exit }}` for `messages`.
  5. **actionlint** (id `actionlint`) on `.github/workflows/`, through the pinned image (it bundles shellcheck), mounting only the
     workspace read-only with `-w /repo`, on `!cancelled()`, so it reports even when a scan has failed.
  6. **Where** (id `where`), on `failure()`: for each scan report that exists, print each finding's `RuleID` and `File` (both
     JSON-quoted), `StartLine` and `Commit`, never `Secret`, `Match`, `Line` or `Message`.
- Job outputs: `history`, `messages`, `canary` (the canary step's `outcome`) and `actionlint` (that step's `outcome`).

### 4.5 `summary`

- `needs: [contracts, agent, web, hygiene]` and `if: ${{ always() }}`. It runs after a failure and after a cancel, so a cancelled
  run shows a red `summary` instead of a skipped one. GitHub reports a skipped job as passing, and a skipped required check does not
  block a merge.
- Checkout with depth 1, `sparse-checkout-cone-mode: false` and the patterns `/.github/` and `/web/package.json` (the drift guard
  reads it). No setup-node: the slim image's Node 24 runs the script.
- Steps, each on `always()`:
  1. `node --test ".github/scripts/*.test.mjs"`.
  2. Render the table (section 5) from `NEEDS_JSON: ${{ toJSON(needs) }}`, passed through `env:`.
  3. The gate, in plain shell and independent of the script: `env:` carries the four `needs.<job>.result` values, and the step exits
     1 unless every one is `success`.
- No `name:` override: the check is called `summary`, and that is the string the ruleset will require.

### 4.6 `preflip`

- Runs only on `workflow_dispatch` with `pre_flip: true`. Job permissions: `contents: read`, `pull-requests: read`, `issues: read`.
  Checkout with `fetch-depth: 0` and `persist-credentials: false`.
- Steps:
  1. Fetch every pull-request ref, with the token in git's environment so it never reaches `.git/config` or the command line:
     `env:` carries `TOKEN: ${{ github.token }}`, and the step runs
     `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.https://github.com/.extraheader GIT_CONFIG_VALUE_0="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$TOKEN" | base64 -w0)" git fetch --no-tags origin '+refs/pull/*:refs/remotes/pull/*'`.
     GitHub masks the token in the log.
  2. The no-ignore-file check, the history scan and the commit-message scan of 4.4, with the same mounts and paths, now over every
     pull-request ref as well. The history scan keeps the log check of 4.4, with its log at
     `$RUNNER_TEMP/gitleaks/preflip-history.log`, and writes no step output.
  3. Write every pull request's and issue's title and body, every issue comment, every review body (`/pulls/{n}/reviews`), every
     review comment, and every commit comment (`/repos/{owner}/{repo}/comments`) to files under `$RUNNER_TEMP/gitleaks/text/`, with
     `gh api --paginate` and `GH_TOKEN` from `env:`, and scan `/out/text` with `dir`.
  4. The `where` step of 4.4, last.
- It fails on any finding. It is a gate for the flip (section 8), not for merges.

## 5. Counting and the job summary

### 5.1 `.github/scripts/ci-counts.mjs`

A zero-dependency ES module (Node built-ins only), run on Node 24. Two commands:

- `extract <forge|vitest|playwright|gitleaks> <report.json> <output-name>` runs in a work job. It appends one line,
  `<output-name>=<compact JSON>`, to `$GITHUB_OUTPUT`.
  - forge: `passed`, `failed` and `skipped` counted from every `test_results[*].status`.
  - vitest: `numPassedTests`, `numFailedTests`, and `numPendingTests` plus `numTodoTests` as skipped.
  - playwright: `stats.expected` as passed, `stats.unexpected` as failed, `stats.skipped`, and `stats.flaky`.
  - gitleaks: reads `SCAN_EXIT` and, when set, `COMMITS` from the environment. Exit 0 or 3 gives `findings` (the report array's
    length) and `commits`; any other exit gives `{"error":"scan"}`, so a broken scan never shows as "0 findings". An empty or unset
    `SCAN_EXIT` means the scan step never ran: it writes `{"report":"missing"}` and exits 0, because the job has already failed.
  - Failure semantics, for the three test kinds. `STEP_OUTCOME` in the environment is the outcome of the step that writes the report.
    - Report missing and `STEP_OUTCOME` not `success`: writes `{"report":"missing"}` and exits 0, because that step has already
      failed the job.
    - Report missing and `STEP_OUTCOME` is `success`: exits 1. A runner that passed but wrote its report somewhere else must not leave
      CI green with no counts.
    - Report present but not valid in its format: exits 1.
    - Valid report in which no test ran (passed, failed and flaky add up to 0; skipped and todo tests do not count): exits 1,
      because a filter or path went wrong.
  - Annotations, for forge and Playwright failures only (Vitest's own reporter annotates its failures). One line per failed test:
    `::error file=<path>::<suite or file> › <test>: <first line of the reason>`. The `file` value is escaped with the property rules
    (`%`, `\r`, `\n`, `:` and `,`), the message with the data rules (`%`, `\r`, `\n`). `<path>` is relative to `GITHUB_WORKSPACE`, so
    the annotation lands on the file in the pull request's diff. For forge it is
    `path.relative(GITHUB_WORKSPACE, path.join(process.cwd(), suitePath))`, where `suitePath` is the part of the suite key before the
    last `:` and the step runs in `contracts/`. For Playwright it is
    `path.relative(GITHUB_WORKSPACE, path.join(report.config.rootDir, file))`, where `file` is the spec file the report names.
- `render` runs in `summary`. It reads `NEEDS_JSON` and appends a Markdown table to `$GITHUB_STEP_SUMMARY`: one row per suite with
  the job result, passed, failed, skipped (and flaky for end-to-end); the history scan as "N findings over M commits" and the message
  scan as "N findings", with "1 finding" and "1 commit" in the singular; and the canary and actionlint rows as their step outcomes.
  An output that is absent or empty (its step never ran, for example after a timeout) shows as "no report" and is never treated as
  malformed. It exits 0 unless `NEEDS_JSON` itself does not parse; gating belongs to the shell step.

### 5.2 The table's footer

The table ends with: "Offline suites only. The contracts fork suite, the agent fork integration suite and Lighthouse need an archive
RPC or a browser audit and run by hand; see README.md, Development." It carries no hand-measured number, so it cannot go stale.

### 5.3 Tests

`.github/scripts/ci-counts.test.mjs` runs with `node --test` locally and in `summary`. Its fixtures under `.github/scripts/fixtures/`
are small hand-written reports in each format: passing, failing, skipped, zero tests, malformed, and gitleaks with and without
findings. The forge and vitest shapes match the real reports read on 2026-11-18. The tests cover:

- every `extract` kind, every row of the failure semantics, the gitleaks exit codes 0, 3 and 1, and an unset `SCAN_EXIT`;
- annotation escaping, with a test name that holds `,`, `:`, `%` and `::` and a reason that spans two lines;
- annotation paths: a forge suite key run from `contracts/` and a Playwright report whose `rootDir` is `web/e2e` both give a path
  relative to a fixture `GITHUB_WORKSPACE` (`contracts/test/…` and `web/e2e/…`);
- `render` with all-success, failed, skipped, missing, empty and scan-error inputs;
- the drift guard: `web/package.json`'s `verify` script must equal
  `npm run typecheck && npm test && npm run build && npm run check:out`, the parts section 4.3 runs;
- a fixture guard: no fixture file holds a key-shaped string. gitleaks fixtures put `REDACTED` in `Secret`, `Match` and `Line`, and
  the test fails if any fixture matches `ghp_[0-9A-Za-z]{36}`, `0x[0-9a-fA-F]{64}` or an RPC URL with a key in its path. The
  repository's own scan reads these files too, and a flagged fixture would stay in history.

## 6. Secret scanning

### 6.1 `.gitleaks.toml`

At the repository root, where gitleaks looks by default:

```toml
# Read by gitleaks from the repository root.
title = "Maat gitleaks config"

[extend]
useDefault = true

# Seven made-up provider keys that agent unit tests declared before this file existed. gitleaks
# lowercases both the secret and each stopword before it compares them, and a stopword suppresses
# any secret that contains it; the values are written in lowercase by convention. A finding is
# ignored only when it holds one of these values AND it sits in an agent unit-test file. A new
# made-up key in a test carries the word "fake" in its value instead, which the default stopwords
# already ignore.
[[rules]]
id = "generic-api-key"

  [[rules.allowlists]]
  description = "Made-up provider keys in agent unit tests, committed before this config"
  condition = "AND"
  paths = ['''^agent/test/(?:llm/)?[^/]+\.test\.ts$''']
  stopwords = [
    # The seven values, in lowercase, read from git at 45c22322, 50948801, b5de0e7a and efdc272d.
  ]

[[rules]]
id = "maat-evm-private-key"
description = "A 32-byte hex private key next to a private-key name or the --private-key flag"
regex = '''(?i)(?:private[_-]?key|priv[_-]?key|signer[_-]?key|deployer[_-]?key)["'`]?\s*(?:[:=]|=>|\s)\s*["'`]?(?:0x)?([0-9a-f]{64})\b'''
keywords = ["private", "priv", "signer", "deployer"]

[[rules]]
id = "maat-rpc-url-with-key"
description = "An RPC URL that carries a provider API key in its path"
regex = '''(?i)https://[a-z0-9.-]*(?:alchemy\.com/v2|infura\.io/v3|quiknode\.pro|api\.developer\.coinbase\.com/rpc/v1/[a-z-]+)/([A-Za-z0-9_-]{16,})'''
keywords = ["alchemy.com", "infura.io", "quiknode.pro", "api.developer.coinbase.com"]

[[rules]]
id = "maat-mnemonic"
description = "A 12 to 24 word seed phrase assigned to a mnemonic-like name"
regex = '''(?i)(?:mnemonic|seed[_ -]?phrase|recovery[_ -]?phrase)["'`]?\s*[:=]\s*["'`]?((?:[a-z]{3,8}[ \t]+){11,23}[a-z]{3,8})\b'''
keywords = ["mnemonic", "seed", "recovery"]

  [[rules.allowlists]]
  description = "The public Anvil and Hardhat default mnemonic"
  regexes = ['''^(?:test\s+){11}junk$''']
```

- The seven stopwords are the exact made-up values that the default `generic-api-key` rule flags in the history of the local
  `feat/llm-providers` branch (6.3). The implementer reads them from git and writes them into `.gitleaks.toml` only. Neither this
  spec nor the plan repeats them: any other file holding them would be flagged, while the default config never scans files named
  `gitleaks.toml`. Because a stopword ignores any
  secret that contains it, an exact fixture value can only ever match itself. A real key, even one written as `const KEY = "…";` in
  an agent test, still fails, and the canary proves it on every run.
- The path rule covers `agent/test/*.test.ts` and `agent/test/llm/*.test.ts`, not `agent/test/integration/`, where a pasted real
  credential is most likely.
- The extension keeps the default rule's regex, entropy and own allowlists, and adds this allowlist.
- The default rules cover `PRIVATE_KEY=0x…`-style assignments and the CDP secret names, but have no rule for a key after
  `--private-key`, an RPC URL with a key in its path, or a seed phrase. The three `maat-*` rules add those. `priv` is a keyword
  because gitleaks runs a rule only on text that holds one of its keywords, and `priv-key` holds no longer one.
- Rejected:
  - an allowlist by line shape, which exempts a real key written like a fixture;
  - `.gitleaksignore` fingerprints, which embed the commit SHA, so a rebase breaks them;
  - `gitleaks:allow` comments, which `--ignore-gitleaks-allow` turns off.

*Note (2026-11-19, final review):* `useDefault = true` also inherits the default config's global allowlist regex
`(?i)^true|false|null$`, which drops any secret that starts with `true`, contains `false` or ends with `null`. `true` and `false`
are BIP-39 words (`null` is not), so
`maat-mnemonic` misses about 0.6% of 12-word and 1.2% of 24-word phrases. It also misses the command-line form
`--mnemonic "<words>"`, and `maat-rpc-url-with-key` misses `wss://` URLs and an explicit `:443` port (neither form appears in the
repository). The rules stay as written: each fix changes what the rule reports as its secret, which only a CI run can prove.

### 6.2 Scope

- Every run scans the full history of every fetched ref. On a pull request, actions/checkout with `fetch-depth: 0` fetches every
  branch and tag and the triggering PR's merge ref. A leak on any pushed branch therefore fails every run, which is the point before
  the repository goes public.
- Known exemptions. `useDefault = true` also inherits the default config's global path allowlist, so no scan reads a file whose
  path contains `gitleaks.toml` or matches one of its other v8.30.1 patterns: lockfiles (`package-lock.json`,
  `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`, `deno.lock`, `Pipfile.lock`, `poetry.lock`, `gradle.lockfile`, and Go's
  `go.mod`, `go.sum` and `go.work` files), anything under `node_modules/` or `bower_components/`, Go and Ruby `vendor/` trees,
  images (`.bmp`, `.gif`, `.jpg`, `.jpeg`, `.png`, `.svg`, `.tif`, `.tiff`), fonts (`.eot`, `.otf`, `.ttf`, `.woff`, `.woff2`),
  Word and Excel documents and PDFs, some binary formats (`.bin`, `.dll`, `.exe`, `.pdb`, `.gltf` and a few more), minified copies
  of a few JavaScript libraries, Python virtual environments and `.dist-info` folders, and a few build-tool files (the Gradle and
  Maven wrappers, `verification-metadata.xml`, `Database.refactorlog`). A blob that git treats as binary by its content (a NUL
  byte in its first 8000 bytes) gives a patch with no added line, which gitleaks does not read either. "Full history", here and in
  the README and `SECURITY.md`, means every added line outside those paths and binary blobs.
- `--diff-merges=first-parent` adds each merge commit's diff against its first parent, so a line that exists only in a merge result
  (a conflict resolution) is scanned too. 13 merge commits exist across `main`, `feat/docs-center` and `feat/llm-providers` today,
  and `git show --remerge-diff` finds lines that neither parent had in four of them.
- Commit messages are scanned as text, since the history scan reads only the lines each diff adds.
- `--redact` is always on, because the logs become public with the repository.
- A pull request controls four inputs of its own scan: its `.gitleaks.toml`, its workflow, any `.gitleaksignore` it adds, and its
  `.gitattributes` files. A change to the first two is reviewed like any other change, and the canary fails a config that stops
  catching the four planted keys. The third is refused outright: the `ignorefile` step (4.4) fails the job while the file exists.
  The fourth is overridden. git takes the `diff` attribute from the checked-out tree, and one `binary` or `-diff` line would turn
  every historic patch of its paths into `Binary files … differ`, which holds no added line for gitleaks to scan. So each history
  scan step (4.4, 4.6) first writes `* !diff` to `.git/info/attributes`, which outranks every `.gitattributes` file, and git
  decides from each blob's content alone whether its diff is binary (a NUL byte in its first 8000 bytes, as for a real image).
  The canary scans its own repository, so it does not cover this input.

### 6.3 Expected results

The figures come from an emulation of v8.30.1's rules, not yet a real run, re-checked against git on 2026-11-18.

- Pushed refs: 0 findings.
- The local-only `feat/llm-providers` branch: 7 findings, all `generic-api-key` on made-up keys in agent unit tests, each the value
  of a `const …KEY = "…";` line. Six still exist at the branch tip; one (`BANKR_KEY` in `agent/test/proposer.test.ts` at 45c22322)
  exists only in history. These are the seven stopwords of 6.1.
- Near misses, suppressed today only by a default stopword: four `sk-ant-` fixtures at the tip and one more in history (stopword
  `ant-`), and one `OPENAI_API_KEY` value inside an object literal in `agent/test/config.test.ts` (stopword `admin`). The last one is
  not a `const` line. If an image bump changes the default stopwords, any of them may start to fire. The fix is to add its exact value
  to the stopwords after confirming it is made up.
- New made-up keys on `feat/llm-providers`, in Tasks 14 to 21 of its plan, carry the word `fake` in their value, so they never fire.
  That includes the two constants of its Task 16, `DEEPSEEK_KEY` and `BANKR_KEY`, whose planned values the emulation flags: a ruling
  in that plan's ledger gives both the word `fake` before the task runs.

### 6.4 Before the flip to public

Of the pull-request refs, CI checkouts fetch only the triggering one's merge ref, and a pull-request ref keeps a commit reachable
after its branch is deleted. The flip also publishes pull-request and issue text. Once the workflow is on `main`, the owner starts it
from the Actions tab with `pre_flip: true`, and the `preflip` job (4.6) scans every pull-request ref, every commit message, and every
pull-request and issue text. The flip waits until that job is clean. GitHub's own secret scanning starts on the whole history the
moment the repository is public, but it raises an alert only after the text is exposed. Commits that an old history rewrite left
unreachable from any ref may still be served by SHA. Whether either scan reaches them is UNVERIFIED; it is recorded here, not solved.

The text scan reads each body as it is now. GitHub also publishes earlier versions of an edited body or comment, which no step
reads, so before the flip the owner opens the edit history of every edited pull-request or issue body and comment.

## 7. Repository files and docs

### 7.1 `SECURITY.md`

At the root, where GitHub shows it most visibly. It says nothing that `web/content/docs/security/report-a-vulnerability.mdx` on
`feat/docs-center` contradicts, and nothing that the mainnet deploy will make false. `chore/ci` now merges before the deploy (the
section 8 note), and the file makes no claim about whether anything is deployed, so the deploy leaves it true:

- Supported versions: `main`, and the contracts at the addresses listed in `deployments/` once they are listed there. The contracts
  are unaudited.
- Scope: `contracts/src`, `contracts/script`, `agent/src` and `web/`, and the deployed contracts. A bug in a third party's code (Base,
  Chainlink, Aerodrome, Aave V4, the B20 tokens, CDP, USDC) goes to that party; report the Maat side here if it changes what the
  vault or agent does.
- How to report: a direct message to [@maatonbase on X](https://x.com/maatonbase) asking for a private channel, and the details only
  after the channel is agreed. Never a public issue, pull request or reply.
- Never include a real private key, seed phrase or API key; a report never needs one.
- No bounty, credit on request, no promised response time.
- One line on CI: every pull request and every push to `main` runs a secret scan, with redacted logs, over the full history of every
  branch, each merge's own changes, and every commit message.
- The link to https://maatonbase.xyz/docs/security/report-a-vulnerability goes in once that URL serves the page. If it does when
  `chore/ci` merges `main`, `chore/ci` adds it; otherwise a `docs/` branch adds it after the deploy.
- No mention of a GitHub report form while the repository is private. After the flip the owner enables private vulnerability
  reporting, and `SECURITY.md` and the docs page change together.

The docs page's own sentence "Nothing is deployed yet" becomes false at the deploy; the deploy's branch owns that change.

### 7.2 `.github/dependabot.yml`

The `github-actions` ecosystem only, monthly, with every update in one group: about one PR a month, each costing one CI run. npm
ecosystems wait until the flip makes minutes free.

### 7.3 README

- **Badge.** Replace the static "Tests: 535 (511 offline)" badge at `README.md:12` with the workflow badge,
  `[![CI](https://github.com/duongnq2798/maat/actions/workflows/ci.yml/badge.svg?branch=main&event=push)](https://github.com/duongnq2798/maat/actions/workflows/ci.yml)`.
  `branch=main&event=push` keeps PR failures from turning it red. While the repository is private the badge may not render; it
  renders once the repository is public, which is before submission.
- **Development table.** The four offline rows (contracts unit, agent unit, web unit, web end to end) take their counts from the
  first green run after `chore/ci` has merged `main`, so they include PR #3's tests. The fork and integration rows keep their
  hand-measured counts, labelled "by hand". The end-to-end row's prerequisite stays as it is.
- **Hand-measured lines.** The per-suite contract counts ("Contract unit tests by suite: …") and the MandateVault size sentence are
  re-measured at that same commit and labelled "measured by hand at <commit>, <date>".
- **`README.md:523`.** Replace "There is no CI in this repository yet…" with what CI runs (the four offline suites, the secret scan
  and the workflow lint, on every pull request and every push to `main`, with counts in each run's summary) and what runs by hand (the
  fork suite and the agent integration suite).

### 7.4 Docs-center text

Whichever of PR #3 and `chore/ci` merges second makes these changes in its own branch. The planned order is PR #3 first, so
`chore/ci` merges `main` and makes them:

- The three "no CI" sentences: `web/content/docs/guides/run-the-tests.mdx:41`, `web/content/docs/security/model.mdx:35` (the Tests
  row) and `web/content/docs/security/testing.mdx:213` (the continuous-integration row). The docs' path test requires any path they
  name, such as `.github/workflows/ci.yml`, to exist in the same tree.
- `web/content/docs/reference/repository-map.mdx`: a `.github/` row in its first table (a test requires that table to list exactly
  the tracked top-level folders), and `SECURITY.md` and `.gitleaks.toml` named in code in its root-files sentence (a test requires
  every tracked root file to be named there).
- The README's "Documentation" table on `feat/docs-center`: a row for this spec and one for its plan (a test requires every tracked
  file under `docs/superpowers/specs/` and `docs/superpowers/plans/` to be linked).
- Any other docs line the merged tree's web suite flags. The merge is green only when the full web job passes on it.

The docs changelog cites only commits on `main`, so its CI entry comes after the merge, in a `docs/` branch.

## 8. Rollout and owner actions

1. **Branch.** `chore/ci`, cut from `main` at 8608b7d in its own worktree. Commits use `ci:` for the workflow and script, `chore:`
   for the gitleaks and Dependabot config, and `docs:` for this spec, the plan, `SECURITY.md` and the README.
2. **Local checks before any push.** `node --test` on the script (including the fixture guard), and each suite run locally with the
   exact CI command and reporters, with `extract` run on each report. The canary and the scans cannot run locally (no Docker); the
   first CI run is their test.
3. **Push and pull request.** With the owner's approval, push `chore/ci` and open the PR early (proposed title: "ci: add a secret-free
   CI workflow, a secret scan and SECURITY.md"), so that CI runs on the PR itself. Other PRs into `main` get CI once the workflow
   is on `main`, on their next push and without merging `main`: a pull request's run uses the workflow of its merge commit, which
   includes `main`.
4. **First runs.** A job that fails because of Linux (an e2e width check, the headless shell's clipboard, `next typegen` on a clean
   clone) is reported as it is, never hidden with `continue-on-error`. A fix to product code or tests goes in its own `fix/` branch
   from `main`; a fix to the workflow stays in `chore/ci`. The PR body records each job's duration and the billed minutes.
5. **Red proof.** With the owner's approval, push `chore/ci-red-proof` from `chore/ci` with one failing test in each test job, open a
   PR into `chore/ci`, confirm each job and `summary` are red and the table shows the failures, then close the PR and delete the
   branch. It plants no secret, so the PR ref it leaves behind is harmless. The secret scan's proof is the canary, on every run.
6. **Merge `main` and finish the docs.** After PR #3 merges: merge `main` into `chore/ci`, make the 7.4 changes, take the README
   counts from that run (7.3), and add the `SECURITY.md` link if the page is served.
7. **Merge.** After the deploy broadcast and the smoke trade, per the ecosystem plan (planned 2026-11-26), with the owner's approval.
8. **When `feat/llm-providers` is pushed.** Its first run shows whether the seven stopwords cover its history. If a made-up value is
   flagged, its exact value is added to the stopwords, in lowercase, on the branch that carries the config at that time. If a value
   that was ever a real key is flagged, the key is revoked first and the branch's history is rewritten before any further push.
9. **Before the flip.** The owner runs the workflow with `pre_flip: true` (section 4.6) and flips only after a clean `preflip` job.
10. **After the flip.** The owner adds a ruleset on `main` that requires `summary` and blocks force pushes and deletions, with the
    owner as the only bypass, and enables private vulnerability reporting (with the `SECURITY.md` and docs change from 7.1).

*Note (2026-11-19, after the first CI runs):* the owner made the repository public on 2026-11-19, before `chore/ci` was pushed, so
before any CI scan had run; only the local emulation of 6.3 had. The three CI runs on this pull request before this note (on
`96d8be9`, `e6f1a0b` and `af96622`), all after the flip, scanned the history and the commit messages of every pushed branch and found
nothing. The pull-request refs and the pull-request and issue text stay unscanned until `preflip` runs, and `preflip` needs `ci.yml`
on `main`. Actions minutes on the standard runners now cost nothing, so the billing item and
the cost paragraph below no longer apply. Step 7 moves ahead of the deploy: `chore/ci` merges once the run on its last commit is
green, and `preflip` then runs on `main` as the post-flip scan. The owner's check of 6.4, the edit history of every edited body and
comment, moves with it to after the flip. Step 10's ruleset and private vulnerability reporting are no longer blocked. The Actions
settings of the owner-only list were set on 2026-11-19, and the owner delegated the merges that day.

The runs also settle these open points. 6.3's 0 findings on pushed refs is now a real result, not only an emulation. In section 10,
the first row is measured (the pull request records each job's duration and minutes); on the first run gitleaks' count equalled
`git rev-list --all --count` (397 and 397); the run after merging `main` passed with `next typegen` before `tsc`, so no fallback was
needed; and the docs end-to-end tests, the width and clipboard checks among them, passed in the headless shell on both runs since
`main` was merged in. The first run after `feat/llm-providers` is pushed (step 8) is still to come.

**Owner-only actions.**

- Approve the pushes and PRs, approve the red-proof PR, and merge.
- Check Settings → Billing and, if a card is on file, set an Actions budget that stops at $0 overage.
- In Settings → Actions, require actions to be pinned to a full-length commit SHA, and allow only `actions/*` and
  `foundry-rs/foundry-toolchain`.
- Run the pre-flip scan and flip the repository.
- Add the ruleset and enable private reporting.

**Cost.** GitHub Free includes $12 of Actions a month for private repositories. Linux 2-core minutes cost $0.006 and slim minutes
$0.002, each job is rounded up to a whole minute, and failed or cancelled jobs are billed. The estimate is 18 to 26 Linux minutes plus
1 slim minute a run, about $0.11 to $0.16, with the web job about two thirds of it: $12 covers roughly 75 to 110 runs. If usage passes
about 75% of the quota before the flip, the end-to-end steps move to pushes to `main` and manual runs only. Public repositories run
free on 4-CPU runners.

## 9. Testing E5 itself

- The counting script's `node --test` suite, locally and in `summary`, including the drift and fixture guards.
- actionlint in `hygiene` on every run, the one check the workflow file gets.
- The four-key canary, on every run.
- The first green run on the PR, the red-proof PR, the run after merging `main`, and, once on `main`, one manual run with
  `pre_flip: true`.

## 10. Risks and unverified points

| Risk or open point | Handling |
| --- | --- |
| Job durations, billed minutes and dollars are estimates; no CI run exists yet | Measured on the first runs and recorded in the PR |
| Real gitleaks results (the 0 and 7 findings come from an emulation) | The first run on the PR, and the first run after `feat/llm-providers` is pushed (step 8) |
| That `--log-opts` with `--diff-merges=first-parent` keeps the full walk | Every run: the scan step prints gitleaks' count beside `git rev-list --all --count` and fails on a git error or no count. The first run also checks by eye that the two are equal (a commit with no added line is not counted) |
| `next typegen` must create `web/.source/` on a clean clone before `tsc` (after PR #3) | The run after merging `main`; fallback is `next build` before `tsc` |
| Docs e2e width checks may flake on Linux font fallback | Traces uploaded on failure; `summary` is not required until it has passed twice in a row |
| Clipboard e2e tests may fail in the headless shell | Fall back to the full `chromium` install |
| Docker Hub anonymous pull limits | Low; GHCR is the fallback once its digest is read |
| Downloads on a cold runner (Foundry, solc, npm, Playwright, apt, Docker Hub, submodules) | Timeouts and a manual re-run; none needs a secret |
| The workflow badge may not render while the repository is private | It renders after the flip, which happens before submission |
| Commits that an old history rewrite left unreachable | UNVERIFIED whether any scan reaches them; recorded in 6.4 |
| `maat-mnemonic` and `maat-rpc-url-with-key` miss the forms listed under 6.1 | Accepted (6.1 note); the default rules and review are the other nets |
| actionlint reads `.github/actionlint.yaml` or `.yml` from the scanned tree, so a pull request can silence the lint | Reviewed like the workflow itself, which a pull request also controls (6.2); no step refuses the file |
| Earlier versions of an edited pull-request or issue body or comment, which GitHub publishes with the repository | No step reads them; before the flip the owner opens the edit history of every edited body and comment (6.4) |
| The scans never read the paths of the default config's global allowlist (lockfiles, `node_modules/`, images including SVG, fonts, PDFs and the others 6.2 lists) or blobs git treats as binary by content, while the README and `SECURITY.md` say "full history" | Known exemptions, named in 6.2; review is the net for a key added to one of those files |
