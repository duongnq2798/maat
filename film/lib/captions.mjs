// Caption templates. A caption is plain text with {key} placeholders; every number in it must come from one, so a
// digit typed into the text is reported as invented. Values come from lib/sources.mjs: committed files, or what the
// capture read from the live site.

const PLACEHOLDER = /\{([a-zA-Z][\w.]*)\}/g;
/** A number as a reader sees it: an ISO date, or digits with separators, a sign, a $ or a %. */
const NUMBER = /\d{4}-\d{2}-\d{2}|[−+-]?\$?\d[\d,]*(?:\.\d+)?%?/g;

/** A caption entry is either its text, or { text, when: { equal: [a, b] }, else: otherId }. */
function textOf(entry) {
  return typeof entry === "string" ? entry : entry?.text;
}

/** The caption to show for `id` given the values: an entry with `when` falls back to its `else` caption when unmet. */
export function pickCaption(captions, id, values) {
  const entry = captions[id];
  if (entry === undefined) throw new Error(`no caption ${id} in film/captions.json`);
  const [a, b] = entry?.when?.equal ?? [];
  if (a !== undefined && (values[a] === undefined || values[a] !== values[b])) return pickCaption(captions, entry.else, values);
  return { id, text: textOf(entry) };
}

/** The caption with its placeholders filled; `missing` lists the keys it had no value for. */
export function renderCaption(text, values) {
  const missing = [];
  const out = text.replace(PLACEHOLDER, (_, key) => {
    if (values[key] === undefined) {
      missing.push(key);
      return `{${key}}`;
    }
    return String(values[key]);
  });
  return { text: out, missing };
}

/**
 * What is wrong with one caption entry, one line each: a number typed into its text, a placeholder that names no known
 * source, an unclosed brace, or a `when` without an `else`. `known` is the set of keys a source can fill.
 */
export function captionProblems(id, entry, known) {
  const text = textOf(entry);
  if (typeof text !== "string" || text.trim() === "") return [`caption ${id}: no text`];
  const problems = [];
  const literal = text.replace(PLACEHOLDER, (_, key) => {
    if (!known.has(key)) problems.push(`caption ${id}: {${key}} is not a known source`);
    return " ";
  });
  if (/[{}]/.test(literal)) problems.push(`caption ${id}: an unclosed "{"`);
  else for (const n of literal.match(NUMBER) ?? []) problems.push(`caption ${id}: "${n.replace(/%$/, "")}" is typed into the text; read it from a source with a {placeholder}`);
  if (typeof entry === "object" && entry.when) {
    const pair = entry.when.equal;
    if (!Array.isArray(pair) || pair.length !== 2 || pair.some((k) => !known.has(k))) problems.push(`caption ${id}: when.equal must name two known sources`);
    if (typeof entry.else !== "string") problems.push(`caption ${id}: a caption with when needs an else`);
  }
  return problems;
}
