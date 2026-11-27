// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  BEATS,
  CLIPS,
  FPS,
  TARGET_SECONDS,
  TOLERANCE_SECONDS,
  effectiveShot,
  forFormat,
  keepClearProblem,
  scrollGoal,
  shotCues,
  timeline,
  txKeys,
  txState,
  unsliceGoal,
  validateBeats,
} from "../../film/lib/beats.mjs";
import { FRAME_CSS, HIDDEN_IN_FILM } from "../../film/lib/frame.mjs";

// film/ renders the demo film from the live site with ffmpeg, on the owner's PC only. CI has no ffmpeg and no network,
// so these tests check the plan itself: the beats, their order and the arithmetic of the timeline.

const NO_CLIPS = new Set<string>();
const ALL_CLIPS = new Set<string>(Object.values(CLIPS));

describe("the film's beat plan", () => {
  it("has the eight beats of the win plan's Move 8, in its order", () => {
    expect(BEATS.map((b) => b.id)).toEqual([
      "frozen-feed",
      "proposes-decides",
      "mandate",
      "sourced-proposal",
      "thanksgiving",
      "early-close",
      "stranger-brief",
      "receipts",
    ]);
  });

  it("passes its own checks", () => {
    expect(validateBeats(BEATS)).toEqual([]);
  });

  it("lasts about 100 s, with the owner's two clips or without them", () => {
    for (const clips of [NO_CLIPS, ALL_CLIPS]) {
      const { total } = timeline(BEATS, clips);
      expect(Math.abs(total - TARGET_SECONDS)).toBeLessThanOrEqual(TOLERANCE_SECONDS);
    }
    expect(timeline(BEATS, NO_CLIPS).total).toBe(timeline(BEATS, ALL_CLIPS).total);
  });

  it("starts each shot where the one before ends, on a whole frame", () => {
    const { shots, total } = timeline(BEATS, NO_CLIPS);
    let end = 0;
    for (const s of shots) {
      expect(s.start).toBeCloseTo(end, 9);
      expect(Number.isInteger(Math.round(s.duration * FPS * 1e6) / 1e6)).toBe(true);
      end = s.start + s.duration;
    }
    expect(end).toBeCloseTo(total, 9);
  });

  it("uses an owner clip when it is in the input folder, and its fallback page otherwise", () => {
    const clipShot = BEATS.flatMap((b) => b.shots).find((s) => s.kind === "clip");
    expect(clipShot).toBeDefined();
    if (!clipShot || clipShot.kind !== "clip") return;
    expect(effectiveShot(clipShot, new Set([clipShot.clip])).kind).toBe("clip");
    expect(effectiveShot(clipShot, NO_CLIPS)).toBe(clipShot.fallback);
    expect(timeline(BEATS, NO_CLIPS).shots.some((s) => s.shot.kind === "clip")).toBe(false);
    expect(timeline(BEATS, ALL_CLIPS).shots.filter((s) => s.shot.kind === "clip").map((s) => s.shot.clip)).toEqual([
      CLIPS.decisionLog,
      CLIPS.inputUtf8,
    ]);
  });

  it("shows beats 5 to 7's transactions from tx shots, with a placeholder caption until every hash is set", () => {
    expect(txKeys(BEATS)).toEqual([
      { key: "thanksgiving", beat: "thanksgiving" },
      { key: "earlyCloseAllowed", beat: "early-close" },
      { key: "earlyCloseRefused", beat: "early-close" },
      { key: "strangerBrief", beat: "stranger-brief" },
      { key: "vaultAnswer", beat: "stranger-brief" },
    ]);
    const tx = BEATS.find((b) => b.id === "thanksgiving")?.shots.find((s) => s.kind === "tx");
    expect(tx).toBeDefined();
    if (!tx) return;
    expect(shotCues(tx, "all")).toEqual([{ id: "thanksgiving-tx", at: 0 }]);
    expect(shotCues(tx, "none")).toEqual([{ id: "thanksgiving-placeholder", at: 0 }]);
  });

  it("says so when only one transaction of a pair is on Base", () => {
    const pair = BEATS.find((b) => b.id === "early-close")?.shots.find((s) => s.kind === "tx");
    expect(pair).toBeDefined();
    if (!pair) return;
    expect(txState([{ kind: "tx" }, { kind: "tx" }])).toBe("all");
    expect(txState([{ kind: "tx" }, { kind: "placeholder" }])).toBe("some");
    expect(txState([{ kind: "placeholder" }, { kind: "placeholder" }])).toBe("none");
    expect(shotCues(pair, "all")).toEqual([{ id: "early-tx", at: 0 }]);
    expect(shotCues(pair, "some")).toEqual([{ id: "pair-partial", at: 0 }]);
    expect(shotCues(pair, "none")).toEqual([{ id: "early-placeholder", at: 0 }]);
    for (const shot of BEATS.flatMap((b) => b.shots).filter((s) => s.kind === "tx" && s.txs.length > 1)) {
      expect(shot.partialCaption, shot.id).toBe("pair-partial");
    }
  });

  it("reads the mandate only once /ledger shows the onchain mandate, not the configured defaults", () => {
    const steps = BEATS.find((b) => b.id === "mandate")?.shots[0]?.steps ?? [];
    const firstCapture = steps.findIndex((s: { capture?: string }) => s.capture);
    const onchain = steps.findIndex((s: { wait?: string }) => s.wait?.includes('caption:has-text("The mandate onchain")'));
    expect(onchain).toBeGreaterThanOrEqual(0);
    expect(onchain).toBeLessThan(firstCapture);
  });

  it("catches steps that outrun a shot, a cue past its end, a fallback of another length and a length off the frame grid", () => {
    const broken = [
      {
        id: "b",
        title: "broken",
        shots: [
          { id: "page", kind: "page", path: "/", duration: 2, steps: [{ scroll: "#x", over: 3 }], captions: [{ id: "c", at: 0 }] },
          { id: "late", kind: "card", card: "end", duration: 1, captions: [{ id: "c", at: 1.5 }] },
          {
            id: "clip",
            kind: "clip",
            clip: CLIPS.inputUtf8,
            duration: 4,
            captions: [],
            fallback: { id: "fb", kind: "card", card: "end", duration: 3, captions: [] },
          },
          { id: "odd", kind: "card", card: "end", duration: 1.01, captions: [] },
          { id: "pair", kind: "tx", txs: ["a", "b"], duration: 1, caption: "c", placeholderCaption: "p" },
          { id: "poster", kind: "tx", txs: ["a"], duration: 1, caption: "c", placeholderCaption: "p", layout: "poster" },
          { id: "lone", kind: "tx", txs: ["a"], duration: 1, caption: "c", placeholderCaption: "p", layout: "persuasion" },
          { id: "goon", kind: "card", card: "end", duration: 1, captions: [], continue: true },
          { id: "peek", kind: "page", path: "/", duration: 1, steps: [{ probe: "ask.closed" }], captions: [] },
        ],
      },
    ];
    const problems = validateBeats(broken).join("\n");
    expect(problems).toMatch(/b\/pair: a tx shot of two or more txs needs a partial caption/);
    expect(problems).toMatch(/b\/page: its steps take 3 s, longer than the shot's 2 s/);
    expect(problems).toMatch(/b\/late: cue c at 1.5 s is outside the shot/);
    expect(problems).toMatch(/b\/clip: its fallback lasts 3 s, not 4 s/);
    expect(problems).toMatch(/b\/odd: duration 1.01 is not a positive whole number of frames/);
    expect(problems).toMatch(/b\/poster: unknown layout poster/);
    expect(problems).toMatch(/b\/lone: the persuasion layout needs two txs, a brief and the vault's Decision/);
    expect(problems).toMatch(/b\/goon: only a page shot can continue or keep an element clear/);
    expect(problems).toMatch(/b\/peek: unknown probe ask\.closed/);
    expect(problems).toMatch(/the cut lasts .* s, not 100 ± 2 s/);
  });
});

describe("the cut's pace (film v0 review, 2026-11-27)", () => {
  const len = (beat: string, slot: string) => timeline(BEATS, NO_CLIPS).shots.find((s) => s.beat === beat && s.slot === slot)?.duration;

  it("gives the title card its reading time, shortens the mandate, holds the decision trail longer and keeps 100 s", () => {
    expect(len("frozen-feed", "title")).toBe(6);
    expect(len("mandate", "mandate")).toBe(10.5);
    expect(len("sourced-proposal", "trail")).toBe(7.5);
    expect(len("receipts", "ci")).toBe(3);
    expect(len("receipts", "proof")).toBe(3.5);
    expect(len("receipts", "end")).toBe(6.5);
    expect(timeline(BEATS, NO_CLIPS).total).toBe(TARGET_SECONDS);
  });

  it("does not load a page again from its top between consecutive shots of the same page", () => {
    const pages = timeline(BEATS, NO_CLIPS).shots.filter((s) => s.shot.kind === "page");
    pages.forEach((s, i) => {
      const before = pages[i - 1];
      if (before && before.shot.path === s.shot.path) expect(s.shot.continue, `${s.beat}/${s.slot}`).toBe(true);
      if (s.shot.continue) expect(before?.shot.path, `${s.beat}/${s.slot} continues the page shot before it`).toBe(s.shot.path);
    });
    expect(pages.filter((s) => s.shot.continue).map((s) => `${s.beat}/${s.slot}`)).toEqual([
      "proposes-decides/decision-log",
      "sourced-proposal/trail",
      "sourced-proposal/input-utf8",
      "early-close/sim",
    ]);
  });

  it("films /proof only once its counts are read", () => {
    const proof = BEATS.find((b) => b.id === "receipts")?.shots.find((s) => s.id === "proof");
    expect(proof?.steps).toContainEqual({ wait: '[data-proof-state="read"]' });
  });
});

describe("the frame the capture films", () => {
  it("hides per-viewer and relative lines and the phone layout's bottom bar, and wraps code blocks", () => {
    for (const selector of HIDDEN_IN_FILM) expect(FRAME_CSS).toContain(selector);
    expect(FRAME_CSS).toMatch(/\[data-thumb-bar\]\{display:none !important\}/);
    expect(FRAME_CSS).toMatch(/pre,pre code\{white-space:pre-wrap !important/);
  });

  it("takes a step's per-format value, or the value itself", () => {
    expect(forFormat({ wide: "#a", tall: "#b" }, "tall")).toBe("#b");
    expect(forFormat("#a", "tall")).toBe("#a");
    expect(forFormat({ wide: 160, tall: 88 }, "wide")).toBe(160);
    expect(forFormat(undefined, "wide")).toBeUndefined();
  });

  it("goes to the NVDAc panel in 9:16, so the chart's drop is not under the caption, and keeps the chart clear", () => {
    const gap = BEATS.find((b) => b.id === "frozen-feed")?.shots.find((s) => s.id === "gap");
    expect(gap?.keepClear).toBe("#gap-panel-2026-11-06-NVDAc svg");
    const first = gap?.steps?.find((s: { scroll?: unknown }) => s.scroll);
    expect(forFormat(first?.scroll, "tall")).toBe("#gap-panel-2026-11-06-NVDAc");
    expect(forFormat(first?.scroll, "wide")).toBe("#window-2026-11-06");
  });

  it("moves a scroll stop so that no line of text is cut by the top edge or the nav bar", () => {
    const lines = [
      { top: 100, bottom: 120 },
      { top: 130, bottom: 150 },
      { top: 300, bottom: 320 },
    ];
    // Nothing crosses the edge: the stop stays.
    expect(unsliceGoal({ y: 125, lines, limit: 1000 })).toBe(125);
    // A line crosses the top edge at 110: scroll up 10 px to show it whole, rather than 10 px down to hide it (a tie).
    expect(unsliceGoal({ y: 110, lines, limit: 1000 })).toBe(100);
    // Nearer to its bottom: scroll down to hide it.
    expect(unsliceGoal({ y: 118, lines, limit: 1000 })).toBe(120);
    // Under an 82 px nav bar, the edge is 82 px into the frame.
    expect(unsliceGoal({ y: 222, lines, edge: 82, limit: 1000 })).toBe(218);
    // Inside the page only.
    expect(unsliceGoal({ y: 5, lines: [{ top: 0, bottom: 20 }], limit: 1000 })).toBe(0);
    expect(unsliceGoal({ y: 995, lines: [{ top: 990, bottom: 1010 }], limit: 1000 })).toBe(990);
    // Text packed tighter than the reach: the stop stays.
    const dense = Array.from({ length: 50 }, (_, i) => ({ top: i * 10, bottom: i * 10 + 11 }));
    expect(unsliceGoal({ y: 200, lines: dense, limit: 1000, reach: 20 })).toBe(200);
  });

  it("names a caption band that would cover an element a shot keeps clear", () => {
    expect(keepClearProblem("ask", { top: 500, bottom: 656 }, 670, 960)).toBeNull();
    expect(keepClearProblem("ask", { top: 1000, bottom: 1300 }, 670, 960)).toBeNull();
    expect(keepClearProblem("ask", { top: 500, bottom: 790 }, 670, 960)).toBe(
      "ask: the caption band starts at 670 px and would cover the element it keeps clear, which ends at 790 px",
    );
  });

  it("ends the /ask shot with its form, or its not-open notice, above the caption", () => {
    const ask = BEATS.find((b) => b.id === "stranger-brief")?.shots.find((s) => s.id === "ask");
    expect(ask?.keepClear).toBe('section[aria-labelledby="send-title"] > :last-child');
    const scroll = ask?.steps?.find((s: { scroll?: unknown }) => s.scroll);
    expect(forFormat(scroll?.top, "tall")).toBe(400);
  });
});

describe("where a page shot scrolls to", () => {
  // The /ask shot scrolled to its send form until the site footer's display line sat behind the caption (1920x1080:
  // the footer's top at 821 px). A scroll now stops where the footer's top meets the frame's bottom edge.
  it("puts the target at its offset, inside the page, and never brings the site footer into the frame", () => {
    expect(scrollGoal({ target: 476, offset: 112, max: 783, footer: null, height: 1080 })).toBe(364);
    expect(scrollGoal({ target: 476, offset: 112, max: 783, footer: 1185, height: 1080 })).toBe(105);
    expect(scrollGoal({ target: 2000, offset: 112, max: 783, footer: 99999, height: 1080 })).toBe(783);
    expect(scrollGoal({ target: 50, offset: 112, max: 783, footer: 99999, height: 1080 })).toBe(0);
    // A page whose footer is in the first frame cannot keep it out: the shot stays at the top.
    expect(scrollGoal({ target: 476, offset: 112, max: 300, footer: 900, height: 1080 })).toBe(0);
  });
});
