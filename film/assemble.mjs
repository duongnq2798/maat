#!/usr/bin/env node
// Turns the capture's manifest into the two cuts with ffmpeg: one H.264 segment per shot with its captions burned in,
// then the segments joined into film-16x9.mp4 and film-9x16.mp4. Local only: it needs ffmpeg and ffprobe on PATH.
// Usage: node film/assemble.mjs --work <dir> --out <dir>

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { concatListText, finalArgs, layoutPlan, planSegments } from "./lib/ffmpeg.mjs";
import { FORMATS } from "./lib/formats.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`${cmd} could not start (${r.error.message}); install it and put it on PATH`);
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(-1)[0]} failed:\n${r.stderr}`);
  return r.stdout;
}

/** Width, height and duration of a video file, from ffprobe. */
export function probe(file) {
  const out = JSON.parse(run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration,size", "-of", "json", file]));
  return { width: out.streams[0].width, height: out.streams[0].height, duration: Number(out.format.duration), size: Number(out.format.size) };
}

export function assemble({ work, out }) {
  const manifest = JSON.parse(readFileSync(join(work, "manifest.json"), "utf8"));
  mkdirSync(out, { recursive: true });
  const results = {};
  for (const [format, { shots }] of Object.entries(manifest.formats)) {
    const dir = join(work, format, "seg");
    mkdirSync(dir, { recursive: true });
    const timeline = shots.map((s) => ({ beat: s.beat, slot: s.slot, duration: s.duration, entry: s }));
    const jobs = planSegments({
      shots: timeline,
      format,
      dir,
      asset: ({ entry }) => ({
        input: entry.input,
        plan: layoutPlan(entry.kind, format, entry.kind === "clip" ? probe(entry.input.file) : undefined),
        cues: entry.cues,
      }),
    });
    for (const job of jobs) {
      process.stdout.write(`[${format}] segment ${job.out.slice(-6)} ${job.beat}/${job.slot} (${job.duration} s)\n`);
      run("ffmpeg", job.args);
    }
    const list = join(dir, "segments.txt");
    writeFileSync(list, concatListText(jobs.map((j) => j.out.slice(dir.length + 1))));
    const file = join(out, `maat-film-${FORMATS[format].file}.mp4`);
    run("ffmpeg", finalArgs({ list, out: file }));
    const p = probe(file);
    results[format] = { file, width: p.width, height: p.height, duration: p.duration, bytes: statSync(file).size };
  }
  const report = {
    total: manifest.total,
    outputs: results,
    placeholders: manifest.placeholders,
    fallbacks: manifest.fallbacks,
    standIns: manifest.standIns ?? [],
    clips: manifest.clips,
    captured: manifest.captured,
    warnings: manifest.warnings,
  };
  writeFileSync(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { work: { type: "string" }, out: { type: "string" } } });
  const out = resolve(values.out ?? join(ROOT, "film/out"));
  const report = assemble({ work: resolve(values.work ?? join(out, "work")), out });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
