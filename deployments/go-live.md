# Go-live runbook (owner only)

This runbook takes Maat from a green `main` to its first mainnet `Decision` events and then to the agent. You, the owner, run every command in it, in bash, with your own wallet. Nothing here was run for you. The deploy details live in [`README.md`](README.md) in this folder and the agent's in [`agent/README.md`](../agent/README.md); this page puts them in order and adds the first-decision steps.

The plan:

- **Saturday 2026-11-21:** deploy to Base mainnet with your wallet as owner, executor and first payee, fund the vault with 20 to 100 USDC, and send a 5 USD NVDAc BUY while NYSE is closed. The vault answers `allowed=false`, reason `MARKET_CLOSED` (6).
- **Monday 2026-11-23, at or after 14:30 UTC:** send the same intent with a new id. The vault answers `allowed=true`, reason `OK` (0).
- **After that:** hand the executor role to the CDP Server Wallet and run the agent.

> **Hard rule.** Never deploy from a tree where `contracts/script/MaatConfig.sol` has `maxSlippageBps: 100` or `maxStaleness: 3600`. Deploy only when it has `maxSlippageBps: 150` and `maxStaleness: 25 hours` (step 0). The mandate is fixed at construction; changing it later takes `queueMandate`, the 24 hour timelock and `applyMandate`.

## Market hours this week

US daylight time ended on 2026-11-01, so `MarketCalendar` puts the NYSE regular session (09:30 to 16:00 ET) at **14:30 to 21:00 UTC, Monday to Friday**, holidays excepted. The vault deploys with the `REGULAR` session mode (`script/Deploy.s.sol`), so it is closed all of Saturday and Sunday.

From the `MarketCalendar` constructor (`contracts/src/MarketCalendar.sol`):

| Date | Day | Session |
|---|---|---|
| 2026-11-26 | Thursday | Closed (Thanksgiving) |
| 2026-11-27 | Friday | Early close at 13:00 ET (18:00 UTC) |

## 0. Preconditions

Work in the checkout you will deploy from.

1. Bring `main` up to date and make sure the contracts are the committed ones:

   ```bash
   git fetch origin
   git switch main
   git pull --ff-only
   git rev-parse HEAD origin/main      # the two lines must be equal
   git status --short -- contracts     # must print nothing
   ```

2. Prove that `main` has the mainnet mandate (`feat/mainnet-config`):

   ```bash
   grep -n "maxSlippageBps:" contracts/script/MaatConfig.sol
   grep -n "maxStaleness:" contracts/script/MaatConfig.sol
   ```

   Expected (the line numbers are those of `feat/mainnet-config` and can move; the values cannot):

   ```text
   27:            maxSlippageBps: 150,
   32:            maxStaleness: 25 hours,
   ```

   If either line shows `100` or `3600`, stop. That is the old mandate, and it must never be deployed.

3. Prove that `main` has the optional second payee (`feat/deploy-payees`):

   ```bash
   grep -n "MAAT_EXPENSE_PAYEE_2" contracts/script/Deploy.s.sol contracts/.env.example
   ```

   It must print lines from both files. If it prints nothing, `feat/deploy-payees` is not merged yet.

4. Run CI with the pre-flip scan on `main` and wait for it to finish green:

   ```bash
   gh workflow run ci.yml --ref main -f pre_flip=true
   gh run list --workflow ci.yml --event workflow_dispatch --limit 1
   gh run view <run id> --json jobs --jq '.jobs[] | "\(.name) \(.conclusion)"'
   ```

   Every job must print `success`, `preflip` included. The `preflip` job scans every pull-request ref, every commit message, and the current text of every pull request, issue and comment.

5. Skim the pull-request and issue text yourself (20 minutes). The scan reads each body as it is now, but GitHub also shows the earlier versions of an edited body or comment. Open the edit history of every edited pull-request or issue body and comment, and look for anything that must not be public:

   ```bash
   gh pr list --state all --limit 200
   gh issue list --state all --limit 200
   ```

## 1. Go public (owner, GitHub settings)

1. Check the visibility:

   ```bash
   gh repo view --json visibility --jq .visibility
   ```

   If it prints `PUBLIC`, go on to item 2. If it prints `PRIVATE`, make it public only after step 0 is green: Settings → General → Danger Zone → Change repository visibility.

2. Check the two settings that follow the flip: a ruleset on `main` (it requires the `summary` check and blocks force pushes and deletions) and private vulnerability reporting.

   ```bash
   gh api "repos/{owner}/{repo}/rulesets" --jq '.[] | "\(.name) \(.enforcement)"'
   gh api "repos/{owner}/{repo}/private-vulnerability-reporting" --jq .enabled
   ```

   The first must list an `active` ruleset; the second must print `true`. Otherwise add the ruleset in Settings → Rules → Rulesets and enable private reporting in Settings → Code security.

## 2. Builder Code and Base Dashboard (owner)

1. Register the project at https://dashboard.base.org, then open **Settings** → **Project Settings** → **Builder Code**, the path Base's [Builder Codes page](https://docs.base.org/base-chain/quickstart/builder-codes) gives ([`agent/README.md`](../agent/README.md#live-run-owner-only), step 1, covers the same registration).
2. Write the code down exactly as shown. It must match `^[a-z0-9_]{1,32}$` (`BUILDER_CODE_RE` in `agent/src/exec/builderCode.ts`); the tools here refuse any other code.
3. Use the code as it is, never a hex form copied from a web page: `first-decision.ts` and the agent encode it themselves with `Attribution.toDataSuffix` from `ox/erc8021`, the ERC-8021 schema-0 suffix.

Only transactions whose calldata ends with this suffix carry the code. The deploy, `approve`, `fund` and `setExecutor` do not; the two first-decision sends and every agent transaction do.

## 3. Wallet and env (owner)

1. Import your wallet into a Foundry keystore and print its address (the second command signs nothing and sends nothing):

   ```bash
   cast wallet import maat-owner --interactive
   cast wallet address --account maat-owner
   ```

2. In `contracts/`, create `.env` from `.env.example` if it does not exist (`cp .env.example .env`), then set:

   | Variable | Value |
   |---|---|
   | `BASE_RPC_URL` | Your Base mainnet RPC URL |
   | `MAAT_DEPLOYER` | The address printed above (the `--account` wallet) |
   | `MAAT_OWNER` | Your wallet address. **Immutable** on the vault and the calendar |
   | `MAAT_EXECUTOR` | Your wallet address (step 9 hands the role to the CDP wallet) |
   | `MAAT_EXPENSE_PAYEE` | Your wallet address |
   | `MAAT_EXPENSE_PAYEE_2` | The zero address, unless you want a second payee now (adding one later takes `queuePayee` and the 24 hour timelock). It must differ from `MAAT_EXPENSE_PAYEE` |
   | `ETHERSCAN_API_KEY` | An Etherscan v2 key, for `--verify` on Basescan |

   Never commit `contracts/.env`; `.gitignore` already lists it.

3. Check the tools: use Foundry 1.8.4 or newer (`forge --version`; CI pins 1.9.0; [`README.md`](README.md#foundry), "Foundry") and run every `forge` command from `contracts/`, where `foundry.toml` sets `hardfork = "base:Cobalt"`. The B20 stocks are precompiles and the vault's constructor reads them, so the deploy needs that setting. If `contracts/lib/forge-std` is empty, run `git submodule update --init` at the repository root.
4. Put enough ETH on Base in the wallet for 4 contract deployments and a few calls. The simulation in step 4 prints the estimated gas.

## 4. Dry run, then check the addresses (owner)

Simulate with the real `.env`: no `--broadcast`, no key.

```bash
cd contracts
set -a; source .env; set +a
forge script script/Deploy.s.sol --rpc-url "$BASE_RPC_URL"
```

Read the output and check, character by character against the address `cast wallet address --account maat-owner` printed:

- `deployer`
- `owner (immutable)`: a wrong owner means permanent loss of control of the vault and its funds
- `executor`
- `expense payee`
- `expense payee 2`: `none`, or the second payee you set

The simulation must finish with no `vault address mismatch`. From now until the broadcast ends, send no other transaction from the deployer wallet: the script computes the vault address from its nonce.

Then, still before step 5 and in the same shell, run three read-only checks on NVDAc (owner-run). They are `cast call`s: they sign nothing, send nothing and cost nothing. They repeat two checks the vault runs before its market-hours check (`GuardLib.checkMarket`, `contracts/src/GuardLib.sol` lines 46-48). If either fails, Saturday's intent comes back `TOKEN_PAUSED` (4) or `POLICY_BLOCKED` (5) instead of `MARKET_CLOSED` (6), and Monday's BUY is refused the same way.

```bash
NVDAC=0xb20000000000000000000078ee7ce2fE4908108C
REGISTRY=0x8453000000000000000000000000000000000002
cast call "$NVDAC" "isPaused(uint8)(bool)" 0 --rpc-url "$BASE_RPC_URL"
POLICY=$(cast call "$NVDAC" "policyId(bytes32)(uint64)" "$(cast keccak TRANSFER_EXECUTOR_POLICY)" --rpc-url "$BASE_RPC_URL" | cut -d' ' -f1)
echo "$POLICY"
cast call "$REGISTRY" "isAuthorized(uint64,address)(bool)" "$POLICY" "$MAAT_EXECUTOR" --rpc-url "$BASE_RPC_URL"
```

The signatures are those of `contracts/src/interfaces/IB20Asset.sol`: `isPaused(uint8)` (line 12), `policyId(bytes32)` (line 13) and `isAuthorized(uint64,address)` (line 20). The registry address is `POLICY_REGISTRY` (line 25, and `script/BaseAddresses.sol` line 7). `MAAT_EXECUTOR` is your wallet here: it sends `execute` in steps 7 and 8, so it is the `tx.origin` the vault checks.

| Call | Go on when it prints | Stop when it prints |
|---|---|---|
| `isPaused` with `0` (`FEATURE_TRANSFER`, line 26; `GuardLib.tokenPaused` passes it, `GuardLib.sol` line 66) | `false` | `true`, or an error: the vault counts a paused token, and a read that reverts, as `TOKEN_PAUSED` (`GuardLib.sol` lines 64-71) |
| `policyId` for `keccak256("TRANSFER_EXECUTOR_POLICY")` (line 29), the policy of the executor leg | A number. `0` means always allow: the vault then asks the registry nothing (`GuardLib.sol` line 165), so skip the third call | An error, or an empty line: the vault answers `POLICY_BLOCKED` (`GuardLib.sol` lines 171-173) |
| `isAuthorized` with that number and your wallet | `true` | `false`, or an error: on every BUY and SELL the vault checks `tx.origin` against this policy (`GuardLib.sol` lines 151 and 155), so it answers `POLICY_BLOCKED` |

On a stop, do not broadcast; find out why first. The vault also checks the pool (as sender and executor) and the vault itself (as receiver) on a BUY (`GuardLib.sol` lines 150-151). The vault has no address before step 5, so the step 7 preview covers those legs. After step 9 the CDP executor sends `execute`, so before its `setExecutor` there, run the third call again with the CDP address in place of `$MAAT_EXECUTOR`, and with `--rpc-url "$RPC"` if that shell unset `BASE_RPC_URL` (in a new shell, set `REGISTRY` and `POLICY` again as above first).

## 5. Broadcast with --verify (owner)

```bash
set -a; source .env; set +a
forge script script/Deploy.s.sol --rpc-url "$BASE_RPC_URL" --account maat-owner --broadcast --verify --slow
```

`--slow` sends the four deploy transactions one at a time: Foundry's help says it "Makes sure a transaction is sent, only after its previous one has been confirmed and succeeded." Without it they go out back to back.

If the deploy finishes but verification fails, do not redeploy:

```bash
forge script script/Deploy.s.sol --rpc-url "$BASE_RPC_URL" --account maat-owner --resume --verify --slow
```

Copy the four addresses from the output into the table in step 10; the deploy transactions are in `contracts/broadcast/Deploy.s.sol/8453/run-*.json`. Then read the vault back:

```bash
VAULT=0x...      # MandateVault from the output
CALENDAR=0x...   # MarketCalendar from the output
cast call "$VAULT" "owner()(address)" --rpc-url "$BASE_RPC_URL"
cast call "$VAULT" "executor()(address)" --rpc-url "$BASE_RPC_URL"
cast call "$VAULT" "payees()(address[])" --rpc-url "$BASE_RPC_URL"
cast call "$CALENDAR" "owner()(address)" --rpc-url "$BASE_RPC_URL"
cast call "$VAULT" "mandate()((uint8,uint16,uint16,uint32,uint32,uint32,uint128,uint128,address,address,address,uint64,uint64,uint32))" --rpc-url "$BASE_RPC_URL"
```

Both `owner()` calls and `executor()` must print your wallet address. `payees()` must print `[<your wallet>]`, or `[<your wallet>, <the second payee you set>]` if you set `MAAT_EXPENSE_PAYEE_2`. In the `mandate()` tuple, the third value is `maxSlippageBps` and must be `150`, and the fourth is `maxStaleness` and must be `90000` (25 hours).

## 6. Fund and approve (owner)

Fund with `approve` and then `fund(amount)`, never a plain USDC transfer: `notifyRevenue()` would count a direct transfer as revenue. Amounts are USDC units (6 decimals): `20000000` is 20 USDC, `100000000` is 100 USDC. Use the same amount in both calls.

```bash
USDC=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
cast send "$USDC" "approve(address,uint256)" "$VAULT" 20000000 --rpc-url "$BASE_RPC_URL" --account maat-owner
cast send "$VAULT" "fund(uint256)" 20000000 --rpc-url "$BASE_RPC_URL" --account maat-owner
cast call "$VAULT" "recordedUsdc()(uint256)" --rpc-url "$BASE_RPC_URL"   # the amount you funded
```

Fund at least 20 USDC. Monday's 5 USD BUY must stay within the 40% weight cap (`maxWeightBps: 4000` in `MaatConfig.basket`), and 5 USD is 25% of a vault that holds 20 USDC.

## 7. First Decision while NYSE is closed (owner)

Do this any time on Saturday or Sunday (UTC). Your wallet is still the executor, so it sends the intent. Use the shell from step 6: it is still in `contracts/` (step 4 went there), with `VAULT` and `BASE_RPC_URL` set. In a new shell, run `set -a; source contracts/.env; set +a` from the repository root and set `VAULT` again.

1. Build the intent offline with [`agent/scripts/first-decision.ts`](../agent/scripts/first-decision.ts). It makes no network call, reads no `.env`, holds no key and sends nothing. The `cd` below works from `contracts/` and from the repository root:

   ```bash
   cd "$(git rev-parse --show-toplevel)/agent"
   npm ci
   node --import tsx scripts/first-decision.ts --vault "$VAULT" --token NVDAc --usd 5 --salt sat-1 --builder-code <your code>
   ```

   It prints the intent, the `previewIntent` calldata, the `execute` calldata with your Builder Code suffix appended, and OWNER-RUN command templates. The intent is the one the agent builds for a BUY (`buildIntent` in `agent/src/intent.ts`), with:

   - `id` = the agent's `intentId("first-decision:<salt>", 0)`. The vault accepts each id once; a reused id makes `execute` revert with `IntentAlreadyUsed`, so every send needs a new salt.
   - `amount` = the dollars in USDC units (`5000000` for 5 USD).
   - `minOut` = `0`, as the agent sends it. The tool reads no price and needs none: for a BUY the vault swaps with the larger of `intent.minOut` and its own oracle floor, `expectedOut x (10000 - maxSlippageBps) / 10000` from the Chainlink price (`MandateVault._perform`). A floor set offline could only be stale.
   - `rationaleHash` = keccak256 of the rationale text it prints. Keep that text in step 10: the chain stores only its hash.

   It builds BUY only: a SELL amount is a raw stock amount, which takes the live price.

2. Set `RPC` for the templates, then run them in order:

   ```bash
   RPC="$BASE_RPC_URL"
   ```

   - **a.** `cast decode-calldata ...`: offline; the decoded tuple must match the printed intent.
   - **b.** `EXECUTOR=$(cast call ...)`, then `cast call "$VAULT" --data <preview calldata> --from "$EXECUTOR" ...` and `cast to-dec` on its output. It must print `6` (`MARKET_CLOSED`). The call is read-only and free; it runs from the executor because the vault's transfer-policy check reads `tx.origin`.
   - **c.** `cast send "$VAULT" --data <execute calldata> --gas-limit 2500000 --account <your-keystore> ...`, with `maat-owner` as the keystore. Keep the gas limit: it is the agent's `execute` floor (`EXECUTE_GAS_FLOOR` in `agent/src/exec/calls.ts`), because a plain estimate can starve the vault's inner swap.
   - **d.** `cast receipt <tx hash> ...` and `cast decode-event --sig "Decision(...)" <data>` on the log whose topic 1 is the intent id. It prints the action, the amount, `allowed`, the reason and the rationale hash.

   If the preview prints anything but `6`, do not send; find out why first. `TOKEN_PAUSED` (4) and `POLICY_BLOCKED` (5) come from checks that run before the market-hours check, `TOKEN_NOT_ALLOWED` (3) means the token is not allowed in the vault, and `VAULT_PAUSED` (1) means `setPaused(true)` was called. The tool prints every reason id.

3. Expected result: the transaction succeeds (a refusal does not revert), and its `Decision` log has `allowed=false` and reason `6`. On Basescan, open `https://basescan.org/tx/<tx hash>`:

   - **Logs** tab: the `Decision` event, with `intentId` equal to the printed id, `allowed` false and `reason` 6. Basescan decodes it once the vault is verified (step 5); otherwise use template **d**.
   - **Input Data**: it ends with the Builder Code suffix the tool printed (`...0080218021802180218021802180218021`).

   Then check the attribution a second way, with the [Builder Code Validation](https://builder-code-checker.vercel.app/) tool that Base's [Builder Codes page](https://docs.base.org/base-chain/quickstart/builder-codes) links under "How Do I Verify That My Transaction Was Properly Attributed?": select the transaction type, enter the transaction hash and click **Check Attribution**.

   The vault's own event list is at `https://basescan.org/address/<vault address>`.

## 8. Monday 2026-11-23, at or after 14:30 UTC (owner)

Send the same intent with a new salt, so a new id. Run it from `agent/`, in a shell where `VAULT` and `RPC` are set as in step 7:

```bash
node --import tsx scripts/first-decision.ts --vault "$VAULT" --token NVDAc --usd 5 --salt mon-1 --builder-code <your code>
```

1. Run template **b** first. Send only when it prints `0` (`OK`). If it prints:
   - `10` (`PREMIUM_TOO_HIGH`): the 30-minute TWAP still differs from the oracle by more than `maxPremiumBps`. [`README.md`](README.md#default-mandate) (Default mandate) records that, in simulated BUYs with this mandate, most NVDAc refusals left were of this kind, in the first 45 minutes after the open. Wait and preview again.
   - `7` (`FEED_STALE`): the Chainlink answer is older than `maxStaleness`. Wait for a feed update and preview again.
   - `14` (`INSUFFICIENT_BALANCE`): the vault holds less than 5 USDC (step 6).
   - `12` (`CONCENTRATION`): the BUY would put more than 40% of the vault in NVDAc, so fund more (step 6). It is also the answer when the credit adapter's views cannot be read ([`README.md`](README.md#unwinding-the-credit-position-owner-only), "Unwinding the credit position").
   - `6` (`MARKET_CLOSED`): it is outside 14:30 to 21:00 UTC, or a holiday.
2. Run templates **c** and **d**. Expected: `Decision` with `allowed=true` and reason `0`, and NVDAc in the vault:

   ```bash
   cast call 0xb20000000000000000000078ee7ce2fE4908108C "balanceOf(address)(uint256)" "$VAULT" --rpc-url "$RPC"
   ```

If `execute` returns `allowed=false` anyway (for example `SWAP_FAILED`, which a preview cannot predict), that id is used up. Preview again and send with a new salt.

## 9. Hand over to the agent (owner)

Follow [`agent/README.md`](../agent/README.md#live-run-owner-only), "Live run (owner only)".

Use two shells here. Run the `cast` commands of item 2 in the shell from step 7 or 8, where `VAULT` and `RPC` are set. Run `scripts/cdp-setup.ts` and `npm run agent` from `agent/` in a new shell that has never sourced `contracts/.env`. Node's `--env-file` never replaces a variable that is already set in the environment, so in the shell of steps 4 to 8 the agent would take `MAAT_EXECUTOR` (your wallet) and `MAAT_EXPENSE_PAYEE` from `contracts/.env`, not from `agent/.env`. In live mode it then stops at startup with `CDP account "<NAME>" is <ADDRESS>, which does not match MAAT_EXECUTOR <ADDRESS>`; in dry-run mode every round ends `wrong-executor` once the vault's executor is the CDP address. To reuse a shell that sourced `contracts/.env`, first run `unset BASE_RPC_URL MAAT_DEPLOYER MAAT_OWNER MAAT_EXECUTOR MAAT_EXPENSE_PAYEE MAAT_EXPENSE_PAYEE_2 ETHERSCAN_API_KEY`. Item 2 still runs after that, because it reads `RPC`, not `BASE_RPC_URL`: step 7 set `RPC` after `set +a`, so it is not exported, the `unset` leaves it, and the agent never sees it. If `test -n "$RPC" && echo set || echo empty` prints `empty`, set it again by hand (`RPC=<your Base mainnet RPC URL>`, without `export`); the check does not print the URL.

In short, and only as that page says:

1. Set up CDP and run `scripts/cdp-setup.ts` once, as the README shows. It prints the CDP executor address.
2. Point the vault at that address ([`README.md`](README.md#switch-the-executor-to-the-cdp-server-wallet-owner-only), "Switch the executor to the CDP Server Wallet"):

   ```bash
   EXECUTOR=0x...   # the address cdp-setup.ts printed
   cast send "$VAULT" "setExecutor(address)" "$EXECUTOR" --rpc-url "$RPC" --account maat-owner
   cast call "$VAULT" "executor()(address)" --rpc-url "$RPC"   # must print $EXECUTOR
   ```

   `setExecutor` takes effect at once, with no timelock (`MandateVault.sol`, lines 139-143). From then on your wallet can no longer call `execute` (it reverts with `NotExecutor`), so `first-decision.ts` sends stop working for you. To take the role back, call `setExecutor` with your own address.
3. Send a little ETH on Base to the executor for gas (the README says about 0.002 ETH).
4. In `agent/.env` (from `agent/.env.example`), set the settings the README lists, with `MAAT_EXECUTOR` set to the CDP address and `MAAT_MODE=live`. Run `npm run agent -- --once` and check its transaction on Basescan: the input data must end with your Builder Code. Then run `npm run agent` to keep it going. Every round calls Claude, a paid API, in dry-run and live mode alike.

The agent pays one address only, its own `MAAT_EXPENSE_PAYEE` setting. It must be a payee the vault allowlisted at deploy (`MAAT_EXPENSE_PAYEE` or `MAAT_EXPENSE_PAYEE_2`); any other address gets `PAYEE_NOT_ALLOWED`.

## 10. Record

Fill this in as you go. Leave a cell empty until you have the real value.

| What | Address or value | Tx hash | Notes |
|---|---|---|---|
| Owner wallet (deployer, owner, first executor, first payee) | | | |
| Second payee (`MAAT_EXPENSE_PAYEE_2`) | | | |
| Builder Code | | | |
| `main` commit deployed | | | |
| MarketCalendar | | | |
| AerodromeSwapAdapter | | | |
| AaveV4CreditAdapter | | | |
| MandateVault | | | |
| USDC `approve` | | | |
| `fund(amount)` | | | |
| Saturday intent: salt, id, rationale text | | | |
| Saturday `previewIntent` result | | | |
| Saturday `execute` and its `Decision` | | | |
| Monday intent: salt, id, rationale text | | | |
| Monday `previewIntent` result | | | |
| Monday `execute` and its `Decision` | | | |
| CDP executor | | | |
| `setExecutor` | | | |
| Executor gas funding | | | |
| First agent transaction (`--once`) | | | |

Then put the four contract addresses and deploy transactions in the table at the top of [`README.md`](README.md), on a branch. The docs site generates `web/content/generated/deployments.json` from that table, and `web/test/docs-gen.test.ts` fails until it is regenerated, so run `npm run docs:gen` in `web/` and commit that file in the same branch.
