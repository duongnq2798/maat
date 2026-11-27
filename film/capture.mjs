#!/usr/bin/env node
// Captures every shot of the film from the live site with Playwright, for each format, and writes a manifest that
// film/assemble.mjs turns into video with ffmpeg. Read-only: it opens public pages and reads receipts over public RPC.
// Run it on a PC, never in CI. Usage: node film/capture.mjs --work <dir> [--input <dir>] [--formats wide,tall] [--site <url>]

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { BEATS, CLIPS, FPS, forFormat, keepClearProblem, scrollFrames, scrollGoal, shotCues, timeline, txState, unsliceGoal } from "./lib/beats.mjs";
import {
  CAPTION_BAND,
  CARD_READING,
  captionHtml,
  captionTopInPage,
  ciCardHtml,
  contentBottomInPage,
  deploymentsCardHtml,
  endCardHtml,
  fitProblem,
  overlapProblem,
  paceProblem,
  titleCardHtml,
} from "./lib/cards.mjs";
import { captionProblems, pickCaption, renderCaption } from "./lib/captions.mjs";
import { frameListText } from "./lib/ffmpeg.mjs";
import { FORMATS } from "./lib/formats.mjs";
import { FRAME_CSS, textLinesInPage } from "./lib/frame.mjs";
import { briefReply, readJournal } from "./lib/journal.mjs";
import { fetchInput, fetchOwner, fetchTx } from "./lib/rpc.mjs";
import {
  ASK_NOT_OPEN_SELECTOR,
  CAPTURED,
  OPTIONAL_KEYS,
  askOpenValue,
  capturedValue,
  ciAgeWarning,
  ciFigures,
  deploymentRows,
  deploymentVerification,
  fileSources,
  verifiedNote,
} from "./lib/sources.mjs";
import {
  persuasionCardHtml,
  persuasionParts,
  persuasionProblems,
  persuasionReading,
  readTxConfig,
  tokenSymbols,
  txCardHtml,
  txCardModel,
  txProblems,
} from "./lib/tx.mjs";

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

/** Renders a still and screenshots it; `measure`, a function run in the page, returns what it measures there. */
async function renderStill(page, dir, name, html, { transparent = false, measure } = {}) {
  const file = join(dir, `${name}.html`);
  writeFileSync(file, html);
  await page.goto(pathToFileURL(file).href);
  await page.evaluate(() => document.fonts.ready);
  const measured = measure ? await page.evaluate(measure) : undefined;
  const png = join(dir, `${name}.png`);
  await page.screenshot({ path: png, type: "png", omitBackground: transparent });
  return { png, measured };
}

/** Whether the page is already on the site's `path` (a shot with continue: true then does not load it again). */
function onPath(page, site, path) {
  try {
    const here = new URL(page.url());
    return here.origin === new URL(site).origin && here.pathname.replace(/\/$/, "") === path.replace(/\/$/, "");
  } catch {
    return false;
  }
}

/** Runs a page shot's steps and screenshots each frame; returns the frame list file and what it read. */
async function capturePage(page, { site, shot, format, dir, captured, probed, warnings }) {
  mkdirSync(dir, { recursive: true });
  const frames = [];
  let used = 0;
  const where = `[${format}] ${shot.path} (${shot.id})`;
  const snap = async (duration) => {
    const file = `f${String(frames.length).padStart(5, "0")}.jpg`;
    await page.screenshot({ path: join(dir, file), type: "jpeg", quality: 92, caret: "hide" });
    frames.push({ file, duration });
    used += duration;
  };
  // A continued shot goes on from where the shot before it left this page: no reload, so no flash of the page's top.
  if (!(shot.continue && onPath(page, site, shot.path))) {
    await page.goto(`${site}${shot.path}`, { waitUntil: "networkidle", timeout: 90_000 });
    await page.addStyleTag({ content: FRAME_CSS });
  }
  // The caption may take the band at the bottom of the frame: an element the shot keeps clear must end above it.
  const checkClear = async () => {
    if (!shot.keepClear) return;
    const box = await page.locator(shot.keepClear).first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    });
    const height = page.viewportSize().height;
    const problem = keepClearProblem(`${where} ${shot.keepClear}`, box, height - CAPTION_BAND[format], height);
    if (problem) warnings.push(problem);
  };
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
    } else if (step.probe === "ask.open") {
      // The invitation caption follows what /ask shows, not the deployments table: open only while the page takes briefs.
      const notOpenShown = (await page.locator(ASK_NOT_OPEN_SELECTOR).count()) > 0;
      const flag = await page.evaluate(async () => {
        try {
          const res = await fetch("/data/ask.json", { cache: "no-store" });
          return res.ok ? (await res.json()).open : null;
        } catch {
          return null;
        }
      });
      const read = askOpenValue({ notOpenShown, flag });
      if (read.warning) warnings.push(`[${format}] ${read.warning}`);
      (probed[step.probe] ??= []).push(read.value);
    } else if (step.hold) await snap(step.hold);
    else if (step.scroll) {
      // A scroll given for one format only does not run in the other.
      const selector = forFormat(step.scroll, format);
      if (!selector) continue;
      const target = page.locator(selector).first();
      await target.waitFor({ state: "attached", timeout: 90_000 });
      const at = await target.evaluate((el) => {
        const footer = [...document.querySelectorAll("footer")].at(-1);
        return {
          from: window.scrollY,
          target: el.getBoundingClientRect().top + window.scrollY,
          max: document.documentElement.scrollHeight - window.innerHeight,
          footer: footer ? footer.getBoundingClientRect().top + window.scrollY : null,
          height: window.innerHeight,
        };
      });
      const { from } = at;
      const goal = scrollGoal({ ...at, offset: forFormat(step.top, format) ?? 0 });
      // No line of text cut in two at the top of the frame, or under the nav bar that stays there.
      const { lines, edge } = await page.evaluate(textLinesInPage);
      const limit = Math.max(0, Math.min(at.max, at.footer === null ? Number.POSITIVE_INFINITY : at.footer - at.height));
      const to = unsliceGoal({ y: goal, lines, edge, limit });
      // over: 0 jumps there without a frame, before the shot's first one.
      const n = scrollFrames(step.over);
      if (n === 0) await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), to);
      for (let i = 1; i <= n; i++) {
        await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), Math.round(from + (to - from) * ease(i / n)));
        await snap(1 / FPS);
      }
      await checkClear();
    }
  }
  if (!shot.steps.some((s) => s.scroll)) await checkClear();
  // The caption sits near the bottom of the frame: the site's footer, with its display line, must not be behind it.
  const footerTop = await page.evaluate(() => [...document.querySelectorAll("footer")].at(-1)?.getBoundingClientRect().top ?? null);
  if (footerTop !== null && footerTop < page.viewportSize().height) warnings.push(`[${format}] ${shot.path}: the shot ends with the site's footer in the frame, behind its caption`);
  const rest = shot.duration - used;
  if (rest > 1e-6) await snap(rest);
  const list = join(dir, "frames.txt");
  writeFileSync(list, frameListText(frames));
  return list;
}

export async function capture({ work, input, formats, site, final = false }) {
  const files = fileSources(ROOT);
  const deployMd = read("deployments/README.md");
  const deployments = deploymentRows(deployMd).filter((r) => r.network === "Base mainnet" && r.address);
  const warnings = [];
  // The receipts caption says the contracts are verified only while deployments/README.md gives a day for every row,
  // from the note under its table or the contract's own paragraph; otherwise it claims less, and the render warns.
  const verifiedLine = verifiedNote(deployMd);
  if (verifiedLine === "") {
    const unverified = deploymentVerification(deployMd).filter((v) => v.verifiedOn === "").map((v) => v.contract);
    warnings.push(`beat 8 does not say the contracts are verified: deployments/README.md gives no day Basescan showed ${unverified.join(", ") || "any row"} verified`);
  }
  const ci = ciFigures(read("README.md"));
  const ciAge = ciAgeWarning(files.values, new Date().toISOString().slice(0, 10));
  if (ciAge) warnings.push(ciAge);
  const fontsDir = join(ROOT, "web/node_modules/geist/dist/fonts");
  // The title and end cards draw the mark itself, so the film's first and last frames show it.
  const mark = read("web/brand/src/mark.svg");

  // The txs of beats 5 to 7: read each set hash's receipt, and stop on one that does not show what txs.json expects,
  // sender included: a probe is never shown as Claude's intent, and a team wallet's brief never as an outside one. Who
  // sent it is read from the tx's calldata, the vault's owner() and the /proof team list (lib/tx.mjs txSender).
  const config = readTxConfig(ROOT);
  const ctx = {
    tokens: tokenSymbols(JSON.parse(read("web/content/generated/base-addresses.json"))),
    contracts: Object.fromEntries(deployments.map((r) => [r.address.toLowerCase(), r.contract])),
  };
  const vault = deployments.find((r) => r.contract === "MandateVault")?.address;
  const { PROOF_TEAM } = await import(pathToFileURL(join(ROOT, "web/content/proof-team.ts")).href);
  const team = PROOF_TEAM.map((/** @type {{ address: string }} */ w) => w.address.toLowerCase());
  let owner;
  const txModels = {};
  for (const [key, entry] of Object.entries(config.txs)) {
    const data = entry.hash ? await fetchTx(entry.hash) : undefined;
    const model = txCardModel(key, entry, data, ctx);
    let who;
    if (model.kind === "tx") {
      if (!vault) throw new Error("deployments/README.md has no Base mainnet MandateVault row, so the film cannot read the vault's owner()");
      owner ??= await fetchOwner(vault);
      who = { owner, team, ...(entry.expect.event === "Decision" ? { input: await fetchInput(model.hash) } : {}) };
    }
    const problems = txProblems(model, entry.expect, ctx.contracts, who);
    if (problems.length > 0) throw new Error(`film/txs.json: ${problems.join("; ")}`);
    txModels[key] = model;
  }
  // A final cut shows no placeholder: --final stops the render while any tx of beats 5 to 7 has no hash.
  if (final) {
    const missing = Object.values(txModels).filter((m) => m.kind === "placeholder").map((m) => m.key);
    if (missing.length > 0) throw new Error(`--final: film/txs.json has no hash yet for ${missing.join(", ")}, so the cut would show a PLACEHOLDER card`);
  }

  // A persuasion shot whose txs are all on Base shows Maat's agent's reply between the brief and the verdict, read from
  // the published journal; the journal is read only then. A journal it cannot read, or one that does not verify, stops
  // the render; no row for the brief yet shows a labelled line on the card, and a warning here. The render also stops
  // unless the verdict is the vault's Decision on the intent that adopted the brief, sent by the vault's executor and
  // not its owner, after the brief, and the brief comes from no team wallet (lib/tx.mjs persuasionProblems): it reads
  // the Decision's calldata, the vault's owner() and the /proof team list for that.
  const replies = {};
  const answers = {};
  for (const [b, beat] of BEATS.entries()) {
    for (const shot of beat.shots.filter((x) => x.kind === "tx" && x.layout === "persuasion")) {
      const models = shot.txs.map((k) => txModels[k]);
      if (txState(models) !== "all") continue;
      const { brief, verdict } = persuasionParts(models);
      const answer = { input: await fetchInput(verdict.model.hash), owner: await fetchOwner(verdict.event.address), team };
      const reply = briefReply(await readJournal(), { id: brief.event.id, txHash: brief.model.hash, logIndex: brief.event.logIndex });
      const problems = persuasionProblems(models, { ...answer, reply });
      if (problems.length > 0) throw new Error(`film/txs.json, beat ${b + 1}: ${problems.join("; ")}`);
      if (reply.kind === "missing") warnings.push(`beat ${b + 1} shows no reply from Maat's agent: ${reply.why}. Render again once the journal publisher has pushed it`);
      replies[`${beat.id}/${shot.id}`] = reply;
      answers[`${beat.id}/${shot.id}`] = answer;
    }
  }

  const clips = findClips(input);
  const { shots, total } = timeline(BEATS, new Set(Object.keys(clips)));
  const captured = {};
  /** What each probe step read, one value per format (lib/sources.mjs askOpenValue). */
  const probed = {};
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
      // The site's page keeps its place between shots (continue: true); the cards are rendered in a page of their own.
      const page = await context.newPage();
      const stillPage = await context.newPage();
      const entries = [];
      for (const [i, s] of shots.entries()) {
        const name = `${String(i + 1).padStart(2, "0")}-${s.beat}-${s.slot}`;
        const shot = s.shot;
        const entry = { index: i + 1, beat: s.beat, beatIndex: s.beatIndex, slot: s.slot, kind: shot.kind, duration: s.duration };
        process.stdout.write(`[${format}] ${name} (${shot.kind}, ${s.duration} s)\n`);
        if (shot.kind === "page") entry.input = { kind: "frames", list: await capturePage(page, { site, shot, format, dir: join(dir, name), captured, probed, warnings }) };
        else if (shot.kind === "card") {
          const html =
            shot.card === "title"
              ? titleCardHtml({ format, fontsDir, mark })
              : shot.card === "deployments"
                ? deploymentsCardHtml({ format, rows: deployments, fontsDir })
                : shot.card === "ci"
                  ? ciCardHtml({ format, figures: ci, fontsDir })
                  : endCardHtml({ format, fontsDir, mark });
          const still = await renderStill(stillPage, join(dir, "stills"), name, html, { measure: contentBottomInPage });
          entry.input = { kind: "image", file: still.png };
          entry.contentBottom = still.measured;
          // The title and end cards' words must be readable in the card's time.
          if (format === formats[0] && CARD_READING[shot.card]) {
            const pace = paceProblem(`beat ${s.beatIndex} (${s.beat}/${s.slot}) card`, CARD_READING[shot.card].join(" ").length, s.duration);
            if (pace) warnings.push(pace);
          }
        } else if (shot.kind === "tx") {
          const models = shot.txs.map((k) => txModels[k]);
          const beat = BEATS.find((b) => b.id === s.beat);
          const html =
            shot.layout === "persuasion"
              ? persuasionCardHtml(models, { format, title: beat.title, fontsDir, reply: replies[`${s.beat}/${shot.id}`], answer: answers[`${s.beat}/${shot.id}`] })
              : txCardHtml(models, { format, title: beat.title, fontsDir });
          const still = await renderStill(stillPage, join(dir, "stills"), name, html, { measure: contentBottomInPage });
          entry.input = { kind: "image", file: still.png };
          entry.contentBottom = still.measured;
          entry.txState = txState(models);
          // What a viewer reads on beat 7's real card besides its caption, for the pace check below.
          if (shot.layout === "persuasion" && entry.txState === "all") entry.reading = persuasionReading(models, replies[`${s.beat}/${shot.id}`]);
          if (format === formats[0] && entry.txState !== "all") {
            const missing = models.filter((m) => m.kind === "placeholder").map((m) => m.key);
            manifest.placeholders.push({ beat: s.beatIndex, id: s.beat, missing });
            if (entry.txState === "some") warnings.push(`beat ${s.beatIndex} shows a placeholder for ${missing.join(", ")} beside a real tx`);
          }
        } else if (shot.kind === "clip") entry.input = { kind: "video", file: clips[shot.clip], trim: 0 };
        if (format === formats[0] && s.slot !== shot.id && shot.kind !== "clip") manifest.fallbacks.push({ beat: s.beatIndex, slot: s.slot, used: shot.id });
        entry.cueIds = shotCues(shot, entry.txState);
        entries.push(entry);
      }
      manifest.formats[format] = { shots: entries };
      await context.close();
    }

    // A probe counts only when every format read the same: /ask is open only if both cuts filmed it open.
    for (const [key, reads] of Object.entries(probed)) {
      if (reads.every((v) => v !== undefined) && new Set(reads).size === 1) captured[key] = reads[0];
      else if (reads.some((v) => v !== undefined)) warnings.push(`${key} read ${reads.map(String).join(" and ")} in the two cuts; the captions take it as absent`);
    }

    // Captions: every number comes from a file or from what the capture just read; an unsourced one stops the render.
    const captionsFile = JSON.parse(read("film/captions.json")).captions;
    const values = { ...files.values, ...captured };
    const known = new Set([...Object.keys(files.values), ...Object.keys(CAPTURED), ...Object.keys(OPTIONAL_KEYS)]);
    const problems = Object.entries(captionsFile).flatMap(([id, entry]) => captionProblems(id, entry, known));
    if (problems.length > 0) throw new Error(`film/captions.json:\n${problems.join("\n")}`);
    const overlaps = [];
    if (captured["ledger.weightCapPct"] !== undefined && captured["ledger.weightCapPct"] !== files.values["reserve.capPct"]) {
      warnings.push(
        `beat 3 shows the timelock line, not the reserve line: the vault's cap reads ${captured["ledger.weightCapPct"]}%, QueueReserveCaps.s.sol's is ${files.values["reserve.capPct"]}%. Render again once the caps are applied.`,
      );
    } else if (formats.includes("tall") && captured["ledger.weightCapPct"] !== undefined) {
      warnings.push("beat 3 shows the reserve line, but the 9:16 cut ends the mandate shot on the timelock panel: point its last scroll at the maxWeightBps row in lib/beats.mjs");
    }
    for (const format of formats) {
      const f = FORMATS[format];
      const dir = join(work, format, "captions");
      mkdirSync(dir, { recursive: true });
      const context = await browser.newContext({ viewport: f.viewport, deviceScaleFactor: f.dpr });
      const page = await context.newPage();
      const stills = {};
      for (const entry of manifest.formats[format].shots) {
        // Every card, captioned or not, must fit in the frame.
        if (entry.contentBottom !== undefined) {
          const fit = fitProblem(`[${format}] shot ${entry.index} (${entry.beat}/${entry.slot})`, entry.contentBottom, f.viewport.height);
          if (fit) overlaps.push(fit);
        }
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
          stills[picked.id] ??= await renderStill(page, dir, picked.id, captionHtml({ format, text: out.text, fontsDir }), { transparent: true, measure: captionTopInPage });
          // A card's rows must stay clear of every caption burned in over it.
          if (entry.contentBottom !== undefined) {
            const overlap = overlapProblem(`[${format}] shot ${entry.index} (${entry.beat}/${entry.slot}) under caption ${picked.id}`, entry.contentBottom, stills[picked.id].measured);
            if (overlap) overlaps.push(overlap);
          }
          entry.cues.push({ id: picked.id, text: out.text, png: stills[picked.id].png, from: cue.at, to: cue.to });
          // Each caption with the numbers read, and beat 7's card under its caption, must be readable in its time.
          if (format === formats[0]) {
            const chars = [...(entry.reading ?? []), out.text].join(" ").length;
            const pace = paceProblem(`beat ${entry.beatIndex} (${entry.beat}/${entry.slot}) under caption ${picked.id}`, chars, cue.to - cue.at);
            if (pace) warnings.push(pace);
          }
        }
      }
      await context.close();
    }
    if (overlaps.length > 0) throw new Error(`a card runs off the frame, or a caption would cover its rows:\n${overlaps.join("\n")}`);
  } finally {
    await browser.close();
  }
  writeFileSync(join(work, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { work: { type: "string" }, input: { type: "string" }, formats: { type: "string" }, site: { type: "string" }, final: { type: "boolean" } },
  });
  const work = resolve(values.work ?? join(ROOT, "film/out/work"));
  const manifest = await capture({
    work,
    input: resolve(values.input ?? join(ROOT, "film/input")),
    formats: (values.formats ?? "wide,tall").split(","),
    site: (values.site ?? "https://maatonbase.xyz").replace(/\/$/, ""),
    final: values.final === true,
  });
  process.stdout.write(`manifest: ${join(work, "manifest.json")} (${manifest.total} s)\n`);
}
