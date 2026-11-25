# MaatInbox: Briefs to the Agent. Design Spec

- **Date:** 2026-11-25
- **Status:** the outsider path and the bounty terms in §6 were approved by the owner on 2026-11-25. The team set in §5 is **for owner approval**.
- **Lives at:** `contracts/src/MaatInbox.sol` and `contracts/script/DeployMaatInbox.s.sol`; read by the agent (branch `feat/agent-briefs`) and by the site's `/ask` and `/proof` pages
- **Related:** `docs/superpowers/specs/2026-11-06-mandate-treasury-design.md` (the vault)

## 1. Goal

Anyone on Base can brief Maat's agent with one zero-value transaction: "buy more NVDAc", "sell it all now". Claude reads the brief as untrusted data and may adopt it into an intent; the vault decides, and the Decision is onchain. Claude can be persuaded; the vault is the boundary.

## 2. The contract

```solidity
uint256 public constant MAX_BYTES = 280;
uint256 public lastId;
event Brief(uint256 indexed id, address indexed from, string text);
error BadLength(uint256 length);
function brief(string calldata text) external returns (uint256 id);
```

- `brief` accepts 1 to 280 bytes of `text` and reverts with `BadLength(length)` otherwise. The limit is in bytes, not characters, and the contract does not check UTF-8, so readers decode leniently and render plain text. The `/ask` feed replaces the same control and direction code points as the agent's prompt (§3) before it shows a brief.
- Ids start at 1 and grow by exactly 1 across all senders. `lastId` is the last id given, so it is also the number of briefs. It is the only storage slot.
- `from` is `msg.sender`. For a Base Account it is the smart wallet; a brief relayed through another contract counts as that contract's.
- No owner, no pause, no upgrade, no funds: `brief` is not payable and there is no `receive` or `fallback`, so every call that carries ether reverts.
- Calldata after the ABI-encoded string is ignored, so the transaction can end with the ERC-8021 Builder Code suffix.
- It cannot change. A new rule means a new contract.

## 3. What the agent reads (branch `feat/agent-briefs`, tag `agent-r3`)

- **Source:** `Brief` logs of the inbox address recorded in `deployments/`, in id order, read only up to the `safe` block tag with the windowed `getLogs` of `fix/refusal-log-per-session` (#40). No recorded address, no briefs. A brief is identified by (id, txHash, logIndex), so a reorg cannot attach an earlier reply or refusal to another brief, and a journal row whose log no longer exists is dropped.
- **Caps:** at most 3 briefs a round, 20 a day and 2 per sender a day. A brief over the round cap waits for the next round; a brief over the day or sender cap is journaled as skipped, with the cap's name, and never reaches Claude. Every "a day" in this section is a UTC day (block timestamp / 86,400), the same day the tx cap and the vault's daily cap use.
- **Brief budget:** at most 5 brief-driven transactions a day, inside `MAAT_MAX_TX_PER_DAY` (`agent/src/config.ts:28`), and at most $0.25 a day of the $0.75 daily LLM cap (`MAAT_MAX_LLM_USD_PER_DAY`, added in `feat/agent-guardrails`, #47). When either is spent, briefs are journaled and not sent to Claude. A flood of briefs from cheap wallets can then never halt the agent at its tx cap or starve its own rounds of Claude.
- **Untrusted data:** each brief reaches Claude only as a quoted `{id, from, text}` field in a prompt section marked untrusted, never inside the instructions. `text` is one JSON string: `JSON.stringify` of the leniently decoded text, with C0 and C1 controls, U+200B to U+200F, U+202A to U+202E and U+2066 to U+2069 replaced by U+FFFD, so a brief can neither close the section nor reorder what a reader sees. Claude answers each in at most 200 characters (`replies` in the output schema) and may adopt one to three briefs into an intent that cites their ids in `q`.
- **Templated blob text:** a brief-driven Decision's rationale blob is a fixed template filled with typed fields (`q`, action, token, amount). Neither the brief nor Claude's free text reaches Maat's calldata; replies go to the journal only.
- **Refusals:** keyed by brief id, not by the once-a-day refusal key, so "vault refused" counts real attempts.
- **Bounds that still hold:** Claude's action set has no transfer (`agent/src/llm/schema.ts:3`); payees are an onchain allowlist; an adopted brief is still held to $50 a trade, $100 a day (`contracts/script/MaatConfig.sol:35-36`), the allowlisted tokens and 150 bps slippage (`:27`).
- **Tests:** 30 prompt-injection fixtures against a fake model in CI, and an owner-run `npm run eval:briefs`.

## 4. The `/ask` notice

`/ask` sends `brief` from an injected wallet (EIP-6963, viem `dataSuffix`) or a Base Account (`wallet_sendCalls` with the `dataSuffix` capability). It shows this notice, verbatim:

> Nobody trades through Maat; the vault trades only its own funds. Tokenized stocks are only available in eligible jurisdictions outside of the U.S.

The feed shows briefs and Claude's answers as plain text with no links. The owner can hide abusive text; a hidden brief still counts (§5).

## 5. The `/proof` counting rule

Merged at least 24 h before `/ask` opens. `scripts/recount.mjs` rebuilds every number from public logs over a keyless RPC.

**Lines kept apart.** No line is ever added to another. Each Decision gets one label, first match wins: owner by hand, probe, brief-driven, agent. The order and the blob fields `k` and `q` are those of §4 (Sender labels) of the maat:v1 rationale blob spec, `docs/superpowers/specs/2026-11-25-maat-v1-rationale-blob-design.md`.

| Line | Counts |
|---|---|
| Owner by hand | Transactions the owner signed (`tx.from == owner()`, checked first): deploys, funding, mandate changes, the first decisions |
| Agent | Every other executor Decision: not sent by the owner, not a probe (blob `k == "probe"`), not brief-driven (blob `q` present) |
| Probe | The agent's labeled probe Decisions (blob `k == "probe"`) |
| Outside briefs | `Brief` events from senders outside the team set: briefs, distinct wallets, and how many of those wallets hold a Verified Account |
| Brief-driven Decisions | Executor Decisions, not probes, whose blob `q` cites brief ids: vault allowed, vault refused |
| Team briefs | `Brief` events from the team set, never added to outside briefs |
| Hidden briefs | Outside briefs the owner hid from the feed. They stay in the outside count and are also listed here, so hiding never changes a number |
| Bounty claimants | §6 |

**Team set (for owner approval).**
- The owner, `0x3c3a66f713DAE7e4A03Bbd81dB79FF65F42C1D6a`: on 2026-11-25 it is the vault's `owner()`, `executor()` and only payee, and it sent the four deploy transactions in `deployments/README.md`.
- The CDP executor, once `setExecutor` hands it the role.
- The deployer of every Maat contract, `MaatInbox` included, and every address on the vault's `payees()`.
- Any wallet a team wallet funded within 2 hops: hop 1 received ETH or a token from a team wallet, hop 2 from a hop-1 wallet. Hops stop at the vault, pools, routers and exchange addresses, which the recount lists with a source. Token funding comes from `Transfer` logs; ETH funding, which leaves no log, comes from a committed list of each team wallet's sent transactions, checked against its nonce.

**Verified Account column.** For each counted outside wallet: whether it holds a Coinbase Verified Account attestation, with its EAS UID. The UID comes from a free `eth_call` to the Coinbase attestation indexer `0x2c7eE1E5f416dfF40054c27A62f7B357C4E8619C`, `getAttestationUid(wallet, 0xf8b05c79f090979bf4a80270aba232dff11a10d9ca55c4f88de95317970f0de9)`; the EAS schema registry `0x4200000000000000000000000000000000000020` lists that schema as `bool verifiedAccount` (both read on 2026-11-25). A UID counts only if EAS (`0x4200000000000000000000000000000000000021`) `getAttestation(uid)` shows it unrevoked, unexpired and issued to that wallet. The column informs the reader; it removes no one from the count.

**Never a user:** owner, agent, probe or team transactions. Briefs are never paid, rewarded or reciprocated, and outreach never asks anyone to send a brief to help a count.

## 6. Bounty

- At most $100, paid by the owner.
- Only for a reproduced vault false ALLOW: an intent outside the published mandate that `previewIntent` or `execute` on the live vault allows.
- Claimed with a free `previewIntent` call or a fork test, so no brief and no onchain transaction is needed. Persuading Claude does not win it: that is expected, harmless, and the show.
- Claimants get their own `/proof` line.

## 7. Deploy and schedule

The owner deploys from `contracts/`, with the same `.env` and keystore as the vault. Simulate first and check the `deployer` line against your wallet:

```bash
set -a; source .env; set +a
forge script script/DeployMaatInbox.s.sol --rpc-url "$BASE_RPC_URL"
forge script script/DeployMaatInbox.s.sol --rpc-url "$BASE_RPC_URL" --account maat-owner --broadcast --verify
```

If the deploy lands but verification fails, do not redeploy: run the second command with `--resume` in place of `--broadcast`. The address is then recorded in `deployments/`, and `/ask` stays hidden until it is.

Schedule: inbox, agent briefs and `/ask` green on a Base fork by Sun 29 Nov 23:59 UTC, or no deploy (`/ask` then ships as a free "ask the real vault" preview and traction stays agent-only); deploy and contract freeze Mon 30 Nov; `/ask` Tue 1 Dec.
