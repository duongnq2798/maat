#!/usr/bin/env node
// The one command: capture the live site with Playwright, then assemble both cuts with ffmpeg.
// Local only (it needs Chromium, ffmpeg and the network). Usage, from the repository root:
//   node film/render.mjs [--out <dir>] [--input <dir>] [--formats wide,tall] [--site <url>] [--final]
// --final stops before capturing while any transaction the cut would show is still a placeholder; beat 7's stand-in
// (film/README.md, "Beat 7: the rule") is not one.

import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { assemble } from "./assemble.mjs";
import { ROOT, capture } from "./capture.mjs";

const { values } = parseArgs({
  options: { out: { type: "string" }, input: { type: "string" }, formats: { type: "string" }, site: { type: "string" }, final: { type: "boolean" } },
});
const out = resolve(values.out ?? join(ROOT, "film/out"));
const work = join(out, "work");
const started = Date.now();
await capture({
  work,
  input: resolve(values.input ?? join(ROOT, "film/input")),
  formats: (values.formats ?? "wide,tall").split(","),
  site: (values.site ?? "https://maatonbase.xyz").replace(/\/$/, ""),
  final: values.final === true,
});
const report = assemble({ work, out });

const lines = [`\nRendered in ${Math.round((Date.now() - started) / 1000)} s (planned cut: ${report.total} s)`];
for (const [format, r] of Object.entries(report.outputs)) lines.push(`  ${format}: ${r.file} · ${r.width}x${r.height} · ${r.duration.toFixed(2)} s · ${r.bytes} bytes`);
lines.push(
  report.placeholders.length === 0
    ? "  placeholders: none"
    : `  placeholders: ${report.placeholders.map((p) => `beat ${p.beat} ${p.id} (${p.missing.join(", ")})`).join("; ")}`,
);
lines.push(
  report.standIns.length === 0
    ? "  stand-ins: none"
    : `  stand-ins: ${report.standIns.map((x) => `beat ${x.beat} ${x.id} shows its ${x.standIn} stand-in (${x.txs.join(", ")})`).join("; ")}`,
);
lines.push(
  report.fallbacks.length === 0 ? "  owner clips: both used" : `  owner clips missing, fallback shown: ${report.fallbacks.map((f) => `beat ${f.beat} ${f.slot} → ${f.used}`).join("; ")}`,
);
for (const w of report.warnings) lines.push(`  warning: ${w}`);
lines.push(`  report: ${join(out, "report.json")}`);
process.stdout.write(`${lines.join("\n")}\n`);
