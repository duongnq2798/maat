// The film's two text tracks as WebVTT, for the landing's player (spec 2026-11-27, landing "explain in 10 seconds",
// section 2). Both are off by default.
//
// - The captions track (<track kind="captions">) captions the sound: the voice-over of film/narration.json, each cue at
//   its shot's start plus its own time, set at the top of the picture (line:0) so it never covers the captions burned
//   in at the bottom.
// - The on-screen text track (<track kind="descriptions">) carries the captions the cut burns in, at the same times, for
//   screen readers and search. It is built from a render's work/manifest.json, whose shots list each caption the cut
//   burned in: its id in film/captions.json, its text with the placeholders filled, and its span inside the shot. The
//   title and end cards have no caption, so it carries their words too, while each card is on screen (CARD_CUES).

import { CARD_READING } from "./cards.mjs";

/** The words of the title and end cards, by the id of their cue in the on-screen text track (lib/cards.mjs). */
export const CARD_CUES = Object.freeze({ "card-title": CARD_READING.title.join(" "), "card-end": CARD_READING.end.join(" ") });

const PLACEHOLDER = /\{([a-zA-Z][\w.]*)\}/g;

/**
 * @typedef {{ id: string, start: number, end: number, text: string, settings?: string }} Cue One cue of the cut, timed
 *   in seconds; `settings` are its WebVTT cue settings, such as "line:0".
 */
/** @typedef {{ id: string, text: string, from: number, to: number }} ShotCue A caption in a manifest's shot. */
/** @typedef {{ beat: string, slot: string, duration: number }} Shot A shot of a cut, in order: a manifest's or lib/beats.mjs timeline()'s. */
/** @typedef {{ shot: string, cues: readonly { from: number, to: number, text: string }[] }} NarrationLine A line of film/narration.json. */

/** Where the captions of the sound sit: the top line of the picture, clear of the captions burned in at the bottom. */
export const NARRATION_SETTINGS = "line:0";

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
 * plus `to`, and the words of the title and end cards for as long as each is on screen (CARD_CUES). `shots` is one
 * format's `shots` in a render's work/manifest.json; a shot's `duration` places the next one.
 * @param {readonly { duration: number, kind?: string, slot?: string, cues?: readonly ShotCue[] }[]} shots
 * @returns {Cue[]}
 */
export function vttCues(shots) {
  /** @type {Cue[]} */
  const cues = [];
  let at = 0;
  for (const shot of shots) {
    const card = `card-${shot.slot}`;
    if (shot.kind === "card" && card in CARD_CUES) {
      cues.push({ id: card, start: at, end: Math.round((at + shot.duration) * 1000) / 1000, text: CARD_CUES[/** @type {keyof typeof CARD_CUES} */ (card)] });
    }
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
 * The WebVTT file of the cues: each cue named by its id, its settings after its timing, its text on one line, which
 * the player wraps.
 * @param {readonly Cue[]} cues
 */
export function webvtt(cues) {
  const blocks = cues.map((c) => `${c.id}\n${vttTime(c.start)} --> ${vttTime(c.end)}${c.settings ? ` ${c.settings}` : ""}\n${escapeText(c.text)}`);
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
    const m = /^(\S+) --> (\S+)(?: (\S.*))?$/.exec(timing);
    if (!m || lines.length === 0) throw new Error(`cue ${id}: needs an id, a timing line and text`);
    const cue = { id, start: vttSeconds(m[1] ?? ""), end: vttSeconds(m[2] ?? ""), text: unescapeText(lines.join("\n")) };
    return m[3] ? { ...cue, settings: m[3] } : cue;
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
 * caption of film/captions.json and say its words, with only its placeholders filled, or name a card of CARD_CUES and
 * say its words; the cues must be in order, never overlap, have unique ids and end within the cut.
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
    const template = Object.hasOwn(CARD_CUES, cue.id) ? CARD_CUES[/** @type {keyof typeof CARD_CUES} */ (cue.id)] : templateOf(captions[cue.id]);
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

/**
 * The captions of the sound, in order: each cue of each line of film/narration.json at its shot's start plus its own
 * `from` and `to`, named voice-NN-M (line NN, cue M), at the top of the picture. `shots` is one cut's shots in order,
 * from a render's work/manifest.json or lib/beats.mjs timeline(); a line names its shot as "beat/slot".
 * @param {readonly Shot[]} shots
 * @param {readonly NarrationLine[]} lines
 * @returns {Cue[]}
 */
export function narrationCues(shots, lines) {
  /** @type {Map<string, number>} */
  const starts = new Map();
  let at = 0;
  for (const shot of shots) {
    starts.set(`${shot.beat}/${shot.slot}`, at);
    at = Math.round((at + shot.duration) * 1000) / 1000;
  }
  return lines.flatMap((line, l) => {
    const start = starts.get(line.shot);
    if (start === undefined) throw new Error(`narration line ${l + 1}: the cut has no shot ${line.shot}`);
    return line.cues.map((cue, c) => ({
      id: `voice-${String(l + 1).padStart(2, "0")}-${c + 1}`,
      start: Math.round((start + cue.from) * 1000) / 1000,
      end: Math.round((start + cue.to) * 1000) / 1000,
      text: cue.text,
      settings: NARRATION_SETTINGS,
    }));
  });
}

/**
 * What is wrong with film/narration.json against a cut's shots, one line each; [] when nothing is. Every line names a
 * shot of the cut, once, in the cut's order; every cue has words, starts at or after its shot's start, ends after it
 * starts and no later than its shot's end, and starts no earlier than the cue before it ends.
 * @param {readonly NarrationLine[]} lines
 * @param {readonly Shot[]} shots
 * @returns {string[]}
 */
export function narrationProblems(lines, shots) {
  /** @type {string[]} */
  const problems = [];
  const order = shots.map((s) => `${s.beat}/${s.slot}`);
  let lastShot = -1;
  const seen = new Set();
  lines.forEach((line, l) => {
    const where = `narration line ${l + 1} (${line.shot})`;
    const index = order.indexOf(line.shot);
    if (index === -1) {
      problems.push(`${where}: the cut has no such shot`);
      return;
    }
    if (seen.has(line.shot)) problems.push(`${where}: a second line over this shot`);
    else if (index < lastShot) problems.push(`${where}: comes before the line above it in the cut`);
    seen.add(line.shot);
    lastShot = Math.max(lastShot, index);
    const duration = shots[index]?.duration ?? 0;
    let last = 0;
    line.cues.forEach((cue, c) => {
      const at = `${where}, cue ${c + 1}`;
      if (cue.text.trim() === "") problems.push(`${at}: has no words`);
      if (!(cue.from >= 0)) problems.push(`${at}: starts at ${cue.from} s, before its shot`);
      if (!(cue.to > cue.from)) problems.push(`${at}: ends at ${cue.to} s, not after its start at ${cue.from} s`);
      if (cue.to > duration) problems.push(`${at}: ends at ${cue.to} s, after its shot's ${duration} s`);
      if (c > 0 && cue.from < last) problems.push(`${at}: starts at ${cue.from} s, before the cue above it ends at ${last} s`);
      last = Math.max(last, cue.to);
    });
  });
  return problems;
}
