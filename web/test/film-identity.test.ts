// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JOURNAL_RAW_URL as SITE_JOURNAL_RAW_URL } from "@/lib/chain/ledger";
import { BEATS, TARGET_SECONDS, timeline, validateBeats } from "../../film/lib/beats.mjs";
import { pickCaption } from "../../film/lib/captions.mjs";
import { LINES, endCardHtml, esc, fitProblem, titleCardHtml } from "../../film/lib/cards.mjs";
import { finalArgs } from "../../film/lib/ffmpeg.mjs";
import { JOURNAL_RAW_URL, briefReply, readJournal } from "../../film/lib/journal.mjs";
import { BRIEF_TOPIC, persuasionCardHtml, txCardHtml, txCardModel } from "../../film/lib/tx.mjs";
import { GENESIS, canon, rowHash } from "../../ops/journal/lib/spec.mjs";
import { REPO_ROOT, readRepo } from "./helpers/solidity";

// Move 6 of the culture plan (.superpowers/ecosystem/11-culture-2026-11-26.md): the film carries Maat's identity. It
// opens and closes on the real mark, says the mechanism line word for word, ends on the sign-off, the short myth line
// and the builder line, and its persuasion beat shows a real brief, Maat's agent's reply from the published journal,
// then the vault's verdict, or a labelled placeholder until those transactions are on Base. No sound is added.

const lf = (rel: string) => readRepo(rel).replace(/\r\n/g, "\n");
const MARK = lf("web/brand/src/mark.svg").trim();
const captions = (JSON.parse(lf("film/captions.json")) as { captions: Record<string, string | { text: string; else: string }> }).captions;
const textOf = (id: string) => {
  const c = captions[id];
  return typeof c === "string" ? c : (c?.text ?? "");
};
/** The visible part of a card: its body, without the style sheet (whose font stacks name "sans-serif"). */
const bodyOf = (html: string) => html.slice(html.indexOf("<body>"));
/** Words and looks the culture plan's §5 and §7 rule out of every Maat asset. */
const BANNED = /\b(confetti|celebrat\w*|streaks?|points|rewards?|giveaways?|win|divine|papyrus|hieroglyphs?|gold|serif|spell 125)\b/i;

const fixture = JSON.parse(readFileSync(join(REPO_ROOT, "web/test/fixtures/film-tx-decision.json"), "utf8")) as {
  receipt: { transactionHash: string; to: string; logs: { address: string; topics: string[]; data: string; logIndex: string }[] };
  block: { number: string; timestamp: string };
};
const VAULT = fixture.receipt.to;
const INBOX = `0x${"cd".repeat(20)}`;
const BRIEF_TX = `0x${"12".repeat(32)}`;
const ctx = { tokens: {}, contracts: { [VAULT]: "MandateVault", [INBOX]: "MaatInbox" } };
const word = (n: number) => n.toString(16).padStart(64, "0");
const BRIEF_TEXT = "Buy 5 USD of NVDAc on Thanksgiving, the price looks great.";
/** A Brief receipt: brief #7 from 0xabab…abab with `text`, at log index 3 of BRIEF_TX. */
function briefData(text: string) {
  const hex = Buffer.from(text, "utf8").toString("hex");
  const log = {
    address: INBOX,
    topics: [BRIEF_TOPIC, `0x${word(7)}`, `0x${"0".repeat(24)}${"ab".repeat(20)}`],
    data: `0x${word(32)}${word(Buffer.byteLength(text))}${hex.padEnd(Math.ceil(hex.length / 64) * 64, "0")}`,
    logIndex: "0x3",
  };
  return { ...fixture, receipt: { ...fixture.receipt, transactionHash: BRIEF_TX, to: INBOX, logs: [log] } };
}
const briefModel = txCardModel("strangerBrief", { label: "An outside wallet's brief", hash: BRIEF_TX, expect: { event: "Brief" } }, briefData(BRIEF_TEXT), ctx);
const verdictModel = txCardModel(
  "vaultAnswer",
  { label: "The vault's verdict on Maat's agent's answer", hash: fixture.receipt.transactionHash, expect: { event: "Decision" } },
  fixture,
  ctx,
);
const placeholder = (key: string, label: string) => txCardModel(key, { label, hash: null, expect: { event: "Brief" } }, undefined, ctx);
const REPLY = "No. NYSE is closed on Thanksgiving, so the vault would refuse it with MARKET_CLOSED; I will not propose it.";

/** A published journal day file of `rows` (each without prev and hash), chained from GENESIS as the publisher writes it. */
function dayFile(rows: Record<string, unknown>[]): string {
  let prev = GENESIS;
  return rows
    .map((r) => {
      const withPrev = { ...r, prev };
      const hash = rowHash(withPrev);
      prev = hash;
      return `${canon({ ...withPrev, hash })}\n`;
    })
    .join("");
}
const common = { commit: "0123456789abcdef0123456789abcdef01234567", runId: "1795539542000-a1b2c3d4", ts: "2026-12-01T15:00:00.000Z" };
const briefRow = (over: Record<string, unknown> = {}) => ({
  ...common,
  kind: "brief",
  briefId: 7,
  from: `0x${"ab".repeat(20)}`,
  txHash: BRIEF_TX,
  logIndex: 3,
  block: "61900000",
  outcome: "replied",
  reply: REPLY,
  adopted: false,
  ...over,
});
const runRow = { ...common, kind: "run", block: "61899990", day: "20423", mode: "live", ok: true, costUsd6: "12000", suggestions: 0, proposals: 0 };
const BRIEF = { id: 7n, txHash: BRIEF_TX, logIndex: 3 };

describe("the film's title card", () => {
  it("draws the real mark of web/brand/src/mark.svg, not a plain square, in both cuts", () => {
    expect(MARK).toMatch(/^<svg [^>]*viewBox="0 0 30 30"/);
    for (const format of ["wide", "tall"]) {
      const html = titleCardHtml({ format, mark: MARK });
      expect(html).toContain(MARK);
      expect(html).not.toMatch(/\.mark i\{/);
      expect(bodyOf(html)).toContain(">maat<");
    }
  });

  it("refuses to draw a card without the mark", () => {
    expect(() => titleCardHtml({ format: "wide", mark: "" })).toThrow(/web\/brand\/src\/mark\.svg/);
    expect(() => endCardHtml({ format: "tall", mark: "<i></i>" })).toThrow(/web\/brand\/src\/mark\.svg/);
  });

  it("sets the positioning line and the mechanism line word for word, and no other motto", () => {
    expect(LINES.positioning).toBe("The AI agent that knows when not to trade.");
    expect(LINES.mechanism).toBe("Claude proposes. The vault decides.");
    const body = bodyOf(titleCardHtml({ format: "wide", mark: MARK }));
    expect(body).toContain(`>${LINES.positioning}<`);
    expect(body).toContain(`>${LINES.mechanism}<`);
    expect(body).not.toMatch(/proposes;|onchain vault decides/);
  });
});

describe("the film's end card", () => {
  it("ends on the mark, the sign-off, the short myth line and the builder line, with the footer", () => {
    expect(LINES.signOff).toBe("Every trade is weighed.");
    expect(LINES.mythShort).toBe("Named for Ma'at, whose feather every heart was weighed against. Here the feather is the mandate.");
    expect(LINES.builder).toBe("Built by one developer with Claude Code.");
    for (const format of ["wide", "tall"]) {
      const html = endCardHtml({ format, mark: MARK });
      expect(html).toContain(MARK);
      const body = bodyOf(html);
      for (const line of [LINES.signOff, LINES.mythShort, LINES.builder]) expect(body).toContain(`>${esc(line)}<`);
      expect(body).toContain("maatonbase.xyz");
      expect(body).toContain("Own treasury only. No investment advice. Not offered to US persons.");
    }
  });

  it("puts the sign-off before the myth line, and the myth line before the builder line", () => {
    const body = bodyOf(endCardHtml({ format: "wide", mark: MARK }));
    const at = (s: string) => body.indexOf(esc(s));
    expect(at(LINES.signOff)).toBeLessThan(at(LINES.mythShort));
    expect(at(LINES.mythShort)).toBeLessThan(at(LINES.builder));
  });
});

describe("the identity rules on both cards", () => {
  it("uses none of the words or looks the culture plan rules out, and only the site's Geist type", () => {
    for (const format of ["wide", "tall"]) {
      for (const html of [titleCardHtml({ format, mark: MARK }), endCardHtml({ format, mark: MARK })]) {
        expect(bodyOf(html).replace(/<[^>]+>/g, " ")).not.toMatch(BANNED);
        for (const [, stack] of html.matchAll(/font-family:([^;}]+)/g)) expect(stack).toMatch(/^"Geist( Mono)?"/);
        expect(html).not.toMatch(/<audio|<video/);
      }
    }
  });

  it("names a card whose content runs past the bottom of the frame", () => {
    expect(fitProblem("01-title", 1000, 1080)).toBeNull();
    expect(fitProblem("01-title", 1070.4, 1080)).toBe("01-title: the card's content ends at 1070 px, within 16 px of the frame's bottom edge at 1080 px");
  });
});

describe("the film's first and last shots", () => {
  it("opens on the title card and closes on the end card, so the first and last frames show the mark", () => {
    const { shots, total } = timeline(BEATS);
    expect(shots[0]?.shot).toMatchObject({ kind: "card", card: "title" });
    expect(shots.at(-1)?.shot).toMatchObject({ kind: "card", card: "end" });
    // The end card holds four lines to read; the cut keeps its 100 s budget.
    expect(shots.at(-1)?.duration).toBeGreaterThanOrEqual(5);
    expect(total).toBe(TARGET_SECONDS);
    expect(validateBeats(BEATS)).toEqual([]);
  });

  it("adds no sound: the cut's only audio is the silent track, and film/ holds no audio file", () => {
    const args = finalArgs({ list: "segments.txt", out: "x.mp4" });
    expect(args.filter((a: string) => a === "-i")).toHaveLength(2);
    expect(args[args.indexOf("lavfi") + 2]).toMatch(/^anullsrc=/);
    const walk = (dir: string): string[] =>
      readdirSync(join(REPO_ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
    expect(walk("film").filter((f) => /\.(wav|mp3|m4a|aac|ogg|flac|opus)$/i.test(f))).toEqual([]);
  });
});

describe("the film's captions", () => {
  it("say the mechanism line word for word wherever they say who proposes and who decides", () => {
    const sayIt = Object.keys(captions).filter((id) => /\bproposes\b|\bdecides\b/.test(textOf(id)));
    expect(sayIt).toContain("decides-how");
    for (const id of sayIt) expect(textOf(id), id).toContain(LINES.mechanism);
  });

  it("call the AI Maat's agent in the persuasion beat, and invite people to try to talk it into a bad trade", () => {
    expect(LINES.invitation).toBe("Try to talk Maat's agent into a bad trade. The vault has the last word.");
    const open = pickCaption(captions, "brief-ask", { "deployments.inbox": INBOX });
    expect(open).toEqual({ id: "brief-ask", text: LINES.invitation });
    const shot = BEATS.find((b) => b.id === "stranger-brief")?.shots.find((s) => s.kind === "tx");
    const ids = ["brief-ask", "brief-ask-soon", shot?.caption, shot?.placeholderCaption];
    for (const id of ids) {
      const text = textOf(String(id));
      expect(text, String(id)).toContain("Maat's agent");
      expect(text.replace(/Maat's agent/g, ""), String(id)).not.toMatch(/\bagent\b/);
    }
    expect(textOf("brief-ask-soon")).toMatch(/^Once the inbox contract is on Base, .*Maat's agent into a bad trade\. The vault has the last word\.$/);
    expect(textOf(String(shot?.placeholderCaption))).toMatch(/^Placeholder: /);
  });

  it("never call the AI Maat", () => {
    for (const id of Object.keys(captions)) expect(textOf(id), id).not.toMatch(/\bMaat (replied|proposes|proposed|reads|answers|says|thinks|decides)\b/);
  });
});

describe("the persuasion beat (beat 7)", () => {
  const shot = BEATS.find((b) => b.id === "stranger-brief")?.shots.find((s) => s.kind === "tx");
  const opts = { format: "wide", title: "A stranger's brief and the vault's answer" };

  it("shows the brief and the vault's Decision on Maat's agent's answer, laid out as a persuasion card", () => {
    expect(shot).toMatchObject({ kind: "tx", layout: "persuasion", txs: ["strangerBrief", "vaultAnswer"] });
    const txs = (JSON.parse(lf("film/txs.json")) as { txs: Record<string, { label: string }> }).txs;
    expect(txs.vaultAnswer?.label).toBe("The vault's verdict on Maat's agent's answer");
  });

  it("shows the real brief, then Maat's agent's reply from the journal, then the vault's verdict", () => {
    const reply = briefReply({ state: "read", files: [{ name: "2026-12-01.jsonl", text: dayFile([runRow, briefRow()]) }] }, BRIEF);
    expect(reply.kind).toBe("reply");
    const body = bodyOf(persuasionCardHtml([briefModel, verdictModel], { ...opts, reply }));
    const at = (s: string) => body.indexOf(s);
    expect(at(esc(BRIEF_TEXT))).toBeGreaterThan(0);
    expect(at("Maat&#39;s agent replied")).toBeGreaterThan(at(esc(BRIEF_TEXT)));
    expect(at(esc(REPLY))).toBeGreaterThan(at("Maat&#39;s agent replied"));
    expect(at("Refused · Market closed (MARKET_CLOSED)")).toBeGreaterThan(at(esc(REPLY)));
    expect(body).toContain("#7 from 0xabab…abab");
    expect(body).toContain("Claude persuaded: no");
    expect(body).toContain("journal/2026-12-01.jsonl line 2");
    expect(body).toContain("commit 0123456");
    expect(body).toContain(`basescan.org/tx/${fixture.receipt.transactionHash}`);
    expect(body).not.toContain("PLACEHOLDER");
  });

  it("says so, labelled, when the journal has no reply for the brief yet", () => {
    for (const journal of [{ state: "absent" as const }, { state: "read" as const, files: [{ name: "2026-12-01.jsonl", text: dayFile([runRow]) }] }]) {
      const reply = briefReply(journal, BRIEF);
      expect(reply.kind).toBe("missing");
      const body = bodyOf(persuasionCardHtml([briefModel, verdictModel], { ...opts, reply }));
      expect(body).toContain("NOT IN THE JOURNAL YET");
      expect(body).not.toContain("Maat&#39;s agent replied");
      expect(body).toContain("Refused · Market closed (MARKET_CLOSED)");
    }
  });

  it("says what the agent journaled when Claude gave no reply, or a cap kept the brief from Claude", () => {
    const unanswered = briefReply({ state: "read", files: [{ name: "2026-12-01.jsonl", text: dayFile([briefRow({ outcome: "unanswered", reply: undefined })]) }] }, BRIEF);
    expect(bodyOf(persuasionCardHtml([briefModel, verdictModel], { ...opts, reply: unanswered }))).toContain("Sent to Claude, which gave no reply.");
    const skipped = briefReply(
      { state: "read", files: [{ name: "2026-12-01.jsonl", text: dayFile([briefRow({ outcome: "skipped", reply: undefined, adopted: undefined, cap: "briefs-per-day" })]) }] },
      BRIEF,
    );
    expect(bodyOf(persuasionCardHtml([briefModel, verdictModel], { ...opts, reply: skipped }))).toContain("Not sent to Claude");
  });

  it("keeps the labelled placeholder card until both transactions are on Base", () => {
    const missingBrief = placeholder("strangerBrief", "An outside wallet's brief");
    const missingVerdict = placeholder("vaultAnswer", "The vault's verdict on Maat's agent's answer");
    for (const models of [
      [missingBrief, missingVerdict],
      [briefModel, missingVerdict],
    ]) {
      const html = persuasionCardHtml(models, { ...opts, reply: undefined });
      expect(html).toBe(txCardHtml(models, opts));
      expect(html).toContain("PLACEHOLDER");
      expect(html).not.toContain("Maat&#39;s agent replied");
    }
  });

  it("refuses a pair that is not one Brief and one Decision", () => {
    expect(() => persuasionCardHtml([verdictModel, verdictModel], { ...opts, reply: undefined })).toThrow(/Brief/);
  });
});

describe("Maat's agent's reply, from the published journal", () => {
  it("reads the same agent-journal branch as the site", () => {
    expect(JOURNAL_RAW_URL).toBe(SITE_JOURNAL_RAW_URL);
  });

  it("takes the brief row that names the brief's log by id, tx hash and log index", () => {
    const text = dayFile([runRow, briefRow({ briefId: 6, reply: "Another brief." }), briefRow()]);
    expect(briefReply({ state: "read", files: [{ name: "2026-12-01.jsonl", text }] }, BRIEF)).toMatchObject({
      kind: "reply",
      outcome: "replied",
      text: REPLY,
      adopted: false,
      file: "journal/2026-12-01.jsonl",
      line: 3,
    });
    // A row for the same id in another tx (a reorg, or another brief that took the id) is not this brief's.
    const moved = dayFile([briefRow({ txHash: `0x${"34".repeat(32)}` }), briefRow({ logIndex: 4 })]);
    expect(briefReply({ state: "read", files: [{ name: "2026-12-01.jsonl", text: moved }] }, BRIEF)).toEqual({
      kind: "missing",
      why: "the published journal has no row for brief #7 yet",
    });
    expect(briefReply({ state: "absent" }, BRIEF)).toEqual({ kind: "missing", why: "the agent-journal branch has no journal yet" });
  });

  it("reads index.json and the day files it lists, and verifies the chain before it trusts a row", async () => {
    const good = dayFile([runRow, briefRow()]);
    const site = (files: Record<string, string | number>) => async (url: string) => {
      const name = url.slice(JOURNAL_RAW_URL.length);
      const body = files[name];
      if (body === undefined || typeof body === "number") {
        const status = typeof body === "number" ? body : 404;
        return { status, ok: false, json: async () => ({}), text: async () => "" };
      }
      return { status: 200, ok: true, json: async () => JSON.parse(body) as unknown, text: async () => body };
    };
    const index = JSON.stringify({ days: ["2026-12-01"], head: "0x", rows: 2, v: 1 });
    expect(await readJournal(site({}))).toEqual({ state: "absent" });
    expect(await readJournal(site({ "index.json": index, "2026-12-01.jsonl": good }))).toEqual({
      state: "read",
      files: [{ name: "2026-12-01.jsonl", text: good }],
    });
    await expect(readJournal(site({ "index.json": index, "2026-12-01.jsonl": good.replace("No. NYSE", "Yes. NYSE") }))).rejects.toThrow(
      /the published journal does not verify/,
    );
    await expect(readJournal(site({ "index.json": index }))).rejects.toThrow(/HTTP 404 for journal\/2026-12-01\.jsonl, which index\.json lists/);
    await expect(readJournal(site({ "index.json": 500 }))).rejects.toThrow(/HTTP 500 for journal\/index\.json/);
  });
});
