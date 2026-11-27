/*
 * The words Maat's agent never writes in a summary or a reply to a brief: the "Never" list of the project's voice
 * rules for its public posts, copied here as written, with its scopes, so the repository does not depend on the rules'
 * own file. bannedWords() is a review check for dry-run and eval answers, and test/voice.test.ts runs it over every
 * text the agent sends Claude. No runtime path calls it, and a hit never rejects an answer.
 */

export interface BannedWord {
  /** The word or phrase as the voice rules write it. */
  word: string;
  /** The sense the rules ban it in, when they ban it only in one. */
  scope?: string;
  /**
   * Other forms of the same claim that bannedWords() also flags, each written out in full ("earned", "reward"). The
   * word itself also matches with a trailing "s"; a form matches only as written.
   */
  forms?: readonly string[];
}

/*
 * Forms left out on purpose, because plain text needs them: "return" and "returned" (the prompt itself says "return an
 * empty list"), "user" (the prompt says "the user message"), "won" (it would flag "won't") and "earnings" (a company's
 * results, the market's own word).
 */
export const BANNED_WORDS: readonly BannedWord[] = [
  { word: "guaranteed", forms: ["guarantee", "guarantees", "guaranteeing"] },
  { word: "safe", scope: "as a verdict", forms: ["safer", "safest"] },
  { word: "risk-free" },
  { word: "audited", forms: ["audit", "audits", "auditing"] },
  { word: "profit", forms: ["profited", "profiting", "profitable", "profitably", "profitability"] },
  { word: "returns" },
  { word: "APY" },
  { word: "alpha" },
  { word: "moon", forms: ["mooning"] },
  { word: "LFG" },
  { word: "revolutionary" },
  { word: "game-changing", forms: ["game-changer", "game-changers"] },
  { word: "first-ever" },
  { word: "only", scope: "unscoped" },
  { word: "autonomous", scope: "until the agent runs live", forms: ["autonomously"] },
  { word: "AI-powered trading" },
  { word: "real-time" },
  { word: "earn", forms: ["earned", "earning"] },
  { word: "win", forms: ["winning", "winner", "winners"] },
  { word: "rewards", forms: ["reward", "rewarded", "rewarding"] },
  { word: "users", scope: "for team or red-team wallets" },
];

/**
 * The banned words bannedWords() leaves to a reader. "only" is banned only unscoped, as a claim against the field ("the
 * only agent that refuses"), and the prompt itself uses it as a limit ("Rebalance only when a weight drifts"); a word
 * match cannot tell the two apart. onlyUses() lists each one with the words around it for that reader, and
 * test/voice.test.ts pins every "only" in the text the agent sends Claude, so a new one fails there until someone has
 * read it.
 */
export const UNCHECKED_WORDS: ReadonlySet<string> = new Set(["only"]);

/** Letters, digits and "_": a banned word must not touch one on either side. */
const EDGE_BEFORE = String.raw`(?<![\p{L}\p{N}_])`;
const EDGE_AFTER = String.raw`(?![\p{L}\p{N}_])`;

/** Between the parts of a phrase: any dash (U+2011 and the en dash among them), the minus sign, white space, or none. */
const JOIN = String.raw`[\p{Pd}−\s]*`;

/**
 * One spelling's pattern: case-insensitive and whole words only, any dash, a space or nothing between its parts
 * ("risk free", "real‑time", "realtime"), and a trailing "s" when `plural` ("profits", "wins").
 */
function pattern(spelling: string, plural: boolean): string {
  const parts = spelling.split(/[-\s]+/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return `${parts.join(JOIN)}${plural ? "s?" : ""}`;
}

const CHECKED = BANNED_WORDS.filter((w) => !UNCHECKED_WORDS.has(w.word)).map((w) => {
  const spellings = [pattern(w.word, true), ...(w.forms ?? []).map((f) => pattern(f, false))];
  return { word: w.word, re: new RegExp(`${EDGE_BEFORE}(?:${spellings.join("|")})${EDGE_AFTER}`, "iu") };
});

/** The banned words `text` uses, as BANNED_WORDS writes them, each once and in that list's order; [] when it uses none. */
export function bannedWords(text: string): string[] {
  return CHECKED.filter((w) => w.re.test(text)).map((w) => w.word);
}

const ONLY = new RegExp(`${EDGE_BEFORE}only${EDGE_AFTER}`, "giu");

/**
 * Every "only" in `text`, in any case, next to any punctuation and at either end, in order: each as the run of
 * non-space characters that holds it, with the run before and the run after when there is one ("Rebalance only when",
 * "and only. Proof:", "you (only you)", "Only you"). A reader decides whether each is a limit or a claim.
 */
export function onlyUses(text: string): string[] {
  const runs = text.split(/\s+/).filter((r) => r !== "");
  return runs.flatMap((run, i) => [...run.matchAll(ONLY)].map(() => [runs[i - 1], run, runs[i + 1]].filter((r) => r !== undefined).join(" ")));
}
