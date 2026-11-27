#!/usr/bin/env node
// Writes the captions track of one cut as WebVTT from a render's work/manifest.json, for the landing's film band
// (web/public/film/). It checks each cue against film/captions.json first and writes nothing while one does not match.
// Local only, and no network: it reads the manifest and captions.json.
// Usage: node film/vtt.mjs --manifest <work/manifest.json> --out <file.vtt> [--format wide]

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { vttCues, vttProblems, webvtt } from "./lib/vtt.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const { values } = parseArgs({
  options: { manifest: { type: "string" }, out: { type: "string" }, format: { type: "string", default: "wide" } },
});
if (!values.manifest || !values.out) {
  console.error("usage: node film/vtt.mjs --manifest <work/manifest.json> --out <file.vtt> [--format wide|tall]");
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(resolve(values.manifest), "utf8"));
const shots = manifest.formats?.[values.format]?.shots;
if (!Array.isArray(shots)) {
  console.error(`${values.manifest} has no ${values.format} cut`);
  process.exit(1);
}
const { captions } = JSON.parse(readFileSync(join(HERE, "captions.json"), "utf8"));
const cues = vttCues(shots);
const problems = vttProblems(cues, captions, manifest.total);
if (problems.length > 0) {
  console.error(problems.map((p) => `x ${p}`).join("\n"));
  process.exit(1);
}
writeFileSync(resolve(values.out), webvtt(cues));
console.log(`${values.out}: ${cues.length} cues, ${values.format} cut of ${manifest.total} s`);
