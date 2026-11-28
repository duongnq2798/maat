import { FACTS } from "./facts";
import { FILM } from "./film";

/**
 * The landing hero's words under the H1 (spec 2026-11-27, landing "explain in 10 seconds", section 1): what Maat is, in
 * one sentence, then the three steps of every trade. The brand lexicon (docs/brand/lexicon.md) holds them, as it holds
 * all of web/content.
 */
export const HERO_DEFINITION =
  "Maat is a vault on Base. Maat's agent proposes trades in tokenized US stocks; the vault checks each one against public rules and records yes or no onchain.";

/**
 * Who Maat is for, right under the definition (cold read of 2026-11-28, gap 1). "agent builders" links to the builders'
 * section, whose eyebrow is "For agent builders" and whose heading is "Ask the vault before you trade.". The rest is
 * what the vault's code holds: contracts/src/MandateVault.sol makes `fund` and `withdraw` both onlyOwner and has no
 * deposit, mint or redeem (test/top.test.tsx reads the contract), and the FAQ answers "Can I invest in Maat or deposit
 * into a vault?" with "No. Only the owner can fund a vault or withdraw from it." Advice and US persons stay in
 * SITE.disclaimer, the one place that says them.
 */
export const HERO_AUDIENCE = {
  before: "For ",
  link: "agent builders",
  href: "#agents",
  after: ", not investors: only the owner can fund the vault.",
} as const;

/** The three steps, in one row; each links to How it works. */
export const HERO_STEPS: readonly string[] = [
  "Maat's agent proposes a trade",
  `The vault checks ${FACTS.checksPerTrade.value} public rules`,
  "Yes or no is recorded on Base",
];

export interface HeroCta {
  label: string;
  href: string;
}

/** The hero's two CTAs, in order: the film band right under the hero (components/sections/Film.tsx), then the simulator. */
export const HERO_CTAS: readonly [HeroCta, HeroCta] = [
  { label: `Watch the film (${FILM.length})`, href: "#film" },
  { label: "Try to make it say no", href: "#try" },
];
