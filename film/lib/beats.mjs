// The film's beat plan: eight beats in the order of the win plan's Move 8, each a list of shots with a fixed length.
// Pure data and arithmetic, no I/O, so the web unit tests check it in CI without ffmpeg or a network.

/** Frames per second of every segment and of the final cut. */
export const FPS = 30;
/** The cut the plan asks for, in seconds; timeline() must land within TOLERANCE_SECONDS of it. */
export const TARGET_SECONDS = 100;
export const TOLERANCE_SECONDS = 2;

/** The two Basescan clips the owner records by hand, by the base name they drop into film/input/. */
export const CLIPS = Object.freeze({ decisionLog: "basescan-decision-log", inputUtf8: "basescan-input-utf8" });

/** Where a page shot puts the element it scrolls to, in CSS px from the top of the viewport, per format. */
const TOP = { wide: 112, tall: 88 };

/**
 * A shot is one of:
 * - page: the live site at `path`, driven by `steps` (wait, scroll, hold, click, capture); its last frame is held to
 *   the end of `duration`;
 * - card: a still the capture renders from repository files (`card` names it), held for `duration`;
 * - tx: one card per key of film/txs.json in `txs`; `caption` when every hash is set, `placeholderCaption` when none
 *   is, and `partialCaption` (needed for two or more txs) when only some are;
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
      { id: "title", kind: "card", card: "title", duration: 3, captions: [] },
      {
        id: "gap",
        kind: "page",
        path: "/gap-index",
        duration: 11,
        steps: [
          { wait: "#gap-panel-2026-11-06-NVDAc" },
          { hold: 1 },
          { scroll: "#window-2026-11-06", over: 2, top: TOP },
          { hold: 2.5 },
          { scroll: "#gap-panel-2026-11-06-NVDAc svg", over: 1.5, top: { wide: 260, tall: 220 } },
        ],
        captions: [
          { id: "gap-held", at: 0 },
          { id: "gap-swaps", at: 5.5 },
        ],
      },
    ],
  },
  {
    id: "proposes-decides",
    title: "Claude proposes, the vault decides",
    shots: [
      {
        id: "how",
        kind: "page",
        path: "/",
        duration: 6,
        steps: [{ wait: "#how" }, { scroll: "#how-title", over: 1.5, top: TOP }],
        captions: [{ id: "decides-how", at: 0 }],
      },
      {
        id: "decision-log",
        kind: "clip",
        clip: CLIPS.decisionLog,
        duration: 6,
        captions: [{ id: "decides-clip", at: 0 }],
        fallback: {
          id: "reasons",
          kind: "page",
          path: "/",
          duration: 6,
          steps: [{ wait: "#reasons" }, { scroll: "#reasons-title", over: 1.5, top: TOP }],
          captions: [{ id: "decides-log", at: 0 }],
        },
      },
    ],
  },
  {
    id: "mandate",
    title: "The brief and the approved mandate",
    shots: [
      {
        id: "mandate",
        kind: "page",
        path: "/ledger",
        duration: 12,
        steps: [
          // The panel shows the configured defaults until it has read the vault; the captions take only the onchain mandate.
          { wait: 'section[aria-label="Mandate"] caption:has-text("The mandate onchain")' },
          { wait: '[aria-label="Mainnet decisions"]' },
          { capture: "ledger.perTrade" },
          { capture: "ledger.perDay" },
          { capture: "ledger.weightCapPct" },
          { scroll: 'section[aria-label="Mandate"]', over: 2, top: TOP },
          { hold: 4 },
          { scroll: 'section[aria-label="Mandate"] tr:has-text("maxWeightBps")', over: 1.5, top: { wide: 420, tall: 300 } },
        ],
        // mandate-reserve shows only once the vault's cap equals the reserve script's; until then, mandate-timelock.
        captions: [
          { id: "mandate-brief", at: 0 },
          { id: "mandate-caps", at: 4 },
          { id: "mandate-reserve", at: 8 },
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
        duration: 8,
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
        duration: 6,
        captions: [{ id: "proposal-clip", at: 0 }],
        fallback: {
          id: "verify",
          kind: "page",
          path: "/ledger",
          duration: 6,
          steps: [{ wait: "#verify" }, { scroll: "#verify-title", over: 1.5, top: TOP }],
          captions: [{ id: "proposal-verify", at: 0 }],
        },
      },
    ],
  },
  {
    id: "thanksgiving",
    title: "Thanksgiving: MARKET_CLOSED from the agent",
    shots: [
      {
        id: "sim",
        kind: "page",
        path: "/",
        duration: 4,
        steps: [
          { wait: "#try" },
          { click: { within: '[aria-label="Moment presets"]', button: "Thanksgiving" }, settle: 2.5 },
          { scroll: '[aria-label="Simulated checks"]', over: 1.5, top: { wide: 160, tall: 40 } },
        ],
        captions: [{ id: "thanksgiving-sim", at: 0 }],
      },
      { id: "tx", kind: "tx", txs: ["thanksgiving"], duration: 6, caption: "thanksgiving-tx", placeholderCaption: "thanksgiving-placeholder" },
    ],
  },
  {
    id: "early-close",
    title: "The early-close pair",
    shots: [
      {
        id: "sim",
        kind: "page",
        path: "/",
        duration: 4,
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
        duration: 8,
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
        steps: [{ wait: "#send-title" }, { hold: 1 }, { scroll: "#send-title", over: 1.5, top: TOP }],
        captions: [{ id: "brief-ask", at: 0 }],
      },
      {
        id: "tx",
        kind: "tx",
        txs: ["strangerBrief", "vaultAnswer"],
        duration: 7,
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
      { id: "ci", kind: "card", card: "ci", duration: 4, captions: [{ id: "receipts-ci", at: 0 }] },
      {
        id: "proof",
        kind: "page",
        path: "/proof",
        duration: 4,
        steps: [{ wait: "#counts-title" }, { scroll: "#counts-title", over: 1.5, top: TOP }],
        captions: [{ id: "receipts-proof", at: 0 }],
      },
      { id: "end", kind: "card", card: "end", duration: 2, captions: [] },
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
    }
    if (shot.kind === "tx" && (!Array.isArray(shot.txs) || shot.txs.length === 0 || !shot.caption || !shot.placeholderCaption)) {
      problems.push(`${where}: a tx shot needs txs, a caption and a placeholder caption`);
    }
    if (shot.kind === "tx" && shot.txs?.length > 1 && !shot.partialCaption) problems.push(`${where}: a tx shot of two or more txs needs a partial caption`);
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
