# Maat agent runtime

"LLM proposes, contract decides." Each cycle, the agent does the following:

1. Read the state of `MandateVault` at a fixed block.
2. Compute the policy: an equal-weight basket of NVDAc/GOOGLc/AAPLc, keep 30% in USDC, rebalance on a ±5% drift, borrow when there is less than 7 days of compute runway, repay debt when revenue arrives.
3. Ask Claude (`claude-sonnet-5-5`, structured output). Claude may only propose.
4. Call `previewIntent` with `eth_call`, using `from = executor`.
5. Send `execute` through the CDP Server Wallet. Every tx carries the Builder Code (ERC-8021).
6. Write to the journal.

Refusals that are "worth recording", such as `MARKET_CLOSED` or `FEED_STALE`, are also sent onchain so that a public `Decision(allowed=false)` exists. Each reason is sent at most once per UTC day.

Cadence: 15 minutes in session, 1 hour out of session.

## Dry run (default)

```bash
cd agent
npm ci
cp .env.example .env   # fill in BASE_RPC_URL, MAAT_VAULT, MAAT_EXECUTOR, MAAT_EXPENSE_PAYEE, ANTHROPIC_API_KEY
npm run agent -- --once --dry-run
```

The dry run reads the chain, calls Claude (this costs real API fees, about 1 cent per cycle), runs the preview, then writes `data/journal.jsonl`. It never sends a tx.

## Live run (owner only)

1. **Builder Code:** register the project at https://dashboard.base.org, go to Settings → Builder Code, then set `MAAT_BUILDER_CODE=bc_...`. The code must match `^[a-z0-9_]{1,32}$`.
2. **CDP:** create an API key and a Wallet Secret at https://portal.cdp.coinbase.com, then set `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET` and `CDP_WALLET_SECRET`.
3. **Create the executor and attach the policy** (run once):

   ```bash
   node --env-file=.env --import tsx scripts/cdp-setup.ts <MAAT_VAULT>
   ```

   The policy allows only txs on Base with `to` = the vault and `value` = 0. Hash signing is rejected.
4. **Point the vault at the new executor.** You sign this one yourself with the owner wallet; see `deployments/README.md`, section "Switch the executor to the CDP Server Wallet".
5. **Fund gas:** send about 0.002 ETH on Base to the executor address. A paymaster cannot be used, because it only supports smart accounts.
6. Set `MAAT_EXECUTOR=<executor address>` and `MAAT_MODE=live`, run `npm run agent -- --once`, then check the tx on Basescan. The input data must end with the Builder Code (`...0080218021...8021`).
7. Run continuously: `npm run agent`. Stop it with Ctrl+C.

## Run in a container

`agent/Dockerfile` builds one image for the agent loop, with `agent/` as the build context. The image has not been built yet: the dev machine has no Docker, so build it remotely, on Fly.io's remote builder or on the VPS that runs it. Do live-run steps 1–5 first.

The image holds `src/`, the package files and `tsconfig.json`, with production dependencies only (`npm ci --omit=dev`; `tsx` is a dependency because it runs `src/`). It runs `node --import tsx src/main.ts` under tini as the non-root `node` user, so a stop signal reaches the agent. `MAAT_DATA_DIR` is `/data`, a volume. Pin `node:24-slim` by digest when you build (see the top of the Dockerfile). The same image can run another entry point in `src/` by overriding the command.

**Keys.** The vault owner key is never on the agent host or in the container. The host only holds the CDP API credentials (`CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET`) and the Anthropic key (`ANTHROPIC_API_KEY`), plus `BASE_RPC_URL` when it carries a provider key. None of them is in the image: pass them at run time.

**One volume, one container.** Never mount one data volume in two running containers, and never run two agents against one vault. `agent.lock` holds a process id, and process ids are per container, so the lock cannot be relied on to stop a second container.

**Stop timeout.** A stop signal ends the wait between rounds, not a round in flight, and a round can wait up to 2 minutes for each receipt. Give the agent time to finish the round and remove `agent.lock` before it is killed: Docker's default is 10 s and Fly's is 5 s. The 300 s set below is the most Fly allows: it covers a normal round, where Base receipts arrive in seconds, and about two full receipt waits, not a round that waits long on several. A killed agent leaves `agent.lock` behind. If the restarted agent then stops at `another agent (pid N) is running` while no other container uses the volume, the lock is stale (in a container the new agent can get the old one's process id): read the journal, then delete `/data/agent.lock` with a one-off command, as for the `--once` run below.

### On a VPS with Docker

```bash
# From the repository root, on the VPS.
sudo docker build -t maat-agent agent/

# Settings and secrets in a root-only file outside the repository, in the format of .env.example.
sudo install -d -m 700 /etc/maat
sudo install -m 600 /dev/null /etc/maat/agent.env   # fill it in as root

sudo docker run -d --name maat-agent \
  --restart=always \
  --stop-timeout 300 \
  --env-file /etc/maat/agent.env \
  -v maat-data:/data \
  maat-agent
```

Leave `MAAT_DATA_DIR` out of the env file: the image sets it to `/data`, and `./data` would point inside `/app`, which the `node` user cannot write. `maat-data` is a named volume: Docker fills a new one from the image's `/data`, so it starts owned by `node`. A bind mount of a host folder would have to be owned by uid 1000 instead.

`docker logs -f maat-agent` follows the loop's output. To run one round by overriding the command, stop the loop first, because both use the same volume:

```bash
sudo docker stop maat-agent
sudo docker run --rm --env-file /etc/maat/agent.env -v maat-data:/data maat-agent node --import tsx src/main.ts --once
sudo docker start maat-agent
```

### On Fly.io

Save this as `agent/fly.toml`, next to the Dockerfile (`.dockerignore` keeps it out of the image). The settings that are not secret go in `[env]`. `CDP_ACCOUNT_NAME` must be the name `cdp-setup.ts` created the executor under. On a Machine, Fly's init starts tini as its child, so tini is not PID 1: `TINI_SUBREAPER` lets it reap zombies there too, and stops it from logging a warning about that at each boot.

```toml
app = "<APP_NAME>"
primary_region = "<REGION>"
kill_timeout = 300

[env]
  MAAT_MODE = "live"
  MAAT_VAULT = "<VAULT_ADDRESS>"
  MAAT_EXECUTOR = "<EXECUTOR_ADDRESS>"
  MAAT_EXPENSE_PAYEE = "<PAYEE_ADDRESS>"
  MAAT_BUILDER_CODE = "<BUILDER_CODE>"
  CDP_ACCOUNT_NAME = "maat-executor"
  TINI_SUBREAPER = "1"

[mounts]
  source = "maat_data"
  destination = "/data"

[[restart]]
  policy = "always"
```

```bash
cd agent
fly apps create <APP_NAME>
fly volumes create maat_data --size 1 --region <REGION>
fly secrets set ANTHROPIC_API_KEY=... CDP_API_KEY_ID=... CDP_API_KEY_SECRET=... CDP_WALLET_SECRET=... BASE_RPC_URL=...
fly deploy --remote-only
fly scale count 1
```

`fly secrets import` reads the same `NAME=value` lines from stdin and keeps the values out of your shell history. Keep exactly one Machine: a volume attaches to one Machine only, so a second Machine would run on a volume of its own, with a lock that cannot see the first agent.

### Health check

The agent serves no port, but every round appends to `/data/journal.jsonl`, and off session the loop waits 60 minutes between rounds. A newest line older than about 70 minutes (that wait plus a round) means the loop is stuck or failing before it writes. This command exits 0 when the newest line is younger than 70 minutes, and 1 otherwise, also when the journal is missing:

```bash
sudo docker exec maat-agent node -e '
const last = require("node:fs").readFileSync("/data/journal.jsonl", "utf8").trimEnd().split("\n").at(-1);
process.exit(Date.now() - Date.parse(JSON.parse(last).ts) < 70 * 60_000 ? 0 : 1);
'
```

On Fly, run the same `node -e` through `fly ssh console`. It is not a `HEALTHCHECK` in the image, because it has not run in a container yet. Run it from cron or a monitor, and give a fresh start one round to write its first line.

## Safety

- The contract is the final gate: $50 per-trade cap, $100 daily cap, slippage floor, session hours, feed, premium, HF. The agent cannot exceed these limits.
- `GuardedSender` sends only `execute`, `syncMultiplier` and `notifyRevenue` to the vault, and always attaches the Builder Code. The CDP policy adds one more layer of blocking.
- `MAAT_MAX_TX_PER_DAY` (default 40) stops gas from being burned on a repeating error.
- If the RPC fails, that cycle does nothing. If a tx fails or reverts, the cycle stops immediately.
- Every tx has an explicit gas limit: `min(3,000,000, max(floor, estimate × 1.3))`. The floor is 2,500,000 for `execute` and 300,000 for `syncMultiplier`. The agent does not use `eth_estimateGas` directly, because the vault swallows inner errors (swap, transfer, credit), so the estimate can be too low and the vault would record `SWAP_FAILED`. If the estimate fails, the cycle stops.
- Every `execute` is recorded in `pending` in `data/state.json` before it is sent. The next cycle reconciles against `usedIntent(id)` before doing anything else, so even a lost receipt cannot cause a bill to be paid twice.
- If the preview reports OK but the vault refuses, or the receipt has no `Decision`, the agent records `mismatch` and stops the cycle.
- Each `data/` directory allows only one agent process at a time (the `agent.lock` file). The agent takes the lock before it opens the Store or connects to CDP. A lock file that is empty or corrupt but newer than 60 seconds is treated as held.

## After a `halted` or `pending-tx` cycle

1. Read `data/journal.jsonl` (the `error`, `mismatch`, `sent` and `reconcile` lines), then look up the tx hash on Basescan.
2. `pending-tx` means a tx was sent and its outcome is still unknown. The next cycle reconciles it first, on its own:
   - the intent was used: apply its `Decision`;
   - the tx is still in the mempool, or no more than 300 blocks have passed: keep waiting and send nothing;
   - more than 300 blocks have passed with no trace of it: record `dropped` and continue.

   No manual fix is needed.
3. `halted` because of `mismatch` or a missing `Decision`: read the tx on Basescan before you run again. If a `pending` entry keeps halting the cycle, remove it from `data/state.json` only when you are sure that tx can no longer take effect.
4. Emergency stop (the owner signs it): call `setPaused(true)` on the vault, or `setExecutor(owner)` to take back the executor role.

## Data

- `data/state.json`: compute bills, refusal records per day, tx count per day, and `pending` txs not yet reconciled.
- `data/journal.jsonl`: for each cycle, the intent, the rationale (the original text behind `rationaleHash`), the preview, the tx (`sent`, gas, `gasUsed`) and the Decision. Plan 3 (diary/dashboard) reads this file.

## Test

```bash
npm test                  # unit tests, no network needed
npm run test:integration  # anvil fork of Base, needs BASE_RPC_URL (archive)
```

The fork test needs:

- `BASE_RPC_URL`: a Base archive RPC (the test forks at block 53551627).
- base-anvil v1.5.1, installed with `base-foundryup --install v1.5.1`. Upstream Anvil 1.9 cannot deploy the vault, because it reverts on the B20 token's `uiMultiplier()`.
- On Windows, set `MAAT_ANVIL_BIN` to point to the real `anvil.exe` file, for example `~/.foundry/versions/base-v1.5.1/anvil.exe`, because `base-anvil` is only a shell wrapper. On macOS/Linux you can leave it unset.
- Port 8547 is free. The test runs only against a local anvil (`127.0.0.1`).
- About 3–5 minutes on a public RPC, because the first swap on a cold fork is very slow. Set `MAAT_GAS_LOG=<file path>` to write the gas limit and `gasUsed` of each tx to a JSON file.
- The committed log: `test/integration/fork-gas.json`; the web page reads its gas numbers from this file. Across 2 runs on 2026-11-07, `gasUsed` for SUPPLY, BORROW and the refusal log was identical, while BUY came out at 754,854 and then 758,192. If you overwrite this file, you must update `web/content/facts.ts` to match, because the parity test will fail.

## Known issue: npm audit

`npm audit` reports 3 high-severity issues in zod 3 and abitype nested inside `@coinbase/cdp-sdk`. They are DoS-type issues and only touch internal data. There is no safe override yet, because cdp-sdk uses the zod 3 API; `npm audit fix --force` would downgrade cdp-sdk to 1.7.0. Upgrade when Coinbase releases a version that uses zod 4.
