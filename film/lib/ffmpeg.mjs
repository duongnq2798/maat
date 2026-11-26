// The ffmpeg argument lists. Pure functions: film/assemble.mjs runs them with ffmpeg on the owner's PC, and the web
// unit tests check them in CI, where there is no ffmpeg.

import { FPS } from "./beats.mjs";
import { FORMATS } from "./formats.mjs";

/** The fade to and from black at each beat's edges, in seconds. */
export const FADE_SECONDS = 0.25;
const BG = "0x0B0D12";
const even = (n) => 2 * Math.round(n / 2);
const num = (n) => String(Math.round(n * 1e6) / 1e6);

/**
 * How a shot's frames fill a format. Page, card and tx shots are captured at the format's own size, so they are used
 * as they are. An owner clip (a desktop screen recording) is fitted: in 16:9 it is scaled to fit and padded; in 9:16
 * it spans the width, a little above centre so the caption below does not cover it, over a blurred fill of itself.
 */
export function layoutPlan(kind, format, source) {
  const f = FORMATS[format];
  if (!f) throw new Error(`unknown format ${format}`);
  if (kind !== "clip") return { mode: "native", width: f.width, height: f.height };
  if (!source?.width || !source?.height) throw new Error("an owner clip's layout needs its size (ffprobe reads it)");
  if (format === "tall") {
    const h = even((f.width * source.height) / source.width);
    return { mode: "fit-blur", width: f.width, height: f.height, fg: { w: f.width, h, x: 0, y: Math.round((f.height - h) * 0.4) } };
  }
  const scale = Math.min(f.width / source.width, f.height / source.height);
  const w = even(source.width * scale);
  const h = even(source.height * scale);
  return { mode: "fit", width: f.width, height: f.height, fg: { w, h, x: (f.width - w) / 2, y: (f.height - h) / 2 } };
}

/** The filter that takes input 0 to [base] at the format's size, by the plan. */
export function layoutFilter(plan) {
  if (plan.mode === "native") return `[0:v]scale=${plan.width}:${plan.height}:flags=lanczos,setsar=1[base]`;
  const { fg } = plan;
  if (plan.mode === "fit") return `[0:v]scale=${fg.w}:${fg.h}:flags=lanczos,pad=${plan.width}:${plan.height}:${fg.x}:${fg.y}:color=${BG},setsar=1[base]`;
  if (plan.mode === "fit-blur") {
    return [
      "[0:v]split=2[bgsrc][fgsrc]",
      `[bgsrc]scale=${plan.width}:${plan.height}:force_original_aspect_ratio=increase,crop=${plan.width}:${plan.height},gblur=sigma=40,eq=brightness=-0.15[bg]`,
      `[fgsrc]scale=${fg.w}:${fg.h}:flags=lanczos[fg]`,
      `[bg][fg]overlay=${fg.x}:${fg.y},setsar=1[base]`,
    ].join(";");
  }
  throw new Error(`unknown layout ${plan.mode}`);
}

const quote = (name) => `'${String(name).replace(/\\/g, "/").replace(/'/g, "'\\''")}'`;

/** An ffconcat list of the frames of a page shot, each with its time on screen; the last is repeated, as the demuxer needs. */
export function frameListText(frames) {
  const lines = ["ffconcat version 1.0"];
  for (const f of frames) lines.push(`file ${quote(f.file)}`, `duration ${f.duration.toFixed(6)}`);
  const last = frames.at(-1);
  if (last) lines.push(`file ${quote(last.file)}`);
  return `${lines.join("\n")}\n`;
}

/** An ffconcat list of whole files, for joining the segments. */
export function concatListText(files) {
  return `${["ffconcat version 1.0", ...files.map((f) => `file ${quote(f)}`)].join("\n")}\n`;
}

function inputArgs(input) {
  if (input.kind === "frames") return ["-f", "concat", "-safe", "0", "-i", input.list];
  if (input.kind === "image") return ["-loop", "1", "-framerate", String(FPS), "-i", input.file];
  if (input.kind === "video") return [...(input.trim ? ["-ss", num(input.trim)] : []), "-i", input.file];
  throw new Error(`unknown input ${input.kind}`);
}

/**
 * One shot, encoded to its own H.264 file: input 0 is the shot, inputs 1.. are its caption overlays (full-frame PNGs),
 * each shown from `from` to `to` seconds. Fades only at a beat's first and last shot.
 */
export function segmentArgs({ input, plan, duration, cues, fadeIn, fadeOut, out }) {
  const args = ["-y", "-hide_banner", "-loglevel", "error", ...inputArgs(input)];
  for (const c of cues) args.push("-loop", "1", "-framerate", String(FPS), "-i", c.png);
  const graph = [layoutFilter(plan)];
  const hold = input.kind === "video" ? `tpad=stop_mode=clone:stop_duration=${num(duration)},` : "";
  graph.push(`[base]${hold}fps=${FPS}[l0]`);
  cues.forEach((c, i) => graph.push(`[l${i}][${i + 1}:v]overlay=0:0:enable='gte(t,${num(c.from)})*lt(t,${num(c.to)})'[l${i + 1}]`));
  const fades = [];
  if (fadeIn) fades.push(`fade=t=in:st=0:d=${FADE_SECONDS}`);
  if (fadeOut) fades.push(`fade=t=out:st=${num(duration - FADE_SECONDS)}:d=${FADE_SECONDS}`);
  graph.push(`[l${cues.length}]${[...fades, "format=yuv420p"].join(",")}[v]`);
  args.push(
    "-filter_complex",
    graph.join(";"),
    "-map",
    "[v]",
    "-t",
    num(duration),
    "-r",
    String(FPS),
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-an",
    "-movflags",
    "+faststart",
    out,
  );
  return args;
}

/** The final cut: the segments joined as they are, with a silent stereo track so every player accepts the file. */
export function finalArgs({ list, out }) {
  return [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-shortest",
    "-movflags",
    "+faststart",
    out,
  ];
}

/**
 * One segment job per shot of the timeline, in order. `asset(shot)` gives the shot's input, layout plan and caption
 * cues (with their PNGs) for this format; the job's file is `dir/NN.mp4`.
 */
export function planSegments({ shots, format, asset, dir }) {
  return shots.map((s, i) => {
    const a = asset(s);
    const out = `${dir}/${String(i + 1).padStart(2, "0")}.mp4`;
    const args = segmentArgs({
      format,
      input: a.input,
      plan: a.plan,
      duration: s.duration,
      cues: a.cues,
      fadeIn: shots[i - 1]?.beat !== s.beat,
      fadeOut: shots[i + 1]?.beat !== s.beat,
      out,
    });
    return { out, args, duration: s.duration, beat: s.beat, slot: s.slot };
  });
}
