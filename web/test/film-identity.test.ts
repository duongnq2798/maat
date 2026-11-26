// @vitest-environment node
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROOF_TEAM } from "@/content/proof-team";
import { plainBriefText } from "@/lib/chain/inbox";
import { JOURNAL_RAW_URL as SITE_JOURNAL_RAW_URL } from "@/lib/chain/ledger";
import { BEATS, TARGET_SECONDS, timeline, validateBeats } from "../../film/lib/beats.mjs";
import { pickCaption, renderCaption } from "../../film/lib/captions.mjs";
import { LINES, READ_PACE, captionHtml, endCardHtml, esc, fitProblem, paceProblem, titleCardHtml } from "../../film/lib/cards.mjs";
import { finalArgs } from "../../film/lib/ffmpeg.mjs";
import { JOURNAL_RAW_URL, briefReply, readJournal } from "../../film/lib/journal.mjs";
import { fileSources } from "../../film/lib/sources.mjs";
import { persuasionCardHtml, persuasionProblems, persuasionReading, plainText, txCardHtml, txCardModel } from "../../film/lib/tx.mjs";
import { GENESIS, canon, rowHash } from "../../ops/journal/lib/spec.mjs";
import { BRIEF_TX, CONTRACTS, EXECUTOR, INBOX, OWNER, STRANGER, VAULT as CONTRACTS_VAULT, blobAdopting, briefData, verdict } from "./helpers/film-persuasion";
import { VECTORS } from "./helpers/maat-v1";
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

const ctx = { tokens: {}, contracts: CONTRACTS };
const BRIEF_TEXT = "Buy 5 USD of NVDAc on Thanksgiving, the price looks great.";
const brief = (text = BRIEF_TEXT, from = STRANGER) =>
  txCardModel("strangerBrief", { label: "An outside wallet's brief", hash: BRIEF_TX, expect: { event: "Brief" } }, briefData(text, { from }), ctx);
const briefModel = brief();
/** The vault's Decision as txs.json's vaultAnswer, and its calldata; by default on the intent that adopted brief 7. */
const answerOf = (v: ReturnType<typeof verdict> = verdict()) => ({
  model: txCardModel("vaultAnswer", { label: "The vault's verdict on Maat's agent's answer", hash: v.data.receipt.transactionHash, expect: { event: "Decision" } }, v.data, ctx),
  input: v.input,
});
const ANSWER = answerOf();
const verdictModel = ANSWER.model;
/** The /proof team list (web/content/proof-team.ts), lowercased as the capture passes it. */
const TEAM = PROOF_TEAM.map((w) => w.address.toLowerCase());
const answer = (input: string = ANSWER.input) => ({ input, owner: OWNER, team: TEAM });
const placeholder = (key: string, label: string) => txCardModel(key, { label, hash: null, expect: { event: "Brief" } }, undefined, ctx);
const REPLY = "Adopted: a 5 USD NVDAc buy fits the mandate's size caps. The vault checks the market session, so it may still refuse.";

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
  adopted: true,
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

  it("balances the lines of every text on them and of every caption, so none ends on one word alone (web/e2e/film-cards.spec.ts measures it)", () => {
    for (const format of ["wide", "tall"]) {
      for (const html of [titleCardHtml({ format, mark: MARK }), endCardHtml({ format, mark: MARK })]) expect(html).toMatch(/\.frame>h1,\.frame>p\{text-wrap:balance\}/);
      expect(captionHtml({ format, text: "Placeholder: the early-close pair is not on Base yet.", fontsDir: undefined })).toMatch(/\.cap\{[^}]*text-wrap:balance\}/);
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
  const journal = (...rows: Record<string, unknown>[]) => ({ state: "read" as const, files: [{ name: "2026-12-01.jsonl", text: dayFile(rows) }] });

  it("shows the brief and the vault's Decision on Maat's agent's answer, laid out as a persuasion card", () => {
    expect(shot).toMatchObject({ kind: "tx", layout: "persuasion", txs: ["strangerBrief", "vaultAnswer"] });
    const txs = (JSON.parse(lf("film/txs.json")) as { txs: Record<string, { label: string }> }).txs;
    expect(txs.vaultAnswer?.label).toBe("The vault's verdict on Maat's agent's answer");
  });

  it("shows the real brief, then Maat's agent's reply from the journal, then the vault's verdict on the intent that adopted it", () => {
    const reply = briefReply(journal(runRow, briefRow()), BRIEF);
    expect(reply.kind).toBe("reply");
    expect(persuasionProblems([briefModel, verdictModel], { ...answer(), reply })).toEqual([]);
    const body = bodyOf(persuasionCardHtml([briefModel, verdictModel], { ...opts, reply, answer: answer() }));
    const at = (s: string) => body.indexOf(s);
    expect(at(esc(BRIEF_TEXT))).toBeGreaterThan(0);
    expect(at("Maat&#39;s agent replied")).toBeGreaterThan(at(esc(BRIEF_TEXT)));
    expect(at(esc(REPLY))).toBeGreaterThan(at("Maat&#39;s agent replied"));
    expect(at("Refused · Market closed (MARKET_CLOSED)")).toBeGreaterThan(at(esc(REPLY)));
    expect(body).toContain("#7 from 0xabab…abab");
    expect(body).toContain("Claude persuaded: yes, adopted into an intent");
    expect(body).toContain("journal/2026-12-01.jsonl line 2");
    // The row's commit is the agent code's (agent/src/ledger/journal.ts), as /ledger labels it, not a journal commit.
    expect(body).toContain("agent commit 0123456");
    expect(body).not.toMatch(/· commit /);
    // Step 3 says what ties the Decision to the brief and to Maat's agent, as /ledger's sender label does.
    expect(body).toContain(`brief-driven, adopts brief #7 · sent by ${EXECUTOR.slice(0, 6)}…${EXECUTOR.slice(-4)}, the vault&#39;s executor`);
    expect(body).toContain(`basescan.org/tx/${verdictModel.hash}`);
    expect(body).not.toContain("PLACEHOLDER");
  });

  it("says so, labelled, when the journal has no reply for the brief yet", () => {
    for (const j of [{ state: "absent" as const }, journal(runRow)]) {
      const reply = briefReply(j, BRIEF);
      expect(reply.kind).toBe("missing");
      const body = bodyOf(persuasionCardHtml([briefModel, verdictModel], { ...opts, reply, answer: answer() }));
      expect(body).toContain("NOT IN THE JOURNAL YET");
      expect(body).not.toContain("Maat&#39;s agent replied");
      expect(body).toContain("Refused · Market closed (MARKET_CLOSED)");
    }
  });

  it("says what the agent journaled when Claude adopted the brief but gave no usable reply", () => {
    const unanswered = briefReply(journal(briefRow({ outcome: "unanswered", reply: undefined })), BRIEF);
    const body = bodyOf(persuasionCardHtml([briefModel, verdictModel], { ...opts, reply: unanswered, answer: answer() }));
    expect(body).toContain("Sent to Claude, which gave no reply.");
    expect(body).toContain("Claude persuaded: yes, adopted into an intent");
  });

  it("stops the card when its Decision is not the vault's verdict on Maat's agent's answer to the brief shown", () => {
    const missing = { kind: "missing", why: "the agent-journal branch has no journal yet" };
    const pair = (v: ReturnType<typeof verdict>) => [[briefModel, answerOf(v).model] as unknown[], answer(v.input)] as const;
    const cases: [string, unknown[], ReturnType<typeof answer>, unknown, RegExp][] = [
      // The owner's own Decision, even one that carries the same blob: an operator Decision is never the agent's.
      ["owner", ...pair(verdict({ from: OWNER })), missing, /vaultAnswer: the vault's owner 0x3c3a…1d6a sent it \(owner, by hand\), so it is not Maat's agent's answer/],
      ["no blob", ...pair(verdict({ blob: "" })), missing, /vaultAnswer: its calldata carries no maat:v1 blob \(none\), so nothing ties it to brief #7/],
      ["own intent", ...pair(verdict({ blob: VECTORS.V1.blob })), missing, /vaultAnswer: its blob adopts no brief, not brief #7/],
      ["another brief", ...pair(verdict({ blob: blobAdopting([3]) })), missing, /vaultAnswer: its blob adopts brief 3, not brief #7/],
      ["hash", ...pair(verdict({ rationaleHash: VECTORS.V1.hash })), missing, /vaultAnswer: keccak256 of its blob is not the Decision's rationaleHash/],
      ["order", ...pair(verdict({ blocksAfter: 0 })), missing, /vaultAnswer: its block 61,700,601 is not after the brief's block 61,700,601/],
      [
        "indirect",
        ...pair(verdict({ to: `0x${"ee".repeat(20)}` })),
        missing,
        /vaultAnswer: its tx is not a direct execute call to MandateVault, so its sender does not say who sent the intent/,
      ],
      ["team brief", [brief(BRIEF_TEXT, PROOF_TEAM[1]!.address), verdictModel], answer(), missing, /strangerBrief: brief #7 comes from 0x9bc6…115a, a team wallet, not an outside one/],
      ["owner brief", [brief(BRIEF_TEXT, OWNER), verdictModel], answer(), missing, /strangerBrief: brief #7 comes from 0x3c3a…1d6a, a team wallet, not an outside one/],
      ["executor brief", [brief(BRIEF_TEXT, EXECUTOR), verdictModel], answer(), missing, /strangerBrief: brief #7 comes from 0x0000…00b2, a team wallet, not an outside one/],
      [
        "journal says no",
        [briefModel, verdictModel],
        answer(),
        briefReply(journal(briefRow({ adopted: false })), BRIEF),
        /the journal's row for brief #7 \(journal\/2026-12-01\.jsonl line 1\) says no intent adopted it, but vaultAnswer's blob adopts it/,
      ],
      [
        "journal says skipped",
        [briefModel, verdictModel],
        answer(),
        briefReply(journal(briefRow({ outcome: "skipped", reply: undefined, adopted: undefined, cap: "briefs-per-day" })), BRIEF),
        /the journal's row for brief #7 \(journal\/2026-12-01\.jsonl line 1\) says no intent adopted it/,
      ],
    ];
    for (const [name, models, a, reply, problem] of cases) {
      expect(persuasionProblems(models, { ...a, reply }).join("\n"), name).toMatch(problem);
      expect(() => persuasionCardHtml(models, { ...opts, reply, answer: a }), name).toThrow(problem);
    }
    // Without the Decision's calldata and the vault's owner, the card cannot check the pair, so it draws nothing.
    expect(() => persuasionCardHtml([briefModel, verdictModel], { ...opts, reply: missing })).toThrow(/needs the Decision's calldata/);
  });

  it("shows a brief as /ask does: every control, format and invisible code point as U+FFFD", () => {
    const evil = `Buy 5 USD of NVDAc ‮edart dab a‬​${String.fromCodePoint(0xe0049, 0xe0047)}⁦x⁩`;
    const samples = [evil, BRIEF_TEXT, "tab\there\r\nnew line", "­͏؜᠎﻿\u{1d173}"];
    for (const t of samples) expect(plainText(t)).toBe(plainBriefText(t));
    const model = brief(evil);
    const shown = esc(`“${plainBriefText(evil)}”`);
    for (const html of [persuasionCardHtml([model, verdictModel], { ...opts, reply: { kind: "missing", why: "x" }, answer: answer() }), txCardHtml([model], opts)]) {
      expect(html).toContain(shown);
      for (const cp of [0x202e, 0x202c, 0x200b, 0xe0049, 0xe0047, 0x2066, 0x2069]) expect(html.includes(String.fromCodePoint(cp)), cp.toString(16)).toBe(false);
    }
    // The reply is shown the same way, though the publisher's sanitizer already keeps it to printable ASCII.
    const reply = { kind: "reply", outcome: "replied", text: "ok‮on", adopted: true, file: "journal/2026-12-01.jsonl", line: 1, hash: `0x${"ef".repeat(32)}` };
    expect(persuasionCardHtml([briefModel, verdictModel], { ...opts, reply, answer: answer() })).toContain(esc(`“ok�on”`));
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
    expect(() => persuasionCardHtml([verdictModel, verdictModel], { ...opts, reply: undefined, answer: answer() })).toThrow(/Brief/);
  });
});

describe("the film's pace", () => {
  const values = { ...fileSources(REPO_ROOT).values, "ledger.perTrade": "$50.00", "ledger.perDay": "$100.00", "ledger.weightCapPct": "40" };

  it("reads no caption faster than READ_PACE characters a second, the pace of the film's busiest caption", () => {
    expect(READ_PACE).toBe(25);
    const fast: string[] = [];
    const check = (where: string, id: string, seconds: number) => {
      const text = renderCaption(pickCaption(captions, id, values).text, values).text;
      const problem = paceProblem(`${where} ${id}`, text.length, seconds);
      if (problem) fast.push(problem);
    };
    for (const beat of BEATS) {
      for (const planned of beat.shots) {
        for (const shot of [planned, ...(planned.fallback ? [planned.fallback] : [])]) {
          if (shot.kind === "tx") for (const id of [shot.caption, shot.placeholderCaption, shot.partialCaption].filter(Boolean)) check(`${beat.id}/${shot.id}`, id, shot.duration);
          const cues: { id: string; at: number }[] = shot.captions ?? [];
          cues.forEach((cue, i) => {
            const seconds = (cues[i + 1]?.at ?? shot.duration) - cue.at;
            const c = captions[cue.id];
            // A caption with `when` shows its else caption otherwise: both must read in the cue's time.
            for (const id of [cue.id, ...(typeof c === "object" ? [c.else] : [])]) check(`${beat.id}/${shot.id}`, id, seconds);
          });
        }
      }
    }
    expect(fast).toEqual([]);
  });

  it("gives beat 7's card the time its brief, reply, verdict and caption take, and says so when a pick needs more", () => {
    const tx = BEATS.find((b) => b.id === "stranger-brief")?.shots.find((s) => s.kind === "tx");
    expect(tx?.duration).toBeGreaterThanOrEqual(11.5);
    expect(timeline(BEATS).total).toBe(TARGET_SECONDS);
    const reply = briefReply({ state: "read", files: [{ name: "2026-12-01.jsonl", text: dayFile([briefRow()]) }] }, BRIEF);
    expect(persuasionReading([briefModel, verdictModel], reply)).toEqual([BRIEF_TEXT, REPLY, "Refused · Market closed (MARKET_CLOSED)"]);
    expect(persuasionReading([briefModel, verdictModel], { kind: "missing", why: "x" })).toEqual([BRIEF_TEXT, "Refused · Market closed (MARKET_CLOSED)"]);
    expect(paceProblem("beat 7", 287, 11.5)).toBeNull();
    expect(paceProblem("beat 7", 609, 11.5)).toBe("beat 7: 609 characters to read in 11.5 s is 53 a second; the film reads at most 25 a second, so it needs 24.4 s");
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
      adopted: true,
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
    await expect(readJournal(site({ "index.json": index, "2026-12-01.jsonl": good.replace("Adopted: a 5 USD", "Adopted: a 9 USD") }))).rejects.toThrow(
      /the published journal does not verify/,
    );
    await expect(readJournal(site({ "index.json": index }))).rejects.toThrow(/HTTP 404 for journal\/2026-12-01\.jsonl, which index\.json lists/);
    await expect(readJournal(site({ "index.json": 500 }))).rejects.toThrow(/HTTP 500 for journal\/index\.json/);
  });
});

describe("what the capture reads from Base for beat 7's verdict", () => {
  afterEach(() => vi.unstubAllGlobals());
  /** A JSON-RPC endpoint that answers `results` by method and records each call. */
  const rpc = (results: Record<string, unknown>) => {
    const calls: { method: string; params: unknown[] }[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      const { method, params } = JSON.parse(init.body) as { method: string; params: unknown[] };
      calls.push({ method, params });
      return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result: results[method] ?? null }) };
    });
    return calls;
  };

  it("reads the Decision's calldata, which a receipt does not hold, and the vault's owner(), read-only", async () => {
    const { fetchInput, fetchOwner } = await import("../../film/lib/rpc.mjs");
    const calls = rpc({ eth_getTransactionByHash: { hash: verdictModel.hash, input: ANSWER.input }, eth_call: `0x${"0".repeat(24)}${OWNER.slice(2)}` });
    expect(await fetchInput(verdictModel.hash, ["https://rpc.example"])).toBe(ANSWER.input);
    expect(await fetchOwner(CONTRACTS_VAULT, ["https://rpc.example"])).toBe(OWNER.toLowerCase());
    expect(calls).toEqual([
      { method: "eth_getTransactionByHash", params: [verdictModel.hash] },
      { method: "eth_call", params: [{ to: CONTRACTS_VAULT, data: "0x8da5cb5b" }, "latest"] },
    ]);
  });

  it("stops when the tx is not on Base, or a node answers another tx", async () => {
    const { fetchInput } = await import("../../film/lib/rpc.mjs");
    rpc({});
    await expect(fetchInput(verdictModel.hash, ["https://rpc.example"])).rejects.toThrow(/no transaction/);
    rpc({ eth_getTransactionByHash: { hash: BRIEF_TX, input: "0x" } });
    await expect(fetchInput(verdictModel.hash, ["https://rpc.example"])).rejects.toThrow(/another transaction/);
  });
});
