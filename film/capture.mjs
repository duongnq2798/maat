#!/usr/bin/env node
// Captures every shot of the film from the live site with Playwright, for each format, and writes a manifest that
// film/assemble.mjs turns into video with ffmpeg. Read-only: it opens public pages and reads receipts over public RPC.
// Run it on a PC, never in CI. Usage: node film/capture.mjs --work <dir> [--input <dir>] [--formats wide,tall] [--site <url>]

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { BEATS, CLIPS, FPS, shotCues, timeline } from "./lib/beats.mjs";
import { captionHtml, ciCardHtml, deploymentsCardHtml, endCardHtml, titleCardHtml } from "./lib/cards.mjs";
import { captionProblems, pickCaption, renderCaption } from "./lib/captions.mjs";
import { frameListText } from "./lib/ffmpeg.mjs";
import { FORMATS } from "./lib/formats.mjs";
import { fetchTx } from "./lib/rpc.mjs";
import { CAPTURED, capturedValue, ciFigures, deploymentRows, fileSources } from "./lib/sources.mjs";
import { readTxConfig, tokenSymbols, txCardHtml, txCardModel, txProblems } from "./lib/tx.mjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CLIP_EXTENSIONS = [".mp4", ".mov", ".webm", ".mkv"];
const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

/** The owner clips in the input folder: base name → file. */
export function findClips(inputDir) {
  const found = {};
  if (!existsSync(inputDir)) return found;
  for (const name of readdirSync(inputDir)) {
    const dot = name.lastIndexOf(".");
    const base = name.slice(0, dot);
    if (Object.values(CLIPS).includes(base) && CLIP_EXTENSIONS.includes(name.slice(dot).toLowerCase())) found[base] = join(inputDir, name);
  }
  return found;
}

/** Playwright, from the web app's installed packages (film/ has no dependencies of its own). */
function playwright() {
  const require = createRequire(join(ROOT, "web/package.json"));
  try {
    return require("@playwright/test");
  } catch {
    throw new Error("Playwright is not installed: run npm ci in web/, then npx playwright install chromium");
  }
}

async function renderStill(page, dir, name, html, { transparent = false } = {}) {
  const file = join(dir, `${name}.html`);
  writeFileSync(file, html);
  await page.goto(pathToFileURL(file).href);
  await page.evaluate(() => document.fonts.ready);
  const png = join(dir, `${name}.png`);
  await page.screenshot({ path: png, type: "png", omitBackground: transparent });
  return png;
}

/** Runs a page shot's steps and screenshots each frame; returns the frame list file and what it read. */
async function capturePage(page, { site, shot, format, dir, captured, warnings }) {
  mkdirSync(dir, { recursive: true });
  const frames = [];
  let used = 0;
  const snap = async (duration) => {
    const file = `f${String(frames.length).padStart(5, "0")}.jpg`;
    await page.screenshot({ path: join(dir, file), type: "jpeg", quality: 92, caret: "hide" });
    frames.push({ file, duration });
    used += duration;
  };
  await page.goto(`${site}${shot.path}`, { waitUntil: "networkidle", timeout: 90_000 });
  for (const step of shot.steps) {
    if (step.wait) await page.locator(step.wait).first().waitFor({ state: "attached", timeout: 90_000 });
    else if (step.capture) {
      const spec = CAPTURED[step.capture];
      const cell = page.locator(spec.selector).first();
      await cell.waitFor({ state: "attached", timeout: 90_000 });
      const value = capturedValue(step.capture, await cell.innerText());
      if (captured[step.capture] === undefined) captured[step.capture] = value;
      else if (captured[step.capture] !== value) warnings.push(`${step.capture} read ${captured[step.capture]} in one format and ${value} in another`);
    } else if (step.click) {
      await page.locator(step.click.within).getByRole("button", { name: step.click.button, exact: true }).click();
      await page.waitForTimeout((step.settle ?? 1) * 1000);
    } else if (step.hold) await snap(step.hold);
    else if (step.scroll) {
      const target = page.locator(step.scroll).first();
      await target.waitFor({ state: "attached", timeout: 90_000 });
      const top = step.top?.[format] ?? 0;
      const { from, to } = await target.evaluate((el, offset) => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const y = el.getBoundingClientRect().top + window.scrollY - offset;
        return { from: window.scrollY, to: Math.max(0, Math.min(max, Math.round(y))) };
      }, top);
      const n = Math.max(1, Math.round(step.over * FPS));
      for (let i = 1; i <= n; i++) {
        await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), Math.round(from + (to - from) * ease(i / n)));
        await snap(1 / FPS);
      }
    }
  }
  const rest = shot.duration - used;
  if (rest > 1e-6) await snap(rest);
  const list = join(dir, "frames.txt");
  writeFileSync(list, frameListText(frames));
  return list;
}

export async function capture({ work, input, formats, site }) {
  const files = fileSources(ROOT);
  const deployMd = read("deployments/README.md");
  const deployments = deploymentRows(deployMd).filter((r) => r.network === "Base mainnet" && r.address);
  const verifiedNote = /On \d{4}-\d{2}-\d{2}, Basescan showed the source of all [^.]*\./.exec(deployMd)?.[0] ?? "";
  const ci = ciFigures(read("README.md"));
  const fontsDir = join(ROOT, "web/node_modules/geist/dist/fonts");
  const warnings = [];

  // The txs of beats 5 to 7: read each set hash's receipt, and stop on one that does not show what txs.json expects.
  const config = readTxConfig(ROOT);
  const ctx = {
    tokens: tokenSymbols(JSON.parse(read("web/content/generated/base-addresses.json"))),
    contracts: Object.fromEntries(deployments.map((r) => [r.address.toLowerCase(), r.contract])),
  };
  const txModels = {};
  for (const [key, entry] of Object.entries(config.txs)) {
    const data = entry.hash ? await fetchTx(entry.hash) : undefined;
    const model = txCardModel(key, entry, data, ctx);
    const problems = txProblems(model, entry.expect);
    if (problems.length > 0) throw new Error(`film/txs.json: ${problems.join("; ")}`);
    txModels[key] = model;
  }

  const clips = findClips(input);
  const { shots, total } = timeline(BEATS, new Set(Object.keys(clips)));
  const captured = {};
  const { chromium } = playwright();
  const browser = await chromium.launch();
  const manifest = { site, total, fps: FPS, clips, captured, formats: {}, placeholders: [], fallbacks: [], warnings };
  try {
    for (const format of formats) {
      const f = FORMATS[format];
      const dir = join(work, format);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(join(dir, "stills"), { recursive: true });
      const context = await browser.newContext({ viewport: f.viewport, deviceScaleFactor: f.dpr, colorScheme: "light", locale: "en-US", timezoneId: "America/New_York" });
      const page = await context.newPage();
      const entries = [];
      for (const [i, s] of shots.entries()) {
        const name = `${String(i + 1).padStart(2, "0")}-${s.beat}-${s.slot}`;
        const shot = s.shot;
        const entry = { index: i + 1, beat: s.beat, beatIndex: s.beatIndex, slot: s.slot, kind: shot.kind, duration: s.duration };
        process.stdout.write(`[${format}] ${name} (${shot.kind}, ${s.duration} s)\n`);
        if (shot.kind === "page") entry.input = { kind: "frames", list: await capturePage(page, { site, shot, format, dir: join(dir, name), captured, warnings }) };
        else if (shot.kind === "card") {
          const html =
            shot.card === "title"
              ? titleCardHtml({ format, fontsDir })
              : shot.card === "deployments"
                ? deploymentsCardHtml({ format, rows: deployments, verifiedNote, fontsDir })
                : shot.card === "ci"
                  ? ciCardHtml({ format, figures: ci, fontsDir })
                  : endCardHtml({ format, fontsDir });
          entry.input = { kind: "image", file: await renderStill(page, join(dir, "stills"), name, html) };
        } else if (shot.kind === "tx") {
          const models = shot.txs.map((k) => txModels[k]);
          const beat = BEATS.find((b) => b.id === s.beat);
          entry.input = { kind: "image", file: await renderStill(page, join(dir, "stills"), name, txCardHtml(models, { format, title: beat.title, fontsDir })) };
          entry.txsComplete = models.every((m) => m.kind === "tx");
          if (format === formats[0] && !entry.txsComplete) {
            manifest.placeholders.push({ beat: s.beatIndex, id: s.beat, missing: models.filter((m) => m.kind === "placeholder").map((m) => m.key) });
          }
        } else if (shot.kind === "clip") entry.input = { kind: "video", file: clips[shot.clip], trim: 0 };
        if (format === formats[0] && s.slot !== shot.id && shot.kind !== "clip") manifest.fallbacks.push({ beat: s.beatIndex, slot: s.slot, used: shot.id });
        entry.cueIds = shotCues(shot, entry.txsComplete);
        entries.push(entry);
      }
      manifest.formats[format] = { shots: entries };
      await context.close();
    }

    // Captions: every number comes from a file or from what the capture just read; an unsourced one stops the render.
    const captionsFile = JSON.parse(read("film/captions.json")).captions;
    const values = { ...files.values, ...captured };
    const known = new Set([...Object.keys(files.values), ...Object.keys(CAPTURED)]);
    const problems = Object.entries(captionsFile).flatMap(([id, entry]) => captionProblems(id, entry, known));
    if (problems.length > 0) throw new Error(`film/captions.json:\n${problems.join("\n")}`);
    if (captured["ledger.weightCapPct"] !== undefined && captured["ledger.weightCapPct"] !== files.values["reserve.capPct"]) {
      warnings.push(
        `beat 3 shows the timelock line, not the reserve line: the vault's cap reads ${captured["ledger.weightCapPct"]}%, QueueReserveCaps.s.sol's is ${files.values["reserve.capPct"]}%. Render again once the caps are applied.`,
      );
    }
    for (const format of formats) {
      const f = FORMATS[format];
      const dir = join(work, format, "captions");
      mkdirSync(dir, { recursive: true });
      const context = await browser.newContext({ viewport: f.viewport, deviceScaleFactor: f.dpr });
      const page = await context.newPage();
      const pngs = {};
      for (const entry of manifest.formats[format].shots) {
        const cues = [];
        entry.cueIds.forEach((cue, i) => {
          const next = entry.cueIds[i + 1];
          cues.push({ ...cue, to: next ? next.at : entry.duration });
        });
        entry.cues = [];
        for (const cue of cues) {
          const picked = pickCaption(captionsFile, cue.id, values);
          const out = renderCaption(picked.text, values);
          if (out.missing.length > 0) throw new Error(`caption ${picked.id} needs ${out.missing.join(", ")}, which nothing read`);
          pngs[picked.id] ??= await renderStill(page, dir, picked.id, captionHtml({ format, text: out.text, fontsDir }), { transparent: true });
          entry.cues.push({ id: picked.id, text: out.text, png: pngs[picked.id], from: cue.at, to: cue.to });
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  writeFileSync(join(work, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { work: { type: "string" }, input: { type: "string" }, formats: { type: "string" }, site: { type: "string" } },
  });
  const work = resolve(values.work ?? join(ROOT, "film/out/work"));
  const manifest = await capture({
    work,
    input: resolve(values.input ?? join(ROOT, "film/input")),
    formats: (values.formats ?? "wide,tall").split(","),
    site: (values.site ?? "https://maatonbase.xyz").replace(/\/$/, ""),
  });
  process.stdout.write(`manifest: ${join(work, "manifest.json")} (${manifest.total} s)\n`);
}
