#!/usr/bin/env node
// Writes the two text tracks of one cut as WebVTT from a render's work/manifest.json, for the landing's film band
// (web/public/film/): the captions of its sound, from film/narration.json, and its on-screen text, the captions the cut
// burned in, checked against film/captions.json. It writes nothing while either does not match.
// Local only, and no network: it reads the manifest, narration.json and captions.json.
// Usage: node film/vtt.mjs --manifest <work/manifest.json> --captions <file.vtt> --on-screen <file.vtt> [--format wide]

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { narrationCues, narrationProblems, vttCues, vttProblems, webvtt } from "./lib/vtt.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const { values } = parseArgs({
  options: {
    manifest: { type: "string" },
    captions: { type: "string" },
    "on-screen": { type: "string" },
    format: { type: "string", default: "wide" },
  },
});
const onScreenOut = values["on-screen"];
if (!values.manifest || !values.captions || !onScreenOut) {
  console.error("usage: node film/vtt.mjs --manifest <work/manifest.json> --captions <file.vtt> --on-screen <file.vtt> [--format wide|tall]");
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(resolve(values.manifest), "utf8"));
const shots = manifest.formats?.[values.format]?.shots;
if (!Array.isArray(shots)) {
  console.error(`${values.manifest} has no ${values.format} cut`);
  process.exit(1);
}
const { captions } = JSON.parse(readFileSync(join(HERE, "captions.json"), "utf8"));
const { lines } = JSON.parse(readFileSync(join(HERE, "narration.json"), "utf8"));
const onScreen = vttCues(shots);
const problems = [...narrationProblems(lines, shots), ...vttProblems(onScreen, captions, manifest.total)];
if (problems.length > 0) {
  console.error(problems.map((p) => `x ${p}`).join("\n"));
  process.exit(1);
}
const voice = narrationCues(shots, lines);
writeFileSync(resolve(values.captions), webvtt(voice));
writeFileSync(resolve(onScreenOut), webvtt(onScreen));
console.log(`${values.captions}: ${voice.length} cues of the voice-over; ${onScreenOut}: ${onScreen.length} cues of on-screen text; ${values.format} cut of ${manifest.total} s`);
