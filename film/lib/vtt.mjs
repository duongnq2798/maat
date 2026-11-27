// The film's captions as WebVTT, for the landing's <track kind="captions"> (spec 2026-11-27, landing "explain in 10
// seconds", section 2). The cut burns its captions in; the track carries the same words at the same times for screen
// readers and search, and is off by default. It is built from a render's work/manifest.json, whose shots list each
// caption the cut burned in: its id in film/captions.json, its text with the placeholders filled, and its span inside
// the shot.

const PLACEHOLDER = /\{([a-zA-Z][\w.]*)\}/g;

/** @typedef {{ id: string, start: number, end: number, text: string }} Cue One caption of the cut, timed in seconds. */
/** @typedef {{ id: string, text: string, from: number, to: number }} ShotCue A caption in a manifest's shot. */

/**
 * "00:01:23.500": a time in seconds as WebVTT writes it, to the millisecond.
 * @param {number} seconds
 */
export function vttTime(seconds) {
  const ms = Math.round(seconds * 1000);
  const pad = (/** @type {number} */ n, w = 2) => String(n).padStart(w, "0");
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
}

/**
 * Seconds from a WebVTT time, "00:01:23.500" or "01:23.500".
 * @param {string} time
 * @returns {number}
 */
export function vttSeconds(time) {
  const m = /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/.exec(time);
  if (!m) throw new Error(`not a WebVTT time: ${time}`);
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

/**
 * The cues of one cut, in order: each caption of each shot, from the shot's start plus the cue's `from` to its start
 * plus `to`. `shots` is one format's `shots` in a render's work/manifest.json; a shot's `duration` places the next one.
 * @param {readonly { duration: number, cues?: readonly ShotCue[] }[]} shots
 * @returns {Cue[]}
 */
export function vttCues(shots) {
  /** @type {Cue[]} */
  const cues = [];
  let at = 0;
  for (const shot of shots) {
    for (const cue of shot.cues ?? []) {
      cues.push({ id: cue.id, start: Math.round((at + cue.from) * 1000) / 1000, end: Math.round((at + cue.to) * 1000) / 1000, text: cue.text });
    }
    at = Math.round((at + shot.duration) * 1000) / 1000;
  }
  return cues;
}

/** Cue text with the three characters WebVTT cannot carry as they are written as entities. */
const escapeText = (/** @type {string} */ text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unescapeText = (/** @type {string} */ text) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/**
 * The WebVTT file of the cues: each cue named by its caption id, its text on one line, which the player wraps.
 * @param {readonly Cue[]} cues
 */
export function webvtt(cues) {
  const blocks = cues.map((c) => `${c.id}\n${vttTime(c.start)} --> ${vttTime(c.end)}\n${escapeText(c.text)}`);
  return `WEBVTT\n\n${blocks.join("\n\n")}\n`;
}

/**
 * The cues of a WebVTT file that webvtt() wrote.
 * @param {string} text
 * @returns {Cue[]}
 */
export function parseVtt(text) {
  const [head, ...blocks] = text.replace(/\r\n/g, "\n").trim().split(/\n{2,}/);
  if (head !== "WEBVTT") throw new Error('a WebVTT file opens with the line "WEBVTT" alone');
  return blocks.map((block) => {
    const [id = "", timing = "", ...lines] = block.split("\n");
    const m = /^(\S+) --> (\S+)$/.exec(timing);
    if (!m || lines.length === 0) throw new Error(`cue ${id}: needs an id, a timing line and text`);
    return { id, start: vttSeconds(m[1] ?? ""), end: vttSeconds(m[2] ?? ""), text: unescapeText(lines.join("\n")) };
  });
}

/**
 * The text of a caption entry of film/captions.json: a string, or { text, when, else }.
 * @param {unknown} entry
 * @returns {string | undefined}
 */
function templateOf(entry) {
  if (typeof entry === "string") return entry;
  const text = /** @type {{ text?: unknown } | undefined} */ (entry)?.text;
  return typeof text === "string" ? text : undefined;
}

/**
 * Whether `text` is `template` with each {placeholder} filled by some non-empty value, and no other change.
 * @param {string} template
 * @param {string} text
 */
export function fills(template, text) {
  const parts = template.split(PLACEHOLDER).filter((_, i) => i % 2 === 0);
  const literal = parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${literal.join(".+?")}$`, "s").test(text);
}

/**
 * What is wrong with the cues of a cut that lasts `length` seconds, one line each; [] when nothing is. A cue must name a
 * caption of film/captions.json and say its words, with only its placeholders filled; the cues must be in order, never
 * overlap, have unique ids and end within the cut.
 * @param {readonly Cue[]} cues
 * @param {Record<string, unknown>} captions
 * @param {number} length
 * @returns {string[]}
 */
export function vttProblems(cues, captions, length) {
  /** @type {string[]} */
  const problems = [];
  const seen = new Set();
  let last = 0;
  for (const cue of cues) {
    const template = templateOf(captions[cue.id]);
    if (template === undefined) problems.push(`cue ${cue.id}: no caption ${cue.id} in film/captions.json`);
    else if (!fills(template, cue.text)) problems.push(`cue ${cue.id}: "${cue.text}" is not the words of caption ${cue.id}`);
    if (seen.has(cue.id)) problems.push(`cue ${cue.id}: a second cue with this id`);
    seen.add(cue.id);
    if (!(cue.end > cue.start)) problems.push(`cue ${cue.id}: ends at ${cue.end} s, not after its start at ${cue.start} s`);
    if (cue.start < last) problems.push(`cue ${cue.id}: starts at ${cue.start} s, before the cue above it ends at ${last} s`);
    if (cue.end > length) problems.push(`cue ${cue.id}: ends at ${cue.end} s, after the cut's ${length} s`);
    last = Math.max(last, cue.end);
  }
  return problems;
}
