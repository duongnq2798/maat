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
}

export const BANNED_WORDS: readonly BannedWord[] = [
  { word: "guaranteed" },
  { word: "safe", scope: "as a verdict" },
  { word: "risk-free" },
  { word: "audited" },
  { word: "profit" },
  { word: "returns" },
  { word: "APY" },
  { word: "alpha" },
  { word: "moon" },
  { word: "LFG" },
  { word: "revolutionary" },
  { word: "game-changing" },
  { word: "first-ever" },
  { word: "only", scope: "unscoped" },
  { word: "autonomous", scope: "until the agent runs live" },
  { word: "AI-powered trading" },
  { word: "real-time" },
  { word: "earn" },
  { word: "win" },
  { word: "rewards" },
  { word: "users", scope: "for team or red-team wallets" },
];

/**
 * The banned words bannedWords() leaves to a reader. "only" is banned only unscoped, as a claim against the field ("the
 * only agent that refuses"), and the prompt itself uses it as a limit ("Rebalance only when a weight drifts"); a word
 * match cannot tell the two apart. test/voice.test.ts lists every "only" in the prompt instead, so a new one fails
 * there until someone has read it.
 */
export const UNCHECKED_WORDS: ReadonlySet<string> = new Set(["only"]);

/** Letters, digits and "_": a banned word must not touch one on either side. */
const EDGE_BEFORE = String.raw`(?<![\p{L}\p{N}_])`;
const EDGE_AFTER = String.raw`(?![\p{L}\p{N}_])`;

/**
 * One word's pattern: case-insensitive, whole words only, a trailing "s" allowed ("profits", "wins"), and a hyphen or
 * a space between words matching either ("risk free", "AI powered trading").
 */
function pattern(word: string): RegExp {
  const parts = word.split(/[-\s]+/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`${EDGE_BEFORE}${parts.join(String.raw`[-\s]+`)}s?${EDGE_AFTER}`, "iu");
}

const CHECKED = BANNED_WORDS.filter((w) => !UNCHECKED_WORDS.has(w.word)).map((w) => ({ word: w.word, re: pattern(w.word) }));

/** The banned words `text` uses, as BANNED_WORDS writes them, each once and in that list's order; [] when it uses none. */
export function bannedWords(text: string): string[] {
  return CHECKED.filter((w) => w.re.test(text)).map((w) => w.word);
}
