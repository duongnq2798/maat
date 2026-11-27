# Static analysis output

The raw output of two static analyzers run over `contracts/src`. The triage of every high and medium finding, and
why Aderyn was not run, is on the docs page
[Static analysis](https://maatonbase.xyz/docs/security/static-analysis)
(source: [`web/content/docs/security/static-analysis.mdx`](../../../web/content/docs/security/static-analysis.mdx)).

| File | What it holds |
| --- | --- |
| [`slither.txt`](slither.txt) | Everything Slither wrote to stderr, with LF line endings: 112 results from 102 detectors over 25 contracts, the Maat sources and the Uniswap v4-core libraries they import. With `--json`, Slither prints its report through a bare log handler, so the lines carry no `INFO:` prefix. Its stdout held only three lines naming the forge commands crytic-compile ran: `forge clean`, `forge config --json` and the build that [Run it again](#run-it-again) gives |
| [`forge-lint.txt`](forge-lint.txt) | What `forge lint src` printed: 61 lints, the high, medium and low ones |

## The run

- **Commit:** `main` at `9553d31`. `contracts/src` there is the same as at `a373515`, the commit that added `MaatInbox.sol`.
- **Date:** 2026-11-27, about 20:03 UTC, on Windows 10.
- **Compiler:** solc 0.8.28 with `via_ir`, the optimizer at 200 runs and EVM `cancun`, as `contracts/foundry.toml` sets.
- **Slither:** 0.11.6, with crytic-compile 0.4.2, on Python 3.14.0, in a virtual environment outside the repository.
- **forge lint:** Foundry `forge` 1.9.0 (commit `6056c58`).

## Run it again

From the repository root, with the submodules checked out (`git submodule update --init`):

```bash
python -m venv ../slither-venv
../slither-venv/bin/pip install slither-analyzer==0.11.6   # on Windows: ..\slither-venv\Scripts\pip
cd contracts
../../slither-venv/bin/slither . --json ../../slither.json 2> slither.txt
forge lint src > forge-lint.txt 2>&1
forge lint src --severity info --severity gas --severity code-size
```

Slither first runs `forge clean`, which deletes `contracts/out` and `contracts/cache`, and then
`forge build --build-info --deny never --skip ./test/** ./script/** --force`, so tests and scripts are not analyzed. It
writes its report to stderr. The JSON report of this run was 4.6 MB and is not committed. `forge lint src` prints the
high, medium and low lints; the last command prints the other 128 (118 info, 7 gas, 3 code size), which are not
committed either.
