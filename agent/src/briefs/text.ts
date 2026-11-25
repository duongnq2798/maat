/**
 * The code points a MaatInbox brief may not carry into Claude's prompt (docs/superpowers/specs/2026-11-25-maat-inbox-design.md
 * §3): every code point of Unicode general category Cc (controls) or Cf (format), or with the Default_Ignorable_Code_Point
 * property. That takes in C0 and C1 controls (DEL and line breaks included), zero-width characters, direction marks,
 * overrides and isolates, the word joiner, U+FEFF, the soft hyphen, variation selectors, Hangul fillers and the tag
 * characters U+E0000 to U+E007F. The /ask feed replaces the same set (web/lib/chain/inbox.ts plainBriefText).
 */
const UNSAFE = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;

/** What each such code point becomes, so a reader sees a mark where the brief held something invisible. */
export const REPLACEMENT = "\u{FFFD}";

/**
 * A brief's text as the prompt quotes it: the leniently decoded string with every UNSAFE code point replaced by
 * U+FFFD. With no line break or control left, its JSON string stays on one line, and nothing in it is invisible or
 * reorders the text around it.
 */
export function promptText(text: string): string {
  return text.replace(UNSAFE, REPLACEMENT);
}
