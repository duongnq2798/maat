// The film's beat plan: eight beats in the order of the win plan's Move 8, each a list of shots with a fixed length.
// Pure data and arithmetic, no I/O, so the web unit tests check it in CI without ffmpeg or a network.

/** Frames per second of every segment and of the final cut. */
export const FPS = 30;
/** The cut the plan asks for, in seconds; timeline() must land within TOLERANCE_SECONDS of it. */
export const TARGET_SECONDS = 100;
export const TOLERANCE_SECONDS = 2;

/** The layouts a tx shot may ask for besides the default one card per tx. */
export const LAYOUTS = Object.freeze(["persuasion"]);

/** What a page shot's probe step can read from the live page: whether /ask takes briefs (lib/sources.mjs askOpenValue). */
export const PROBES = Object.freeze(["ask.open"]);

/** The two Basescan clips the owner records by hand, by the base name they drop into film/input/. */
export const CLIPS = Object.freeze({ decisionLog: "basescan-decision-log", inputUtf8: "basescan-input-utf8" });

/**
 * Where a page shot puts the element it scrolls to, in CSS px from the top of the viewport, per format. The 16:9 cut
 * shows the site's desktop layout, whose nav bar stays at the top (82 px), so the offset also clears the section label
 * or tabs above a heading; the phone layout has no sticky bar. The capture then moves each stop by a few px so that no
 * line of text is cut by the top edge of the frame or by the nav bar (unsliceGoal).
 */
const TOP = { wide: 160, tall: 88 };

/** The mandate panel's card that lists the rule changes waiting out the timelock. */
const TIMELOCK_PANEL = 'section[aria-label="Mandate"] .card:has(h3:has-text("Rule changes waiting out the timelock"))';

/** /proof once its counts are read: "Counted to block …", then the counts. */
const PROOF_READ = '[data-proof-state="read"]';
/** /proof's six count lines (Outside briefs, Outside wallets, …), which its caption must not cover. */
const PROOF_COUNTS = `${PROOF_READ} dl`;

/** The formats a step's value may name, one entry each. */
const FORMAT_KEYS = Object.freeze(["wide", "tall"]);

/** Whether a step's value is given per format: an object whose keys are all formats. */
function perFormat(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((k) => FORMAT_KEYS.includes(k));
}

/**
 * A step's value for one format: the value itself, or its `wide` or `tall` entry when it is given per format. A value
 * given for one format only is undefined in the other, so a scroll that names only `tall` does not run in 16:9.
 */
export function forFormat(value, format) {
  return perFormat(value) ? value[format] : value;
}

/**
 * How many frames a scroll of `over` seconds films: none for `over: 0`, which jumps there before the shot's first frame
 * (the 9:16 gap shot opens on the NVDAc panel this way, not on the window's heading); at least one otherwise.
 */
export function scrollFrames(over) {
  return over > 0 ? Math.max(1, Math.round(over * FPS)) : 0;
}

/**
 * A shot is one of:
 * - page: the live site at `path`, driven by `steps` (wait, scroll, hold, click, capture, probe); its last frame is held
 *   to the end of `duration`. A scroll's target and `top` may differ per format ({ wide, tall }). `continue: true` goes
 *   on from where the page shot before it left the same path, instead of loading the page again from its top.
 *   `keepClear` names an element the caption must not cover: the capture warns when it does at a scroll's stop;
 * - card: a still the capture renders from repository files (`card` names it), held for `duration`;
 * - tx: one card per key of film/txs.json in `txs`; `caption` when every hash is set, `placeholderCaption` when none
 *   is, and `partialCaption` (needed for two or more txs) when only some are. `layout: "persuasion"` (a brief and the
 *   vault's Decision) lays the pair out as brief, Maat's agent's reply from the published journal, then the verdict,
 *   once both hashes are set; until then it is the same placeholder card as any tx shot;
 * - clip: an owner clip from film/input/, used when present; otherwise `fallback`, a shot of the same `duration`.
 * `captions` are cues: each caption id from film/captions.json shows from `at` seconds until the next cue or the end.
 * @typedef {{ id: string, kind: string, duration: number, [field: string]: any }} Shot
 * @typedef {{ id: string, title: string, shots: readonly Shot[] }} Beat
 */
/** @type {readonly Beat[]} */
export const BEATS = Object.freeze([
  {
    id: "frozen-feed",
    title: "The frozen feed",
    shots: [
      // The title card holds 145 characters to read: 6 s at READ_PACE (cardReading in lib/cards.mjs).
      { id: "title", kind: "card", card: "title", duration: 6, captions: [] },
      {
        id: "gap",
        kind: "page",
        path: "/gap-index",
        duration: 9,
        // In 9:16 the window's heading at the top would leave the chart's drop under the caption, so that cut goes to
        // the NVDAc panel instead; the caption names the window. It jumps there before its first frame, so the first
        // caption opens over the panel, not over the page's "Three weekends" heading.
        keepClear: "#gap-panel-2026-11-06-NVDAc svg",
        steps: [
          { wait: "#gap-panel-2026-11-06-NVDAc" },
          { scroll: { tall: "#gap-panel-2026-11-06-NVDAc" }, over: 0, top: TOP },
          { hold: 1 },
          { scroll: { wide: "#window-2026-11-06", tall: "#gap-panel-2026-11-06-NVDAc" }, over: 2, top: TOP },
          { hold: 2.5 },
          { scroll: "#gap-panel-2026-11-06-NVDAc svg", over: 1.5, top: { wide: 260, tall: 220 } },
        ],
        captions: [
          { id: "gap-held", at: 0 },
          { id: "gap-swaps", at: 4.5 },
        ],
      },
    ],
  },
  {
    id: "proposes-decides",
    title: "Claude proposes. The vault decides.",
    shots: [
      {
        id: "how",
        kind: "page",
        path: "/",
        duration: 4.5,
        steps: [{ wait: "#how" }, { scroll: "#how-title", over: 1.5, top: TOP }],
        captions: [{ id: "decides-how", at: 0 }],
      },
      {
        id: "decision-log",
        kind: "clip",
        clip: CLIPS.decisionLog,
        duration: 5,
        captions: [{ id: "decides-clip", at: 0 }],
        fallback: {
          id: "reasons",
          kind: "page",
          path: "/",
          continue: true,
          duration: 5,
          steps: [{ wait: "#reasons" }, { scroll: "#reasons-title", over: 1.5, top: TOP }],
          captions: [{ id: "decides-log", at: 0 }],
        },
      },
    ],
  },
  {
    id: "mandate",
    title: "The basket and the approved mandate",
    shots: [
      {
        id: "mandate",
        kind: "page",
        path: "/ledger",
        duration: 10.5,
        steps: [
          // The panel shows the configured defaults until it has read the vault; the captions take only the onchain mandate.
          { wait: 'section[aria-label="Mandate"] caption:has-text("The mandate onchain")' },
          { wait: '[aria-label="Mainnet decisions"]' },
          { capture: "ledger.perTrade" },
          { capture: "ledger.perDay" },
          { capture: "ledger.weightCapPct" },
          { scroll: 'section[aria-label="Mandate"]', over: 2, top: TOP },
          { hold: 3 },
          // 16:9 holds the weight cap row and the timelock panel side by side; 9:16 stacks them and ends on the panel
          // the timelock line points at (the capture warns when the reserve line shows over it instead).
          {
            scroll: { wide: 'section[aria-label="Mandate"] tr:has-text("maxWeightBps")', tall: TIMELOCK_PANEL },
            over: 1.5,
            top: { wide: 420, tall: 300 },
          },
        ],
        // mandate-reserve shows only once the vault's cap equals the reserve script's; until then, mandate-timelock.
        captions: [
          { id: "mandate-basket", at: 0 },
          { id: "mandate-caps", at: 3.5 },
          { id: "mandate-reserve", at: 7 },
        ],
      },
    ],
  },
  {
    id: "sourced-proposal",
    title: "The sourced proposal and its hash tick",
    shots: [
      {
        id: "trail",
        kind: "page",
        path: "/ledger",
        continue: true,
        // The one shot with Claude's own words, the model, the sources and the hash tick, so it holds longer.
        duration: 7.5,
        steps: [
          { wait: '[aria-label="Mainnet decisions"]' },
          { scroll: "#trail-panel-decisions", over: 2, top: TOP },
        ],
        captions: [{ id: "proposal-tick", at: 0 }],
      },
      {
        id: "input-utf8",
        kind: "clip",
        clip: CLIPS.inputUtf8,
        duration: 5,
        captions: [{ id: "proposal-clip", at: 0 }],
        fallback: {
          id: "verify",
          kind: "page",
          path: "/ledger",
          continue: true,
          duration: 5,
          steps: [{ wait: "#verify" }, { scroll: "#verify-title", over: 1.5, top: TOP }],
          captions: [{ id: "proposal-verify", at: 0 }],
        },
      },
    ],
  },
  {
    id: "thanksgiving",
    title: "Thanksgiving: MARKET_CLOSED from Maat's agent",
    shots: [
      {
        id: "sim",
        kind: "page",
        path: "/",
        duration: 3.5,
        steps: [
          { wait: "#try" },
          { click: { within: '[aria-label="Moment presets"]', button: "Thanksgiving" }, settle: 2.5 },
          { scroll: '[aria-label="Simulated checks"]', over: 1.5, top: { wide: 160, tall: 40 } },
        ],
        captions: [{ id: "thanksgiving-sim", at: 0 }],
      },
      { id: "tx", kind: "tx", txs: ["thanksgiving"], duration: 5, caption: "thanksgiving-tx", placeholderCaption: "thanksgiving-placeholder" },
    ],
  },
  {
    id: "early-close",
    title: "The early-close probes",
    shots: [
      {
        id: "sim",
        kind: "page",
        path: "/",
        continue: true,
        duration: 3.5,
        steps: [
          { wait: "#try" },
          { click: { within: '[aria-label="Moment presets"]', button: "Fri 27 Nov · 13:30" }, settle: 2.5 },
          { scroll: '[aria-label="Simulated checks"]', over: 1.5, top: { wide: 160, tall: 40 } },
        ],
        captions: [{ id: "early-sim", at: 0 }],
      },
      {
        id: "tx",
        kind: "tx",
        txs: ["earlyCloseAllowed", "earlyCloseRefused"],
        duration: 7,
        caption: "early-tx",
        placeholderCaption: "early-placeholder",
        partialCaption: "pair-partial",
      },
    ],
  },
  {
    id: "stranger-brief",
    title: "A stranger's brief and the vault's answer",
    shots: [
      {
        id: "ask",
        kind: "page",
        path: "/ask",
        duration: 5,
        // The invitation shows only while the live page takes briefs (the probe ask.open, lib/sources.mjs
        // askOpenValue). The shot ends with the form, or the notice that the inbox is not open yet, above the caption:
        // in 9:16 the page stays near its top, so the caption sits over the next section's heading, not a form's fields.
        keepClear: 'section[aria-labelledby="send-title"] > :last-child',
        steps: [{ wait: "#send-title" }, { probe: "ask.open" }, { hold: 1 }, { scroll: "#send-title", over: 1.5, top: { wide: TOP.wide, tall: 400 } }],
        captions: [{ id: "brief-ask", at: 0 }],
      },
      {
        id: "tx",
        kind: "tx",
        // Once both are on Base: the brief, Maat's agent's reply from the published journal, then the vault's verdict.
        // No card has more to read, so How it works, the two simulator shots and both clip slots are kept short for
        // it: the cut lasts 100 s, and no caption reads faster than READ_PACE (lib/cards.mjs).
        layout: "persuasion",
        txs: ["strangerBrief", "vaultAnswer"],
        duration: 11.5,
        caption: "brief-tx",
        placeholderCaption: "brief-placeholder",
        partialCaption: "pair-partial",
      },
    ],
  },
  {
    id: "receipts",
    title: "Receipts",
    shots: [
      { id: "contracts", kind: "card", card: "deployments", duration: 4, captions: [{ id: "receipts-contracts", at: 0 }] },
      // The card shows the figures under a dated heading; its caption says only what the card does not.
      { id: "ci", kind: "card", card: "ci", duration: 3, captions: [{ id: "receipts-ci", at: 0 }] },
      {
        id: "proof",
        kind: "page",
        path: "/proof",
        duration: 3.5,
        // The counts are filmed only once read ("Counted to block …"), never while the page says "Reading briefs…".
        // 16:9 shows the section's heading, its notes and the counts; 9:16 has no room for all of them above the
        // caption, so it opens on "Counted to block …" (the blank above it starts no sentence midway) and the six counts.
        keepClear: PROOF_COUNTS,
        steps: [
          { wait: "#counts-title" },
          { wait: PROOF_READ },
          { scroll: { wide: "#counts-title", tall: PROOF_READ }, over: 1.5, top: { wide: TOP.wide, tall: 24 } },
        ],
        captions: [{ id: "receipts-proof", at: 0 }],
      },
      // The end card holds the sign-off, the myth line and the builder line (161 characters): 6.5 s at READ_PACE.
      { id: "end", kind: "card", card: "end", duration: 6.5, captions: [] },
    ],
  },
]);

/** How many of a tx shot's cards show a real tx: "all", "some" or "none". `models` are lib/tx.mjs card models. */
export function txState(models) {
  const real = models.filter((m) => m.kind === "tx").length;
  return real === models.length ? "all" : real === 0 ? "none" : "some";
}

/** The caption cues a shot shows; for a tx shot, given its txState. */
export function shotCues(shot, state = "none") {
  if (shot.kind !== "tx") return shot.captions ?? [];
  const id = state === "all" ? shot.caption : state === "some" && shot.partialCaption ? shot.partialCaption : shot.placeholderCaption;
  return [{ id, at: 0 }];
}

/** The shot the film actually uses: a clip shot becomes its fallback when its clip is not in `clipsPresent`. */
export function effectiveShot(shot, clipsPresent) {
  if (shot.kind !== "clip") return shot;
  return clipsPresent.has(shot.clip) ? shot : shot.fallback;
}

/**
 * Where a page shot's scroll stops, in CSS px from the top of the page: the target element `offset` px below the top of
 * the frame, inside the page (`max` is the page's height less the viewport's), and never so far that the site's footer
 * enters the frame, where its display line would sit behind the caption. `target` and `footer` are the element's and
 * the footer's tops in the page (footer null when it has none), `height` the viewport's height.
 * @param {{ target: number, offset: number, max: number, footer: number | null, height: number }} at
 */
export function scrollGoal({ target, offset, max, footer, height }) {
  const y = Math.min(max, target - offset, footer === null ? Number.POSITIVE_INFINITY : footer - height);
  return Math.max(0, Math.round(y));
}

/**
 * A scroll stop moved so that no line of text is cut in two by the top edge of the frame, or by the bottom of the
 * site's sticky nav bar, `edge` px tall: the nearest stop within `reach` px of `y`, between 0 and `limit`, at which no
 * line (its top and bottom in page px) crosses y + edge; `y` itself when there is none. On a tie it scrolls up, which
 * shows the line rather than hides it.
 * @param {{ y: number, lines: readonly { top: number, bottom: number }[], edge?: number, limit: number, reach?: number }} at
 */
export function unsliceGoal({ y, lines, edge = 0, limit, reach = 120 }) {
  const cuts = (/** @type {number} */ at) => lines.some((l) => l.top < at + edge - 0.5 && l.bottom > at + edge + 0.5);
  if (!cuts(y)) return y;
  for (let d = 1; d <= reach; d++) {
    for (const c of [y - d, y + d]) if (c >= 0 && c <= limit && !cuts(c)) return c;
  }
  return y;
}

/**
 * Why a caption would cover an element a page shot keeps clear, in one line; null when it does not. `element` is its
 * top and bottom in the frame, `captionTop` the top of the band the caption may take, `height` the frame's height.
 * @param {string} where @param {{ top: number, bottom: number }} element @param {number} captionTop @param {number} height
 */
export function keepClearProblem(where, element, captionTop, height) {
  if (element.bottom <= captionTop || element.top >= height) return null;
  return `${where}: the caption band starts at ${Math.round(captionTop)} px and would cover the element it keeps clear, which ends at ${Math.round(element.bottom)} px`;
}

/** Seconds of a page shot that its steps animate or hold; the rest holds the last frame. */
export function scriptedSeconds(shot) {
  return (shot.steps ?? []).reduce((s, step) => s + (step.over ?? 0) + (step.hold ?? 0), 0);
}

const onGrid = (seconds) => Math.abs(seconds * FPS - Math.round(seconds * FPS)) < 1e-9;

/**
 * Every shot the film uses, in order, with its beat, start and length. `clipsPresent` is the set of owner clips in the
 * input folder; a missing clip's fallback has the same length, so the total does not depend on it.
 */
export function timeline(beats = BEATS, clipsPresent = new Set()) {
  const shots = [];
  let start = 0;
  beats.forEach((beat, b) => {
    for (const planned of beat.shots) {
      const shot = effectiveShot(planned, clipsPresent);
      shots.push({ beat: beat.id, beatIndex: b + 1, beatTitle: beat.title, slot: planned.id, shot, start, duration: shot.duration });
      start = Math.round((start + shot.duration) * FPS) / FPS;
    }
  });
  return { shots, total: start };
}

/** What is wrong with a beat plan, one line each; [] when nothing is. */
export function validateBeats(beats = BEATS) {
  const problems = [];
  const ids = new Set();
  const checkShot = (beat, shot, where) => {
    if (!(shot.duration > 0) || !onGrid(shot.duration)) problems.push(`${where}: duration ${shot.duration} is not a positive whole number of frames at ${FPS} fps`);
    if (shot.kind === "page") {
      if (typeof shot.path !== "string" || !shot.path.startsWith("/")) problems.push(`${where}: a page shot needs a site path`);
      if (scriptedSeconds(shot) > shot.duration) problems.push(`${where}: its steps take ${scriptedSeconds(shot)} s, longer than the shot's ${shot.duration} s`);
      let filmed = false;
      for (const step of shot.steps ?? []) {
        if (step.probe !== undefined && !PROBES.includes(step.probe)) problems.push(`${where}: unknown probe ${step.probe}`);
        if (step.scroll !== undefined) {
          if (!(typeof step.over === "number" && step.over >= 0)) problems.push(`${where}: a scroll needs over, in seconds, 0 or more`);
          // A jump mid-shot would be a cut inside the shot: over: 0 only before its first frame.
          else if (step.over === 0 && filmed) problems.push(`${where}: a scroll with over: 0 jumps, so it must come before the shot's first frame`);
        }
        if (step.hold > 0 || step.over > 0) filmed = true;
      }
    } else if (shot.continue !== undefined || shot.keepClear !== undefined) problems.push(`${where}: only a page shot can continue or keep an element clear`);
    if (shot.kind === "tx" && (!Array.isArray(shot.txs) || shot.txs.length === 0 || !shot.caption || !shot.placeholderCaption)) {
      problems.push(`${where}: a tx shot needs txs, a caption and a placeholder caption`);
    }
    if (shot.kind === "tx" && shot.txs?.length > 1 && !shot.partialCaption) problems.push(`${where}: a tx shot of two or more txs needs a partial caption`);
    if (shot.layout !== undefined) {
      if (shot.kind !== "tx" || !LAYOUTS.includes(shot.layout)) problems.push(`${where}: unknown layout ${shot.layout}`);
      else if (shot.layout === "persuasion" && shot.txs?.length !== 2) problems.push(`${where}: the persuasion layout needs two txs, a brief and the vault's Decision`);
    }
    if (shot.kind === "clip") {
      if (!Object.values(CLIPS).includes(shot.clip)) problems.push(`${where}: unknown clip ${shot.clip}`);
      if (!shot.fallback) problems.push(`${where}: a clip shot needs a fallback for when the clip is missing`);
      else {
        if (shot.fallback.kind === "clip") problems.push(`${where}: a fallback cannot be another clip`);
        if (shot.fallback.duration !== shot.duration) problems.push(`${where}: its fallback lasts ${shot.fallback.duration} s, not ${shot.duration} s`);
        checkShot(beat, shot.fallback, `${where} fallback`);
      }
    }
    const cues = shot.kind === "tx" ? [] : shot.captions ?? [];
    cues.forEach((cue, i) => {
      if (!(cue.at >= 0 && cue.at < shot.duration)) problems.push(`${where}: cue ${cue.id} at ${cue.at} s is outside the shot`);
      if (i === 0 && cue.at !== 0) problems.push(`${where}: its first cue must start at 0`);
      if (i > 0 && !(cue.at > (cues[i - 1]?.at ?? 0))) problems.push(`${where}: cue ${cue.id} does not come after the one before`);
    });
  };
  for (const beat of beats) {
    if (ids.has(beat.id)) problems.push(`beat ${beat.id}: id used twice`);
    ids.add(beat.id);
    const shotIds = new Set();
    for (const shot of beat.shots) {
      if (shotIds.has(shot.id)) problems.push(`${beat.id}/${shot.id}: id used twice`);
      shotIds.add(shot.id);
      checkShot(beat, shot, `${beat.id}/${shot.id}`);
    }
  }
  for (const clips of [new Set(), new Set(Object.values(CLIPS))]) {
    const { total } = timeline(beats, clips);
    if (Math.abs(total - TARGET_SECONDS) > TOLERANCE_SECONDS) problems.push(`the cut lasts ${total} s, not ${TARGET_SECONDS} ± ${TOLERANCE_SECONDS} s`);
  }
  return problems;
}

/** Every caption id the plan can show: each cue of each shot, each fallback, and both captions of each tx shot. */
export function captionIds(beats = BEATS) {
  const ids = [];
  const add = (shot) => {
    if (shot.kind === "tx") ids.push(shot.caption, shot.placeholderCaption, ...(shot.partialCaption ? [shot.partialCaption] : []));
    else for (const cue of shot.captions ?? []) ids.push(cue.id);
    if (shot.fallback) add(shot.fallback);
  };
  for (const beat of beats) for (const shot of beat.shots) add(shot);
  return ids;
}

/** Every key of film/txs.json the plan reads, with the beat that shows it. */
export function txKeys(beats = BEATS) {
  return beats.flatMap((beat) => beat.shots.flatMap((shot) => (shot.kind === "tx" ? shot.txs.map((key) => ({ key, beat: beat.id })) : [])));
}
