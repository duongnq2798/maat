/**
 * The sanitizer of the maat:v1 spec (§2.3). Every free-text field that leaves the PC, the blob's `t` and a journal
 * `run` row's `summary`, goes through it, and the journal publisher refuses any line these four patterns still match.
 */

export const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/\S*|\bwww\.\S*|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b(?:\/\S*)?/gi;
export const HEX_RE = /\b(?:0x)?[0-9a-f]{64,}\b/gi;
export const KEY_RE = /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bAKIA[0-9A-Z]{16}\b|-----BEGIN[A-Z ]*-----/g;
export const LONG_RE = /[A-Za-z0-9+\/_-]{40,}={0,2}/g;

/** What an empty text becomes. */
export const NO_TEXT = "(no text)";
/** The shortest cut, and the end of every other one. */
export const ELLIPSIS = "...";

/** Whether `re` matches anywhere in `s`; a fresh non-global copy, so no lastIndex carries over between calls. */
export function matches(re: RegExp, s: string): boolean {
  return new RegExp(re.source, re.flags.replace("g", "")).test(s);
}

const MAPPED: ReadonlyMap<number, string> = new Map<number, string>([
  ...[0x2018, 0x2019, 0x201a, 0x2032].map((c) => [c, "'"] as const),
  ...[0x201c, 0x201d, 0x201e, 0x2033].map((c) => [c, '"'] as const),
  ...[0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212].map((c) => [c, "-"] as const),
  [0x2026, "..."],
  [0x2192, "->"],
  [0x2190, "<-"],
  [0x2248, "~"],
  [0x00d7, "x"],
]);

const isSpace = (c: number) =>
  c <= 0x1f || (c >= 0x7f && c <= 0x9f) || c === 0xa0 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000;

/** Step 1, by code point: printable ASCII kept, the listed marks mapped, the listed spaces to one space, the rest dropped. */
function toAscii(text: string): string {
  let out = "";
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x20 && c <= 0x7e) out += ch;
    else if (isSpace(c)) out += " ";
    else out += MAPPED.get(c) ?? "";
  }
  return out;
}

/**
 * Step 5: `text` itself when it has at most `max` characters, else its longest cut that does. The cuts of a text
 * are, longest first, each prefix that ends just before one of its spaces followed by " ...", and last "..." alone.
 * A cut ends on a whole word, so it cannot create a pattern match the uncut text did not have.
 */
export function cutTo(text: string, max: number): string {
  if (text.length <= max) return text;
  return cuts(text).find((c) => c.length <= max) ?? ELLIPSIS;
}

/** Every cut of `text`, longest first (see cutTo). */
export function cuts(text: string): string[] {
  const out: string[] = [];
  for (let i = text.lastIndexOf(" "); i > 0; i = text.lastIndexOf(" ", i - 1)) out.push(`${text.slice(0, i)} ${ELLIPSIS}`);
  out.push(ELLIPSIS);
  return out;
}

/** sanitize(text, max) of spec §2.3: printable ASCII, no URL, long hex, key or long token, at most `max` characters. */
export function sanitize(text: string, max: number): string {
  const s = toAscii(text)
    .replace(URL_RE, "[url]")
    .replace(HEX_RE, "[hex]")
    .replace(KEY_RE, "[key]")
    .replace(LONG_RE, "[key]")
    .replace(/ {2,}/g, " ")
    .trim();
  return cutTo(s.length === 0 ? NO_TEXT : s, max);
}
