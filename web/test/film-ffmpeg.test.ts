// @vitest-environment node
import { describe, expect, it } from "vitest";
import { BEATS, CLIPS, FPS, timeline } from "../../film/lib/beats.mjs";
import { FADE_SECONDS, concatListText, finalArgs, frameListText, layoutFilter, layoutPlan, planSegments, segmentArgs } from "../../film/lib/ffmpeg.mjs";
import { FORMATS } from "../../film/lib/formats.mjs";

// The ffmpeg command builder, run in CI with no ffmpeg: the render command (film/render.mjs) runs these arguments on
// the owner's PC only. Every check here is on the argument lists and the layout arithmetic.

const arg = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe("the two formats", () => {
  it("are 16:9 at 1920x1080 and 9:16 at 1080x1920, each captured at its own viewport", () => {
    expect(FORMATS.wide).toMatchObject({ width: 1920, height: 1080, label: "16:9" });
    expect(FORMATS.tall).toMatchObject({ width: 1080, height: 1920, label: "9:16" });
    for (const f of Object.values(FORMATS)) {
      expect(f.viewport.width * f.dpr).toBe(f.width);
      expect(f.viewport.height * f.dpr).toBe(f.height);
    }
    // The 9:16 viewport is under the site's 768 px breakpoint, so it shows the phone layout.
    expect(FORMATS.tall.viewport.width).toBeLessThan(768);
  });
});

describe("the 9:16 layout plan", () => {
  it("uses page, card and tx shots as captured, since each format captures its own frames", () => {
    for (const kind of ["page", "card", "tx"]) {
      expect(layoutPlan(kind, "tall")).toEqual({ mode: "native", width: 1080, height: 1920 });
      expect(layoutPlan(kind, "wide")).toEqual({ mode: "native", width: 1920, height: 1080 });
    }
  });

  it("puts a 16:9 owner clip across the 9:16 frame's width, above centre, over a blurred fill of itself", () => {
    expect(layoutPlan("clip", "tall", { width: 1920, height: 1080 })).toEqual({
      mode: "fit-blur",
      width: 1080,
      height: 1920,
      fg: { w: 1080, h: 608, x: 0, y: 525 },
    });
    expect(layoutPlan("clip", "tall", { width: 2560, height: 1440 })).toMatchObject({ fg: { w: 1080, h: 608 } });
  });

  it("fits an owner clip into 16:9, padding a frame of another shape", () => {
    expect(layoutPlan("clip", "wide", { width: 1920, height: 1080 })).toEqual({ mode: "fit", width: 1920, height: 1080, fg: { w: 1920, h: 1080, x: 0, y: 0 } });
    expect(layoutPlan("clip", "wide", { width: 1280, height: 1024 })).toEqual({ mode: "fit", width: 1920, height: 1080, fg: { w: 1350, h: 1080, x: 285, y: 0 } });
  });

  it("needs the clip's size, which the render reads with ffprobe", () => {
    expect(() => layoutPlan("clip", "tall")).toThrow(/size/);
  });

  it("turns each plan into its filter", () => {
    expect(layoutFilter({ mode: "native", width: 1080, height: 1920 })).toBe("[0:v]scale=1080:1920:flags=lanczos,setsar=1[base]");
    expect(layoutFilter({ mode: "fit", width: 1920, height: 1080, fg: { w: 1350, h: 1080, x: 285, y: 0 } })).toBe(
      "[0:v]scale=1350:1080:flags=lanczos,pad=1920:1080:285:0:color=0x0B0D12,setsar=1[base]",
    );
    expect(layoutFilter({ mode: "fit-blur", width: 1080, height: 1920, fg: { w: 1080, h: 608, x: 0, y: 525 } })).toBe(
      "[0:v]split=2[bgsrc][fgsrc];[bgsrc]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=40,eq=brightness=-0.15[bg];[fgsrc]scale=1080:608:flags=lanczos[fg];[bg][fg]overlay=0:525,setsar=1[base]",
    );
  });
});

describe("a segment", () => {
  const cues = [
    { png: "cap/gap-held.png", from: 0, to: 5.5 },
    { png: "cap/gap-swaps.png", from: 5.5, to: 11 },
  ];

  it("reads a page shot's frames through the concat demuxer, burns each caption in its window and fades at the beat's edges", () => {
    const args = segmentArgs({
      input: { kind: "frames", list: "frames/gap.txt" },
      plan: layoutPlan("page", "wide"),
      duration: 11,
      cues,
      fadeIn: true,
      fadeOut: true,
      out: "seg/01.mp4",
    });
    expect(args.slice(0, 4)).toEqual(["-y", "-hide_banner", "-loglevel", "error"]);
    expect(args.join(" ")).toContain("-f concat -safe 0 -i frames/gap.txt");
    expect(args.join(" ")).toContain("-loop 1 -framerate 30 -i cap/gap-held.png -loop 1 -framerate 30 -i cap/gap-swaps.png");
    const graph = arg(args, "-filter_complex") ?? "";
    expect(graph).toBe(
      [
        "[0:v]scale=1920:1080:flags=lanczos,setsar=1[base]",
        "[base]fps=30[l0]",
        "[l0][1:v]overlay=0:0:enable='gte(t,0)*lt(t,5.5)'[l1]",
        "[l1][2:v]overlay=0:0:enable='gte(t,5.5)*lt(t,11)'[l2]",
        `[l2]fade=t=in:st=0:d=${FADE_SECONDS},fade=t=out:st=${11 - FADE_SECONDS}:d=${FADE_SECONDS},format=yuv420p[v]`,
      ].join(";"),
    );
    expect(arg(args, "-map")).toBe("[v]");
    expect(arg(args, "-t")).toBe("11");
    expect(arg(args, "-r")).toBe(String(FPS));
    expect(arg(args, "-c:v")).toBe("libx264");
    expect(arg(args, "-pix_fmt")).toBe("yuv420p");
    expect(args).toContain("-an");
    expect(args.at(-1)).toBe("seg/01.mp4");
  });

  it("loops a card for its length, with no fade inside a beat", () => {
    const args = segmentArgs({ input: { kind: "image", file: "cards/ci.png" }, plan: layoutPlan("card", "tall"), duration: 4, cues: [], fadeIn: false, fadeOut: false, out: "s.mp4" });
    expect(args.join(" ")).toContain("-loop 1 -framerate 30 -i cards/ci.png");
    expect(arg(args, "-filter_complex")).toBe("[0:v]scale=1080:1920:flags=lanczos,setsar=1[base];[base]fps=30[l0];[l0]format=yuv420p[v]");
  });

  it("trims an owner clip and holds its last frame if it runs short", () => {
    const args = segmentArgs({
      input: { kind: "video", file: "input/basescan-input-utf8.mp4", trim: 1.5 },
      plan: layoutPlan("clip", "tall", { width: 1920, height: 1080 }),
      duration: 6,
      cues: [{ png: "c.png", from: 0, to: 6 }],
      fadeIn: false,
      fadeOut: true,
      out: "s.mp4",
    });
    expect(args.join(" ")).toContain("-ss 1.5 -i input/basescan-input-utf8.mp4");
    expect(arg(args, "-filter_complex")).toContain("[base]tpad=stop_mode=clone:stop_duration=6,fps=30[l0]");
  });
});

describe("the frame list of a page shot", () => {
  it("gives each frame its time on screen, repeats the last one as the concat demuxer needs, and sums to the shot", () => {
    const text = frameListText([
      { file: "f00000.jpg", duration: 1 },
      { file: "f00001.jpg", duration: 1 / 30 },
      { file: "f00002.jpg", duration: 9.966666666666667 },
    ]);
    expect(text).toBe(
      ["ffconcat version 1.0", "file 'f00000.jpg'", "duration 1.000000", "file 'f00001.jpg'", "duration 0.033333", "file 'f00002.jpg'", "duration 9.966667", "file 'f00002.jpg'", ""].join("\n"),
    );
  });

  it("quotes a file name with a quote in it", () => {
    expect(concatListText(["it's.mp4"])).toBe("ffconcat version 1.0\nfile 'it'\\''s.mp4'\n");
  });
});

describe("the cut", () => {
  it("joins the segments without re-encoding and adds a silent stereo track", () => {
    const args = finalArgs({ list: "segments.txt", out: "maat-film-16x9.mp4" });
    expect(args.join(" ")).toBe(
      "-y -hide_banner -loglevel error -f concat -safe 0 -i segments.txt -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000 -map 0:v -map 1:a -c:v copy -c:a aac -b:a 128k -shortest -movflags +faststart maat-film-16x9.mp4",
    );
  });

  it("plans one segment per shot in timeline order, fading at each beat's edges but not on the film's first and last frames", () => {
    const { shots } = timeline(BEATS, new Set());
    const segs = planSegments({
      shots,
      format: "tall",
      asset: (s: { beat: string; slot: string }) => ({ input: { kind: "image", file: `${s.beat}-${s.slot}.png` }, plan: layoutPlan("card", "tall"), cues: [] }),
      dir: "seg",
    });
    expect(segs).toHaveLength(shots.length);
    expect(segs.map((s: { out: string }) => s.out)).toEqual(shots.map((_, i) => `seg/${String(i + 1).padStart(2, "0")}.mp4`));
    const fades = segs.map((s: { args: string[] }) => [/fade=t=in/.test(s.args.join(" ")), /fade=t=out/.test(s.args.join(" "))]);
    // The first frame and the last frame show the mark (the title and end cards), so the cut neither opens nor ends on black.
    shots.forEach((s, i) => {
      expect(fades[i]).toEqual([i > 0 && shots[i - 1]?.beat !== s.beat, i < shots.length - 1 && shots[i + 1]?.beat !== s.beat]);
    });
    expect(fades[0]?.[0]).toBe(false);
    expect(fades.at(-1)?.[1]).toBe(false);
    expect(fades.filter((f: boolean[]) => f[0])).toHaveLength(BEATS.length - 1);
    expect(segs.reduce((t: number, s: { duration: number }) => t + s.duration, 0)).toBe(timeline(BEATS, new Set()).total);
  });

  it("plans the clip segments only when the owner's clips are there", () => {
    const withClips = timeline(BEATS, new Set(Object.values(CLIPS))).shots.filter((s) => s.shot.kind === "clip");
    expect(withClips.map((s) => s.beat)).toEqual(["proposes-decides", "sourced-proposal"]);
  });
});
