import { describe, expect, it } from "vitest";
import { readVaultState } from "../src/chain/state.js";
import { briefSystemPrompt, renderBriefMessage, renderUserMessage, SYSTEM_PROMPT, systemPrompt } from "../src/llm/prompt.js";
import { ClaudeProposer, type CreateMessage, type ProposerInput } from "../src/llm/proposer.js";
import { BatchSchema, MAX_AMOUNT_USD, MAX_INTENTS, MAX_RATIONALE_CHARS, MAX_SUMMARY_CHARS } from "../src/llm/schema.js";
import { evaluatePolicy } from "../src/policy.js";
import { BASKET } from "../src/addresses.js";
import { CALENDAR, FEEDS, MANDATE, PRICES, VAULT, standardScene } from "./fakes/fakeChain.js";

describe("prompt", () => {
  it("system prompt carries the mandate rules and stays free of volatile data", () => {
    expect(SYSTEM_PROMPT.startsWith("You are Maat's agent, the treasury agent of Maat, an onchain vault on Base.")).toBe(true);
    expect(SYSTEM_PROMPT).toContain('Motto: "Claude proposes. The vault decides."');
    expect(SYSTEM_PROMPT).not.toMatch(/LLM proposes|contract decides/);
    expect(SYSTEM_PROMPT).toMatch(/empty list/i);
    expect(SYSTEM_PROMPT).toMatch(/30%/);
    expect(SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}T/); // no timestamps: keeps the cache prefix stable
  });
  it("states the limits the zod schema enforces", () => {
    expect([MAX_INTENTS, MAX_RATIONALE_CHARS, MAX_SUMMARY_CHARS, MAX_AMOUNT_USD]).toEqual([6, 600, 1200, 1_000_000]);
    expect(SYSTEM_PROMPT).toContain("at most 6 intents");
    expect(SYSTEM_PROMPT).toContain("at most 600 characters");
    expect(SYSTEM_PROMPT).toContain("at most 1200 characters");
    const ok = { action: "BUY", symbol: "NVDAc", amountUsd: 1, rationale: "x".repeat(MAX_RATIONALE_CHARS) };
    expect(BatchSchema.safeParse({ summary: "s".repeat(MAX_SUMMARY_CHARS), intents: Array(MAX_INTENTS).fill(ok) }).success).toBe(true);
    expect(BatchSchema.safeParse({ summary: "s", intents: [{ ...ok, rationale: "x".repeat(MAX_RATIONALE_CHARS + 1) }] }).success).toBe(false);
    expect(BatchSchema.safeParse({ summary: "s".repeat(MAX_SUMMARY_CHARS + 1), intents: [] }).success).toBe(false);
  });
  it("user message shows state, weights, suggestions and the bill in dollars", async () => {
    const state = await readVaultState(standardScene().client(), VAULT);
    const policy = evaluatePolicy(state, { dailyComputeUsd6: 500_000n, unpaidUsd6: 120_000n });
    const msg = renderUserMessage({ state, policy, billUsd6: 120_000n, creditActions: false });
    expect(msg).toContain('"usdc": 100');
    expect(msg).toContain('"marketOpen": true');
    expect(msg).toContain('"unpaidComputeBill": 0.12');
    expect(msg).toContain('"NVDAc"');
    expect(msg).toContain('"suggestions"');
    expect(msg).toContain('"creditActions": "off"');
    expect(msg).not.toMatch(/\d+n\b/); // no raw bigint leakage
  });

  describe("credit actions", () => {
    const off = systemPrompt({ creditActions: false });
    const on = systemPrompt({ creditActions: true });
    const creditPolicy = [
      "Stocks held in the vault should be supplied as collateral",
      "Borrow USDC only to keep 7 days of compute costs",
      "Repay debt when new revenue arrives",
      "can borrow USDC against them on Aave V4",
    ];

    it("off (the default prompt): says so, names every credit action, and drops the supply, borrow and repay policy", () => {
      expect(SYSTEM_PROMPT).toBe(off);
      expect(off).toContain("has an Aave V4 credit line, which is switched off");
      expect(off).toContain("Credit actions are off: never propose SUPPLY, WITHDRAW_COLLATERAL, BORROW or REPAY.");
      for (const line of creditPolicy) expect(off).not.toContain(line);
    });

    it("on: keeps the supply, borrow and repay policy, and the rest of the prompt is the same", () => {
      for (const line of creditPolicy) expect(on).toContain(line);
      expect(on).not.toContain("Credit actions are off");
      const tail = (p: string) => p.slice(p.indexOf("- Never predict prices."));
      expect(tail(on)).toBe(tail(off));
      expect(on).toContain("at most 6 intents");
    });

    it("the user message says whether credit actions are on", async () => {
      const state = await readVaultState(standardScene().client(), VAULT);
      const policy = evaluatePolicy(state, { dailyComputeUsd6: 500_000n, unpaidUsd6: 0n });
      expect(renderUserMessage({ state, policy, billUsd6: 0n, creditActions: true })).toContain('"creditActions": "on"');
    });
  });

  describe("feed age and the session", () => {
    // Fri 27 Nov 2026 00:14 ET, journal 2026-11-27.jsonl line 10: market closed, the oldest feed ~2.7 hours old, and the
    // summary called the feeds stale against a limit of 90,000 s. Ages: 2.7 h, exactly the limit, one second past it.
    const AGES = [9_720n, 90_000n, 90_001n];
    async function closedInput(): Promise<ProposerInput> {
      const f = standardScene().set(CALENDAR, "isOpen", false);
      BASKET.forEach((_, i) => f.set(FEEDS[i]!, "latestRoundData", [1n, PRICES[i]!, 0n, f.block.timestamp - AGES[i]!, 1n]));
      const state = await readVaultState(f.client(), VAULT);
      return { state, policy: evaluatePolicy(state, { dailyComputeUsd6: 500_000n, unpaidUsd6: 0n }), billUsd6: 0n, creditActions: false };
    }
    const view = (msg: string) =>
      JSON.parse(msg.slice("Current state:\n".length, msg.indexOf("\n\nDecide this round's actions."))) as {
        marketOpen: boolean | null;
        maxStalenessSec: number;
        tokens: { symbol: string; feedAgeSeconds: number | null; feedStale: boolean | null }[];
      };

    it("the user message carries the vault's maxStalenessSec and each feed's age against it, by the contract's rule", async () => {
      const v = view(renderUserMessage(await closedInput()));
      expect(MANDATE.maxStaleness).toBe(90_000);
      expect(v.marketOpen).toBe(false);
      expect(v.maxStalenessSec).toBe(90_000);
      // GuardLib: FEED_STALE when age > maxStaleness, so an age equal to the limit is still fresh.
      expect(v.tokens.map((t) => [t.symbol, t.feedAgeSeconds, t.feedStale])).toEqual([
        ["NVDAc", 9_720, false],
        ["GOOGLc", 90_000, false],
        ["AAPLc", 90_001, true],
      ]);
    });

    it("feedStale is null where no valid answer was read, as feedAgeSeconds is", async () => {
      const f = standardScene().fail(FEEDS[1]!, "latestRoundData");
      const state = await readVaultState(f.client(), VAULT);
      const v = view(renderUserMessage({ state, policy: evaluatePolicy(state, { dailyComputeUsd6: 500_000n, unpaidUsd6: 0n }), billUsd6: 0n, creditActions: false }));
      expect(v.tokens.map((t) => [t.feedAgeSeconds, t.feedStale])).toEqual([
        [30, false],
        [null, null],
        [30, false],
      ]);
    });

    it("the brief message carries the same limit and ages", async () => {
      const i = await closedInput();
      const msg = renderBriefMessage({ ...i, briefs: [] }, "0123456789abcdef");
      expect(view(msg)).toEqual(view(renderUserMessage(i)));
    });

    it("the system prompt calls a feed stale past maxStalenessSec and no sooner, and names the closed market as the reason", () => {
      for (const sys of [systemPrompt({ creditActions: false }), systemPrompt({ creditActions: true }), briefSystemPrompt({ creditActions: false })]) {
        const flat = sys.replace(/\s+/g, " ");
        for (const rule of [
          "a feed is stale when its feedAgeSeconds is above maxStalenessSec;",
          "Feed age and the session: each token's feedAgeSeconds is its feed's age in seconds, and feedStale says whether that age is past maxStalenessSec.",
          "A feed under the limit is fresh, however many hours old it is: never call it stale or give it as a reason for a refusal.",
          "When marketOpen is false the market is closed, and that is the reason the vault would refuse a trade (it checks the session before feed age): name that one reason.",
          "A feed with feedStale true may be mentioned as a fact, not as a second refusal reason.",
        ]) {
          expect(flat, rule).toContain(rule);
        }
        // GuardLib.checkMarket checks the session before feed age, so a closed market never refuses with FEED_STALE:
        // the prompt must not ask for a stale feed as a second refusal reason.
        expect(flat).not.toMatch(/add a stale feed as a second reason/i);
        // The rule that makes a feed stale is stated once, in the list of what the vault checks; the feed-age paragraph
        // names the fields that carry it and does not restate it.
        expect(flat.match(/stale when/g)).toHaveLength(1);
        expect(flat).not.toContain("the vault calls a feed stale");
      }
      // The rule sits with the other rules for the round, before the voice paragraph.
      expect(SYSTEM_PROMPT.indexOf("Feed age and the session:")).toBeGreaterThan(SYSTEM_PROMPT.indexOf("do not propose them."));
      expect(SYSTEM_PROMPT.indexOf("Feed age and the session:")).toBeLessThan(SYSTEM_PROMPT.indexOf("Voice, for the summary"));
    });

    it("a fake model receives the rule in the system prompt and the limit and ages in the user message", async () => {
      const seen: Record<string, unknown>[] = [];
      const create: CreateMessage = async (p) => {
        seen.push(p);
        return {
          model: "claude-sonnet-5-5",
          stop_reason: "end_turn",
          content: [{ type: "text", text: '{"summary":"The market is closed, so the vault would refuse a trade.","intents":[]}' }],
          usage: { input_tokens: 10_000, output_tokens: 1_000 },
        };
      };
      const i = await closedInput();
      await new ClaudeProposer({ model: "claude-sonnet-5-5", create }).propose(i);
      expect(seen).toHaveLength(1);
      const sys = (seen[0]!.system as { text: string }[])[0]!.text;
      expect(sys).toBe(SYSTEM_PROMPT);
      expect(sys).toContain("above maxStalenessSec");
      const content = (seen[0]!.messages as { content: string }[])[0]!.content;
      expect(content).toBe(renderUserMessage(i));
      expect(content).toContain('"maxStalenessSec": 90000');
      expect(content).toContain('"feedAgeSeconds": 9720');
      expect(content).toContain('"feedStale": false');
      expect(content).toContain('"feedStale": true');
    });
  });
});
