// @vitest-environment node
import { describe, expect, it } from "vitest";
import { BEATS, CLIPS, FPS, TARGET_SECONDS, TOLERANCE_SECONDS, effectiveShot, scrollGoal, shotCues, timeline, txKeys, txState, validateBeats } from "../../film/lib/beats.mjs";

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
    expect(problems).toMatch(/the cut lasts .* s, not 100 ± 2 s/);
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
