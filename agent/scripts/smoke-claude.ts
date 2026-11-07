import { readVaultState } from "../src/chain/state.js";
import { ClaudeProposer } from "../src/llm/proposer.js";
import { evaluatePolicy } from "../src/policy.js";
import { VAULT, standardScene } from "../test/fakes/fakeChain.js";

const state = await readVaultState(standardScene().client(), VAULT);
const policy = evaluatePolicy(state, { dailyComputeUsd6: 500_000n, unpaidUsd6: 0n });
const out = await new ClaudeProposer({ model: "claude-sonnet-5-5" }).propose({ state, policy, billUsd6: 0n });
console.log(JSON.stringify(out, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
