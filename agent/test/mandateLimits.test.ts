import { getAddress, type Address } from "viem";
import { describe, expect, it } from "vitest";
import { BASKET } from "../src/addresses.js";
import { readVaultState } from "../src/chain/state.js";
import { briefSystemPrompt, renderBriefMessage, renderUserMessage, SYSTEM_PROMPT, systemPrompt } from "../src/llm/prompt.js";
import { ClaudeProposer, type CreateMessage, type ProposerInput } from "../src/llm/proposer.js";
import { evaluatePolicy } from "../src/policy.js";
import { FEEDS, MANDATE, POOL, VAULT, standardScene, type FakeChain } from "./fakes/fakeChain.js";

/*
 * The thresholds MandateVault checks a trade against reach Claude in the user message, read from the vault's mandate()
 * and tokenConfig(), and the system prompt asks for intents the vault is expected to allow. On 27 Nov, when the user
 * message carried the dollar caps alone, the AAPLc buy of the 15:15 UTC round said its 36-minute-old feed might make the
 * vault refuse, against a maxStaleness of 90,000 s, and the 02:14 UTC summary proposed two buys so that their refusals
 * would be on record (the agent-journal branch, journal/2026-11-27.jsonl lines 2 and 23).
 */

type View = {
  marketOpen: boolean | null;
  maxStalenessSec: number;
  credit: { deriskWindowSec: number } | null;
  limits: {
    perTradeUsd: number;
    dailyUsd: number;
    spentTodayUsd: number;
    sessionMode: string | number;
    maxPremiumBps: number;
    maxSlippageBps: number;
    maxWeightPct: Record<string, number>;
  };
};

const view = (msg: string) => JSON.parse(msg.slice("Current state:\n".length, msg.indexOf("\n\nDecide this round's actions."))) as View;

async function inputFrom(f: FakeChain, creditActions = false): Promise<ProposerInput> {
  const state = await readVaultState(f.client(), VAULT);
  return { state, policy: evaluatePolicy(state, { dailyComputeUsd6: 500_000n, unpaidUsd6: 0n }), billUsd6: 0n, creditActions };
}

/** A mandate and token configs unlike the standard scene's in every threshold the user message carries. */
function otherScene(sessionMode = 1): FakeChain {
  const weights = [2500, 4000, 1250];
  return standardScene()
    .set(VAULT, "mandate", { ...MANDATE, sessionMode, maxPremiumBps: 250, maxSlippageBps: 75, maxStaleness: 3600, deriskWindow: 0 })
    .set(VAULT, "tokenConfig", (args) => {
      const i = BASKET.findIndex((t) => getAddress(t.address) === getAddress(args[0] as Address));
      return [true, FEEDS[i], POOL, weights[i]];
    });
}

/** Every threshold name the system prompt tells Claude to check a trade against. */
const NAMED = ["maxStalenessSec", "perTradeUsd", "spentTodayUsd", "dailyUsd", "maxWeightPct", "maxPremiumBps", "maxSlippageBps"];

describe("the mandate's limits in the user message", () => {
  it("carry the thresholds the vault checks a trade against, at the standard scene's mandate", async () => {
    const v = view(renderUserMessage(await inputFrom(standardScene())));
    expect(v.maxStalenessSec).toBe(90_000);
    expect(v.limits).toEqual({
      perTradeUsd: 50,
      dailyUsd: 100,
      spentTodayUsd: 0,
      sessionMode: "REGULAR",
      maxPremiumBps: 100,
      maxSlippageBps: 150,
      maxWeightPct: { NVDAc: 40, GOOGLc: 40, AAPLc: 40 },
    });
    expect(v.credit?.deriskWindowSec).toBe(28_800);
  });

  it("are read from the vault's mandate() and tokenConfig(), not typed into the agent", async () => {
    const f = otherScene();
    const v = view(renderUserMessage(await inputFrom(f)));
    expect(v.maxStalenessSec).toBe(3600);
    expect(v.limits).toMatchObject({
      sessionMode: "FEED_24_5",
      maxPremiumBps: 250,
      maxSlippageBps: 75,
      maxWeightPct: { NVDAc: 25, GOOGLc: 40, AAPLc: 12.5 },
    });
    expect(v.credit?.deriskWindowSec).toBe(0);
    const read = (fn: string) => f.calls.filter((c) => getAddress(c.address) === getAddress(VAULT) && c.functionName === fn);
    expect(read("mandate")).toHaveLength(1);
    expect(read("tokenConfig").map((c) => getAddress(c.args[0] as Address))).toEqual(BASKET.map((t) => getAddress(t.address)));
  });

  it("name the session mode as the vault's SessionMode enum does, and keep a number the enum does not have", async () => {
    expect(view(renderUserMessage(await inputFrom(otherScene(0)))).limits.sessionMode).toBe("REGULAR");
    expect(view(renderUserMessage(await inputFrom(otherScene(7)))).limits.sessionMode).toBe(7);
  });

  it("are the same in the user message of a round that carries briefs", async () => {
    const i = await inputFrom(standardScene());
    expect(view(renderBriefMessage({ ...i, briefs: [] }, "0123456789abcdef"))).toEqual(view(renderUserMessage(i)));
  });

  it("hold every threshold the system prompt names, as a number", async () => {
    const v = view(renderUserMessage(await inputFrom(standardScene())));
    const flat: Record<string, unknown> = { maxStalenessSec: v.maxStalenessSec, ...v.limits };
    for (const name of NAMED) {
      expect(SYSTEM_PROMPT, name).toContain(name);
      const value = flat[name];
      const numbers = typeof value === "object" && value !== null ? Object.values(value) : [value];
      expect(numbers.length, name).toBeGreaterThan(0);
      for (const n of numbers) expect(typeof n, name).toBe("number");
    }
  });

  it("reach a fake model in the request's user message", async () => {
    const seen: Record<string, unknown>[] = [];
    const create: CreateMessage = async (p) => {
      seen.push(p);
      return {
        model: "claude-sonnet-5-5",
        stop_reason: "end_turn",
        content: [{ type: "text", text: '{"summary":"Nothing to propose.","intents":[]}' }],
        usage: { input_tokens: 10_000, output_tokens: 1_000 },
      };
    };
    const i = await inputFrom(standardScene());
    await new ClaudeProposer({ model: "claude-sonnet-5-5", create }).propose(i);
    const content = (seen[0]!.messages as { content: string }[])[0]!.content;
    expect(content).toBe(renderUserMessage(i));
    for (const line of ['"maxStalenessSec": 90000', '"sessionMode": "REGULAR"', '"maxPremiumBps": 100', '"maxSlippageBps": 150', '"NVDAc": 40', '"deriskWindowSec": 28800']) {
      expect(content).toContain(line);
    }
  });
});

describe("the system prompt on refusals", () => {
  const prompts = {
    "credit off": systemPrompt({ creditActions: false }),
    "credit on": systemPrompt({ creditActions: true }),
    "briefs, credit off": briefSystemPrompt({ creditActions: false }),
    "briefs, credit on": briefSystemPrompt({ creditActions: true }),
  };

  it("no longer invites a trade the vault would refuse because the refusal is worth recording", () => {
    for (const [name, p] of Object.entries(prompts)) {
      const flat = p.replace(/\s+/g, " ");
      expect(flat, name).not.toMatch(/worth recording/i);
      expect(flat, name).not.toMatch(/refusal itself/i);
      expect(flat, name).not.toMatch(/you may still propose/i);
    }
  });

  it("asks for intents the vault is expected to allow and that fit the policy, and none while a refusal is certain", () => {
    for (const [name, p] of Object.entries(prompts)) {
      const flat = p.replace(/\s+/g, " ");
      for (const rule of [
        "Propose an intent when you expect the vault to allow it and it fits the policy; leave out any other.",
        "a feed is stale when its feedAgeSeconds is above maxStalenessSec;",
        "a trade must fit perTradeUsd and what spentTodayUsd leaves of dailyUsd;",
        "a buy must leave the stock at or below its maxWeightPct of the vault's USDC plus stocks;",
        "the pool's TWAP must sit within maxPremiumBps of the feed price;",
        "a swap that fills more than maxSlippageBps below the feed price fails.",
        "While the market is closed the vault refuses every trade, and while a feed is stale it refuses trades in that stock: propose none of those.",
        "Compute bills are settled automatically; do not propose them.",
      ]) {
        expect(flat, `${name}: ${rule}`).toContain(rule);
      }
    }
  });

  it("puts a feed's age next to the vault's limit, as in the 15:15 UTC round of 27 Nov", async () => {
    // AAPLc's feed 36 minutes old in an open market: under 90,000 s, so the vault does not call it stale.
    const f = standardScene();
    f.set(FEEDS[2]!, "latestRoundData", [1n, 27000000000n, 0n, f.block.timestamp - 2160n, 1n]);
    const msg = renderUserMessage(await inputFrom(f));
    expect(view(msg).marketOpen).toBe(true);
    expect(view(msg).maxStalenessSec).toBe(90_000);
    expect(msg).toContain('"feedAgeSeconds": 2160');
  });
});
