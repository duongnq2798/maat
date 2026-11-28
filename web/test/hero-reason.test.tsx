import { render, within } from "@testing-library/react";
import { getAddress, hexToBigInt, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { Hero } from "@/components/sections/Hero";
import { HeroReason } from "@/components/sections/HeroReason";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { NAV_TOKENS } from "@/content/b20-nav";
import { FACTS } from "@/content/facts";
import snapshot from "@/content/generated/decisions-snapshot.json";
import { HERO_REASON_NEXT, HERO_REASON_TX, heroReason, PP_GLOSS, reasonGloss } from "@/content/hero-reason";
import { decodeExecuteInput, PROBE_TEXT_PREFIX } from "@/lib/chain/rationale";
import { basescanDecision } from "@/lib/live/basescan";

/** keccak256("Decision(bytes32,uint8,address,uint256,bool,uint8,bytes32)"). */
const DECISION_TOPIC = "0x31e6f801fe8c4e61fff662a75a05831c8f1341359c56a18463b2a33bfa2df322";

/**
 * The line naming this trade's own hash and the other buy of the round (cold read of 2026-11-28, gap 3; review of PR
 * #120), word for word.
 */
const ROUND_LINE =
  "This trade, 0xff1f…c503, was the first of two buys the vault allowed in one round; the second was BUY AAPLc · $4.64, 0xdd01…ff69 ↗";

/** The Decision log of a transaction in the committed snapshot of the vault's logs, its data split in words. */
function snapshotDecision(txHash: string = HERO_REASON_TX.txHash) {
  const log = snapshot.logs.find((l) => l.transactionHash.toLowerCase() === txHash.toLowerCase());
  if (log === undefined) throw new Error(`${txHash} is not in content/generated/decisions-snapshot.json`);
  const words = (log.data.slice(2).match(/.{64}/g) ?? []).map((w) => `0x${w}` as Hex);
  return { log, words };
}

describe("Claude's reason in the hero (content/hero-reason.ts)", () => {
  it("decodes Claude's words from the recorded calldata, written by a model, not a probe or a bill", () => {
    const r = heroReason();
    expect(r.text).toBe(
      "GOOGLc is at 0% against a 23.3% target, a drift of -23.3pp, which is beyond the 5pp band. The size is within spendable cash and the per-trade limit.",
    );
    expect(r.model).toBe("claude-sonnet-5-5");
    expect(r.text.startsWith(PROBE_TEXT_PREFIX)).toBe(false);
    const call = decodeExecuteInput(HERO_REASON_TX.input)!;
    expect(call.blob.status === "v1" && call.blob.fields.k).toBeUndefined();
    // The intent carries the blob's hash as its rationaleHash (the intent's seventh word).
    expect(call.intentRationaleHash).toBe(r.blobHash);
  });

  it("matches the Decision the vault logged for that transaction: allowed, OK, BUY GOOGLc $4.64, same rationaleHash", () => {
    const { log, words } = snapshotDecision();
    expect(log.topics[0]).toBe(DECISION_TOPIC);
    expect(Number(log.blockNumber)).toBe(HERO_REASON_TX.blockNumber);
    const googl = NAV_TOKENS.find((t) => t.symbol === HERO_REASON_TX.symbol)!;
    expect(getAddress(`0x${log.topics[2]!.slice(26)}`)).toBe(getAddress(googl.token));
    // Data words: action, amount, allowed, reason, rationaleHash.
    expect(words).toHaveLength(5);
    expect(hexToBigInt(words[0]!)).toBe(0n); // BUY
    expect(hexToBigInt(words[1]!)).toBe(HERO_REASON_TX.amount);
    expect(hexToBigInt(words[2]!)).toBe(1n); // allowed
    expect(hexToBigInt(words[3]!)).toBe(0n); // OK
    expect(words[4]).toBe(heroReason().blobHash);
  });

  it("is the first allowed Decision the snapshot holds that a model wrote the reason for", () => {
    // The one earlier allowed Decision was the owner's own, sent by hand with no blob on Tue 24 Nov.
    const allowed = snapshot.logs.filter((l) => l.topics[0] === DECISION_TOPIC && hexToBigInt(`0x${l.data.slice(2 + 128, 2 + 192)}`) === 1n);
    const before = allowed.filter((l) => Number(l.blockNumber) < HERO_REASON_TX.blockNumber);
    expect(before.map((l) => l.transactionHash.slice(0, 10))).toEqual(["0x61622340"]);
    expect(decodeExecuteInput(HERO_REASON_TX.input)!.blob.status).toBe("v1");
  });

  it("refuses calldata without a maat:v1 blob", () => {
    expect(() => heroReason(HERO_REASON_TX.input.slice(0, 2 + 228 * 2) as Hex)).toThrow(/no maat:v1 blob/);
  });

  it("names the second buy of the same round from the chain", () => {
    const { log, words } = snapshotDecision(HERO_REASON_NEXT.txHash);
    expect(log.topics[0]).toBe(DECISION_TOPIC);
    expect(Number(log.blockNumber)).toBe(HERO_REASON_NEXT.blockNumber);
    const aapl = NAV_TOKENS.find((t) => t.symbol === HERO_REASON_NEXT.symbol)!;
    expect(aapl.symbol).toBe("AAPLc");
    expect(getAddress(`0x${log.topics[2]!.slice(26)}`)).toBe(getAddress(aapl.token));
    // Data words: action, amount, allowed, reason, rationaleHash.
    expect(hexToBigInt(words[0]!)).toBe(0n); // BUY
    expect(hexToBigInt(words[1]!)).toBe(HERO_REASON_NEXT.amount);
    expect(HERO_REASON_NEXT.amount).toBe(HERO_REASON_TX.amount);
    expect(hexToBigInt(words[2]!)).toBe(1n); // allowed
    expect(hexToBigInt(words[3]!)).toBe(0n); // OK
    // Its calldata carries a reason a model wrote, not a probe's or a bill's, whose hash is the one the vault logged.
    const next = decodeExecuteInput(HERO_REASON_NEXT.input)!;
    if (next.blob.status !== "v1") throw new Error(`HERO_REASON_NEXT.input carries a ${next.blob.status} blob`);
    expect(next.blob.fields.m).toBeDefined();
    expect(next.blob.fields.k).toBeUndefined();
    expect(next.blob.fields.t.startsWith(PROBE_TEXT_PREFIX)).toBe(false);
    expect(next.blobHash).toBe(words[4]);
    // One run of the agent proposed both.
    const quoted = decodeExecuteInput(HERO_REASON_TX.input)!;
    if (quoted.blob.status !== "v1") throw new Error("HERO_REASON_TX.input carries no v1 blob");
    expect(quoted.blob.fields.r).toBe("1795792534276-47ea132c");
    expect(next.blob.fields.r).toBe(quoted.blob.fields.r);
  });

  it("makes them the only two Decisions of that round", () => {
    const decisions = snapshot.logs
      .filter((l) => l.topics[0] === DECISION_TOPIC)
      .sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber) || Number(a.logIndex) - Number(b.logIndex));
    const at = (txHash: string) => decisions.findIndex((l) => l.transactionHash.toLowerCase() === txHash.toLowerCase());
    const i = at(HERO_REASON_TX.txHash);
    expect(i).toBeGreaterThan(0);
    expect(at(HERO_REASON_NEXT.txHash)).toBe(i + 1);
    // A round is one tick of the loop: the Decisions on either side are more than one loop (15 minutes) away even at
    // 0.2 s a block, a tenth of Base's 2 s block time, so neither belongs to it.
    const loopBlocks = FACTS.loopMinutes.value * 60 * 5;
    const before = decisions[i - 1]!;
    const after = decisions[i + 2];
    expect(HERO_REASON_TX.blockNumber - Number(before.blockNumber)).toBeGreaterThan(loopBlocks);
    if (after !== undefined) expect(Number(after.blockNumber) - HERO_REASON_NEXT.blockNumber).toBeGreaterThan(loopBlocks);
  });

  it("glosses pp under a quote that writes it, and nothing under one that does not", () => {
    expect(PP_GLOSS).toBe("In the quote, pp means percentage points.");
    expect(reasonGloss(heroReason().text)).toBe(PP_GLOSS);
    expect(reasonGloss("GOOGLc is at 0% against a 23.3% target.")).toBeNull();
  });

  it("shows the trade, its verdict, the round, the quote and its three links, in a row under both hero columns from sm", () => {
    render(<Hero />);
    const grid = document.querySelector("#top [data-hero-card]")!.parentElement!.parentElement!;
    const fig = grid.lastElementChild as HTMLElement;
    expect(fig).toHaveAttribute("data-hero-reason");
    expect(fig.tagName).toBe("FIGURE");
    // Below sm it shows in How it works instead (cold read of 2026-11-28, gap 6).
    expect(fig.getAttribute("class")!.split(" ")).toEqual(expect.arrayContaining(["col-span-full", "max-sm:hidden"]));
    expect(grid.children).toHaveLength(3);
    expect(within(fig).getByText(/^Why Maat's agent made its first allowed trade · Fri 27 Nov 10:15 ET$/)).toBeInTheDocument();
    expect(fig).toHaveTextContent("BUY GOOGLc · $4.64");
    expect(fig).toHaveTextContent("Allowed · All checks passed OK");
    // The round line sits in the caption, under the verdict, and names this trade's own hash before the other's.
    expect(fig.querySelector("figcaption > [data-hero-reason-round]")!.textContent).toBe(ROUND_LINE);
    const blockquote = fig.querySelector("blockquote")!;
    expect(blockquote).toHaveTextContent(`“${heroReason().text}”`);
    const gloss = fig.querySelector("[data-hero-reason-gloss]")!;
    expect(gloss.textContent).toBe(PP_GLOSS);
    expect(blockquote.nextElementSibling).toBe(gloss);
    const links = [...fig.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([
      ["0xdd01…ff69 ↗", basescanDecision(HERO_REASON_NEXT.txHash)],
      ["0xff1f…c503 on Basescan ↗", basescanDecision(HERO_REASON_TX.txHash)],
      ["Check the hash on /ledger →", "/ledger"],
    ]);
    expect(fig.querySelector("[data-hero-reason-round] a")).toHaveAttribute("aria-label", "0xdd01…ff69 on Basescan");
  });

  it("shows below sm in How it works, between its heading and its four steps", () => {
    const { container } = render(<HowItWorks />);
    const figures = container.querySelectorAll("[data-hero-reason]");
    expect(figures).toHaveLength(1);
    const fig = figures[0]!;
    expect(fig.getAttribute("class")!.split(" ")).toEqual(expect.arrayContaining(["sm:hidden", "bg-bg"]));
    expect(fig.previousElementSibling!.querySelector("#how-title")).not.toBeNull();
    expect(fig.nextElementSibling!.tagName).toBe("OL");
    expect(fig.querySelector("blockquote")!.textContent).toBe(`“${heroReason().text}”`);
    // On a phone the round line follows the attribution, so nothing comes between the verdict and Claude's words
    // (review of PR #120).
    expect(fig.querySelector("figcaption [data-hero-reason-round]")).toBeNull();
    const round = fig.querySelector("[data-hero-reason-round]")!;
    expect(round.textContent).toBe(ROUND_LINE);
    expect(round.parentElement!.lastElementChild).toBe(round);
    expect(round.previousElementSibling!.textContent).toMatch(/Check the hash on \/ledger →$/);
    expect(fig.querySelector("figcaption")!.nextElementSibling!.firstElementChild!.tagName).toBe("BLOCKQUOTE");
    const links = [...fig.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([
      ["0xff1f…c503 on Basescan ↗", basescanDecision(HERO_REASON_TX.txHash)],
      ["Check the hash on /ledger →", "/ledger"],
      ["0xdd01…ff69 ↗", basescanDecision(HERO_REASON_NEXT.txHash)],
    ]);
  });

  it("puts the quote in as text, never markup", () => {
    const { container } = render(<HeroReason />);
    expect(container.querySelector("blockquote")!.children).toHaveLength(0);
  });
});
