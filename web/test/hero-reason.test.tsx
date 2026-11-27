import { render, within } from "@testing-library/react";
import { getAddress, hexToBigInt, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { Hero } from "@/components/sections/Hero";
import { HeroReason } from "@/components/sections/HeroReason";
import { NAV_TOKENS } from "@/content/b20-nav";
import snapshot from "@/content/generated/decisions-snapshot.json";
import { HERO_REASON_TX, heroReason } from "@/content/hero-reason";
import { decodeExecuteInput, PROBE_TEXT_PREFIX } from "@/lib/chain/rationale";
import { basescanDecision } from "@/lib/live/basescan";

/** keccak256("Decision(bytes32,uint8,address,uint256,bool,uint8,bytes32)"). */
const DECISION_TOPIC = "0x31e6f801fe8c4e61fff662a75a05831c8f1341359c56a18463b2a33bfa2df322";

/** The Decision log of the quoted transaction in the committed snapshot of the vault's logs, its data split in words. */
function snapshotDecision() {
  const log = snapshot.logs.find((l) => l.transactionHash.toLowerCase() === HERO_REASON_TX.txHash.toLowerCase());
  if (log === undefined) throw new Error(`${HERO_REASON_TX.txHash} is not in content/generated/decisions-snapshot.json`);
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

  it("shows the trade, its verdict, the quote and both links, in a row under both hero columns", () => {
    render(<Hero />);
    const grid = document.querySelector("#top [data-hero-card]")!.parentElement!.parentElement!;
    const fig = grid.lastElementChild as HTMLElement;
    expect(fig).toHaveAttribute("data-hero-reason");
    expect(fig.tagName).toBe("FIGURE");
    expect(fig.getAttribute("class")!.split(" ")).toContain("col-span-full");
    expect(grid.children).toHaveLength(3);
    expect(within(fig).getByText(/^Why Maat's agent made its first allowed trade · Fri 27 Nov 10:15 ET$/)).toBeInTheDocument();
    expect(fig).toHaveTextContent("BUY GOOGLc · $4.64");
    expect(fig).toHaveTextContent("Allowed · All checks passed OK");
    expect(fig.querySelector("blockquote")).toHaveTextContent(`“${heroReason().text}”`);
    const links = [...fig.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([
      ["0xff1f…c503 on Basescan ↗", basescanDecision(HERO_REASON_TX.txHash)],
      ["Check the hash on /ledger →", "/ledger"],
    ]);
  });

  it("puts the quote in as text, never markup", () => {
    const { container } = render(<HeroReason />);
    expect(container.querySelector("blockquote")!.children).toHaveLength(0);
  });
});
