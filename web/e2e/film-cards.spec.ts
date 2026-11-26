import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { BEATS } from "../../film/lib/beats.mjs";
import { pickCaption, renderCaption } from "../../film/lib/captions.mjs";
import {
  captionHtml,
  captionTopInPage,
  ciCardHtml,
  contentBottomInPage,
  deploymentsCardHtml,
  endCardHtml,
  fitProblem,
  overlapProblem,
  titleCardHtml,
} from "../../film/lib/cards.mjs";
import { FORMATS } from "../../film/lib/formats.mjs";
import { ciFigures, deploymentRows, fileSources } from "../../film/lib/sources.mjs";
import { BRIEF_TOPIC, persuasionCardHtml, txCardHtml, txCardModel } from "../../film/lib/tx.mjs";

// The film's cards are stills that film/capture.mjs renders in Chromium, with a caption burned in near the bottom. This
// lays them out here with the longest content each can hold and fails when a caption would cover a row, or a card runs
// past the frame: the tx cards of beats 5 to 7 with real transactions (the vault's first mainnet Decision, and a Brief
// of the inbox's longest text), beat 7's persuasion card with the longest reply the journal keeps, the receipts cards,
// and the title and end cards with the mark. No network: the pages are local files, with the Geist fonts from
// node_modules.

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string) => readFileSync(`${ROOT}${rel}`, "utf8").replace(/\r\n/g, "\n");
const fontsDir = `${ROOT}web/node_modules/geist/dist/fonts`;
const fixture = JSON.parse(read("web/test/fixtures/film-tx-decision.json")) as {
  receipt: { transactionHash: string; to: string; logs: { address: string; topics: string[]; data: string; logIndex: string }[] };
  block: { number: string; timestamp: string };
};
const captions = (JSON.parse(read("film/captions.json")) as { captions: Record<string, unknown> }).captions;
const files = fileSources(ROOT);
const values: Record<string, string> = { ...files.values, "ledger.perTrade": "$50", "ledger.perDay": "$100", "ledger.weightCapPct": "40" };
const captionText = (id: string) => renderCaption(pickCaption(captions, id, values).text, values).text;

/** The inbox's limit on a brief, from MaatInbox.sol. */
const MAX_BYTES = Number(/uint256 public constant MAX_BYTES = (\d+);/.exec(read("contracts/src/MaatInbox.sol"))?.[1]);
/** The agent's limit on a reply it journals, from agent/src/briefs/caps.ts. */
const MAX_REPLY_CHARS = Number(/export const MAX_REPLY_CHARS = (\d+);/.exec(read("agent/src/briefs/caps.ts"))?.[1]);
const mark = read("web/brand/src/mark.svg").trim();
const word = (n: number) => n.toString(16).padStart(64, "0");
/** A Brief receipt from the fixture's block, with `text`: the longest a stranger can send wraps the most. */
function briefData(text: string) {
  const hex = Buffer.from(text, "utf8").toString("hex");
  const inbox = `0x${"cd".repeat(20)}`;
  const log = {
    address: inbox,
    topics: [BRIEF_TOPIC, `0x${word(1)}`, `0x${"0".repeat(24)}${"ab".repeat(20)}`],
    data: `0x${word(32)}${word(Buffer.byteLength(text))}${hex.padEnd(Math.ceil(hex.length / 64) * 64, "0")}`,
    logIndex: "0x0",
  };
  return { ...fixture, receipt: { ...fixture.receipt, to: inbox, logs: [log] } };
}
const ctx = { tokens: {}, contracts: { [fixture.receipt.to]: "MandateVault" } };
const decision = (key: string) => txCardModel(key, { label: `${key} (the vault's first mainnet Decision)`, hash: fixture.receipt.transactionHash }, fixture, ctx);
const sentence = "Buy NVDAc with 5 USDC while the market is open, keep the reserve, and skip the trade if the feed is stale. ";
const BRIEFS = {
  words: sentence.repeat(10).slice(0, MAX_BYTES).trimEnd(),
  unbroken: "x".repeat(MAX_BYTES),
};

const replyWords = "No. NYSE is closed, so the vault would refuse it with MARKET_CLOSED, and I will not propose it. ";
/** The replies a persuasion card can show: the longest the journal keeps, unbroken, and none yet. */
const REPLIES = {
  words: { kind: "reply", outcome: "replied", text: replyWords.repeat(5).slice(0, MAX_REPLY_CHARS).trimEnd(), adopted: true, file: "journal/2026-12-01.jsonl", line: 1234, hash: `0x${"ef".repeat(32)}`, commit: `${"0a".repeat(20)}-dirty` },
  unbroken: { kind: "reply", outcome: "replied", text: "y".repeat(MAX_REPLY_CHARS), adopted: false, file: "journal/2026-12-01.jsonl", line: 1, hash: `0x${"ef".repeat(32)}` },
  missing: { kind: "missing", why: "the published journal has no row for brief #1 yet" },
};

/** The lowest edge of a card's content, and the top of each caption the shot can show, in CSS px. */
async function measure(page: Page, dir: string, name: string, html: string, captionIds: string[], format: string) {
  mkdirSync(dir, { recursive: true });
  const card = `${dir}/${name}.html`;
  writeFileSync(card, html);
  await page.goto(pathToFileURL(card).href);
  await page.evaluate(() => document.fonts.ready);
  const bottom = await page.evaluate(contentBottomInPage);
  const fit = fitProblem(name, bottom, FORMATS[format as keyof typeof FORMATS].viewport.height);
  const problems: string[] = fit ? [fit] : [];
  for (const id of captionIds) {
    const file = `${dir}/${name}-${id}.html`;
    writeFileSync(file, captionHtml({ format, text: captionText(id), fontsDir }));
    await page.goto(pathToFileURL(file).href);
    await page.evaluate(() => document.fonts.ready);
    const problem = overlapProblem(`${name} under ${id}`, bottom, await page.evaluate(captionTopInPage));
    if (problem) problems.push(problem);
  }
  return problems;
}

for (const format of ["wide", "tall"] as const) {
  test.describe(`the film's ${FORMATS[format].label} cards`, () => {
    test.use({ viewport: FORMATS[format].viewport, deviceScaleFactor: FORMATS[format].dpr });

    test("keep every row of beats 5 to 7's tx cards above each caption the shot can show", async ({ page }, info) => {
      expect(MAX_BYTES).toBeGreaterThan(0);
      const dir = info.outputPath();
      const problems: string[] = [];
      for (const [kind, text] of Object.entries(BRIEFS)) {
        expect(Buffer.byteLength(text)).toBeLessThanOrEqual(MAX_BYTES);
        for (const beat of BEATS) {
          for (const shot of beat.shots.filter((s) => s.kind === "tx")) {
            const models = shot.txs.map((key: string) => (key === "strangerBrief" ? txCardModel(key, { label: "An outside wallet's brief", hash: fixture.receipt.transactionHash }, briefData(text), ctx) : decision(key)));
            expect(models.every((m: { kind: string }) => m.kind === "tx")).toBe(true);
            const ids = [shot.caption, shot.placeholderCaption, shot.partialCaption].filter(Boolean);
            problems.push(...(await measure(page, dir, `${beat.id}-${kind}`, txCardHtml(models, { format, title: beat.title, fontsDir }), ids, format)));
            if (shot.layout !== "persuasion") continue;
            for (const [replyKind, reply] of Object.entries(REPLIES)) {
              const html = persuasionCardHtml(models, { format, title: beat.title, fontsDir, reply });
              problems.push(...(await measure(page, dir, `${beat.id}-${kind}-${replyKind}`, html, [shot.caption], format)));
            }
          }
        }
      }
      expect(problems).toEqual([]);
    });

    test("fit the title and end cards in the frame, each with the mark drawn", async ({ page }, info) => {
      const dir = info.outputPath();
      const problems: string[] = [];
      for (const [name, html] of [
        ["title", titleCardHtml({ format, fontsDir, mark })],
        ["end", endCardHtml({ format, fontsDir, mark })],
      ] as const) {
        problems.push(...(await measure(page, dir, name, html, [], format)));
        const box = await page.locator(".lockup svg").boundingBox();
        expect(box?.width, name).toBeGreaterThanOrEqual(format === "wide" ? 60 : 30);
        expect(box?.y, name).toBeGreaterThanOrEqual(0);
      }
      expect(problems).toEqual([]);
    });

    test("keep the receipts cards above their captions, with one more contract than the table holds", async ({ page }, info) => {
      const dir = info.outputPath();
      const rows = deploymentRows(read("deployments/README.md")).filter((r) => r.network === "Base mainnet" && r.address);
      const more = [...rows, { ...rows[rows.length - 1]!, contract: "MaatInbox" }];
      const note = /On \d{4}-\d{2}-\d{2}, Basescan showed the source of all [^.]*\./.exec(read("deployments/README.md"))?.[0] ?? "";
      const problems = [
        ...(await measure(page, dir, "contracts", deploymentsCardHtml({ format, rows: more, verifiedNote: note, fontsDir }), ["receipts-contracts", "receipts-contracts-listed"], format)),
        ...(await measure(page, dir, "ci", ciCardHtml({ format, figures: ciFigures(read("README.md")), fontsDir }), ["receipts-ci"], format)),
      ];
      expect(problems).toEqual([]);
    });
  });
}
