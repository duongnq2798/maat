import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import type { Address, Hex } from "viem";
import { describe, expect, it } from "vitest";
import { OnTheRecord, recordTabTime, recordTimeLabel, recordWhen } from "@/components/sections/OnTheRecord";
import { SpecPlate } from "@/components/sections/SpecPlate";
import { PROBE_GLOSS } from "@/components/sections/Vault";
import { toVaultRow } from "@/components/sections/vault-rows";
import { localTime, regularSession } from "@/content/calendar";
import { FACTS } from "@/content/facts";
import { clockLabel, formatInt } from "@/content/format";
import snapshot from "@/content/generated/decisions-snapshot.json";
import { REASON_LABEL } from "@/content/reasons";
import { RECORD_LINKS, RECORD_MOMENTS, RECORD_SENDER, RECORD_TITLE, recordDay } from "@/content/record";
import { snapshotPreview } from "@/lib/chain/load";
import { etLabel } from "@/lib/chain/ledger";
import { decodeExecuteInput, PROBE_TEXT_PREFIX } from "@/lib/chain/rationale";
import { basescanDecision, basescanRefusalNote } from "@/lib/live/basescan";
import { readTxConfig } from "../../film/lib/tx.mjs";
import recordInputs from "./fixtures/record-inputs.json";

const VAULT = "0x3F956072d18ddD20d5eFb74e9CCabf8Deade699b";
/** The repository's root: vitest runs from web/, and jsdom gives import.meta.url no file path. */
const REPO_ROOT = join(process.cwd(), "..");
const [HOLIDAY, BEFORE, AFTER] = RECORD_MOMENTS;

/** The verdict in the lexicon's grammar: "Refused · Market closed (MARKET_CLOSED)". */
const grammar = (allowed: boolean, reason: keyof typeof REASON_LABEL) => `${allowed ? "Allowed" : "Refused"} · ${REASON_LABEL[reason]} (${reason})`;
const shortTx = (tx: string) => `${tx.slice(0, 6)}…${tx.slice(-4)}`;

/** The Decision log of a transaction in the committed snapshot, its data split in words: action, amount, allowed, reason, rationaleHash. */
function snapshotWords(txHash: string): Hex[] {
  const log = snapshot.logs.find((l) => l.transactionHash.toLowerCase() === txHash.toLowerCase());
  if (log === undefined) throw new Error(`${txHash} is not in content/generated/decisions-snapshot.json`);
  return (log.data.slice(2).match(/.{64}/g) ?? []).map((w) => `0x${w}` as Hex);
}

/** The maat:v1 blob a moment's transaction carries, decoded from its calldata as Base holds it. */
function blobOf(txHash: string) {
  const input = (recordInputs.inputs as Record<string, string>)[txHash];
  if (input === undefined) throw new Error(`${txHash} has no calldata in test/fixtures/record-inputs.json`);
  const call = decodeExecuteInput(input as Hex);
  if (call === null || call.blob.status !== "v1") throw new Error(`${txHash}: no maat:v1 blob in its calldata`);
  return { call, fields: call.blob.fields };
}

describe("On the record: every moment is a real Decision of the mainnet vault (spec 2026-11-28 section 2)", () => {
  // The committed snapshot holds the vault's raw logs from its deploy block; the site's own decoder reads them.
  const preview = snapshotPreview(snapshot, snapshot.vault as Address);

  it("reads the committed snapshot of the mainnet vault", () => {
    expect(snapshot.vault).toBe(VAULT);
    expect(snapshot.chainId).toBe(8453);
    expect(preview).not.toBeNull();
  });

  for (const m of RECORD_MOMENTS) {
    it(`${m.id}: holds tx, block, intent, amount and verdict to its Decision log`, () => {
      const d = preview!.decisions.find((x) => x.txHash.toLowerCase() === m.txHash.toLowerCase());
      expect(d, m.txHash).toBeDefined();
      const row = toVaultRow(d!);
      expect(row.block).toBe(m.block);
      expect(row.action).toBe(m.action);
      expect(row.symbol).toBe(m.symbol);
      expect(row.amountLabel).toBe(m.amount);
      expect(row.allowed).toBe(m.allowed);
      expect(row.reason).toBe(m.reason);
    });

    it(`${m.id}: the vault's calendar agrees with the verdict at that minute`, () => {
      // MarketCalendar.isOpen(ts, REGULAR), as content/calendar.ts mirrors it: allowed exactly when the market was open.
      expect(regularSession(m.ts).open).toBe(m.allowed);
    });

    it(`${m.id}: its calldata carries the blob the vault logged, and the blob says who sent it`, () => {
      const { call, fields } = blobOf(m.txHash);
      // The blob's keccak256 is the intent's rationaleHash and the rationaleHash of the Decision log.
      expect(call.intentRationaleHash).toBe(call.blobHash);
      expect(snapshotWords(m.txHash)[4]).toBe(call.blobHash);
      if (m.sender === "probe") {
        expect(fields.k).toBe("probe");
        expect(fields.t.startsWith(PROBE_TEXT_PREFIX)).toBe(true);
        expect(m.quote).toBeUndefined();
      } else {
        // Written by a model, not a probe or a bill; the quote is Claude's sentence, word for word.
        expect(fields.k).toBeUndefined();
        expect(fields.m).toMatch(/^claude-/);
        expect(m.quote).toBeDefined();
        expect(fields.t).toContain(m.quote);
      }
      // The film names the same sender for the same transaction (film/txs.json, checked against Base by the render).
      const film = Object.values(readTxConfig(REPO_ROOT).txs as Record<string, { hash: string | null; expect: { sender: string } }>).find(
        (t) => t.hash?.toLowerCase() === m.txHash.toLowerCase(),
      );
      expect(film?.expect.sender).toBe(m.sender);
    });
  }

  it("dates each moment to its block time, as the README's table of Decisions and its isOpen proof do", () => {
    const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf8").split("\r\n").join("\n");
    expect(RECORD_MOMENTS.map((m) => recordWhen(m.ts))).toEqual(["Thu 26 Nov 21:14 ET", "Fri 27 Nov 12:58 ET", "Fri 27 Nov 13:01 ET"]);
    for (const m of RECORD_MOMENTS) {
      expect(recordWhen(m.ts)).toBe(`${etLabel(m.ts)} ET`);
      // The README's table of every Decision: block and UTC block time, to the second.
      const utc = new Date(m.ts * 1000).toISOString().slice(0, 19).replace("T", " ");
      expect(readme).toContain(`| ${formatInt(Number(m.block))} | ${utc} |`);
      // The README's table of the story's Decisions: the row with this transaction's short hash starts at this time.
      const row = readme.split("\n").find((l) => l.includes(`[\`${shortTx(m.txHash)}\`]`));
      expect(row, m.txHash).toBeDefined();
      expect(row!.startsWith(`| ${recordWhen(m.ts).replace(/ ET$/, "")} |`)).toBe(true);
    }
    // The early-close pair, as the README proves it with the contract's own view.
    expect(readme).toContain(`\`isOpen(${BEFORE.ts}, 0)\` is \`true\`, \`isOpen(${AFTER.ts}, 0)\` is \`false\``);
    // The first moment's block time is also the one this build records for it.
    expect(FACTS.mainnetDecisions.value.find((l) => l.transactionHash === HOLIDAY.txHash)?.blockTime).toBe(HOLIDAY.ts);
  });

  it("says what the calendar held that day, from the calendar itself", () => {
    expect(RECORD_MOMENTS.map((m) => recordDay(m).line)).toEqual([
      "The calendar had NYSE closed all day for Thanksgiving.",
      "The calendar had the market open until 13:00 ET, an early close. 12:58 was inside the session.",
      "The calendar had the market closing at 13:00 ET, an early close. 13:01 was after it.",
    ]);
    expect(recordDay(HOLIDAY).session).toBeNull();
    expect(recordDay(BEFORE).session).toEqual({ openMin: 570, closeMin: 780 });
  });

  it("holds every figure and claim of the holiday story to the transaction's blob and the mandate", () => {
    const { fields } = blobOf(HOLIDAY.txHash);
    // "GOOGLc sat at 0% against a 23.3% target": Claude's own figures, from the blob's `t`.
    const [, weight, target] = /GOOGLc is (\d+(?:\.\d+)?)% vs a (\d+(?:\.\d+)?)% target/.exec(fields.t) ?? [];
    expect(weight).toBeDefined();
    expect(HOLIDAY.story).toContain(`GOOGLc sat at ${weight}% against a ${target}% target.`);
    // "The price was fine": the GOOGLc source the agent read was fresh enough and inside the premium cap.
    expect(HOLIDAY.story).toContain("The price was fine");
    const googl = fields.s.find((s) => s.sym === HOLIDAY.symbol)!;
    expect(HOLIDAY.ts - googl.updatedAt!).toBeLessThanOrEqual(FACTS.mandate.value.maxStalenessSec);
    expect(Math.abs(googl.premiumBps!)).toBeLessThanOrEqual(FACTS.mandate.value.maxPremiumBps);
    // "$4.68 was under a tenth of the $50 cap", the deployed mandate's per-trade cap.
    const cap = FACTS.mandate.value.perTradeCapUsd;
    expect(HOLIDAY.story).toContain(`${HOLIDAY.amount} was under a tenth of the $${cap} cap`);
    expect(Number(HOLIDAY.amount.slice(1)) * 10).toBeLessThan(cap);
    // "The day was not": the calendar's holiday.
    expect(regularSession(HOLIDAY.ts)).toMatchObject({ open: false, why: "holiday" });
  });

  it("counts the early-close stories' minutes on the calendar, and never calls the two probes the same trade", () => {
    const close = recordDay(BEFORE).session!.closeMin;
    // "Two minutes before the close, all 9 checks passed."
    expect(close - localTime(BEFORE.ts).minuteOfDay).toBe(2);
    expect(BEFORE.story).toContain(`Two minutes before the close, all ${FACTS.checksPerTrade.value} checks passed.`);
    // "Three minutes later, another $1 buy. ... a Friday that ended at 13:00."
    expect(localTime(AFTER.ts).minuteOfDay - localTime(BEFORE.ts).minuteOfDay).toBe(3);
    expect(AFTER.story).toContain(`Three minutes later, another ${AFTER.amount.replace(/\.00$/, "")} buy.`);
    expect(AFTER.story).toContain(`a Friday that ended at ${clockLabel(close)}.`);
    // They bought different stocks: no story may say "the same".
    expect(BEFORE.symbol).not.toBe(AFTER.symbol);
    for (const m of RECORD_MOMENTS) expect(m.story).not.toMatch(/\bthe same\b/i);
  });

  it("names a probe as one, in the engine card's words, and Claude only where Claude proposed the trade", () => {
    expect(RECORD_MOMENTS.map((m) => m.sender)).toEqual(["agent", "probe", "probe"]);
    expect(RECORD_SENDER.agent).toBe("Proposed by Claude, sent by Maat's agent");
    // PROBE_GLOSS: "A probe is a $1 test trade the owner scheduled, not a Claude proposal."
    const gloss = PROBE_GLOSS.replace(/^A probe is /, "").replace(/\.$/, "");
    expect(RECORD_SENDER.probe).toBe(`Sent by Maat's agent as a probe: ${gloss}`);
  });
});

describe("the On the record block", () => {
  const panel = (id: string) => document.getElementById(`record-panel-${id}`)!;
  /** Opens a moment's tab: only the open moment is drawn. */
  const open = (id: string) => fireEvent.click(document.getElementById(`record-tab-${id}`)!);

  it("is a labelled section with its heading, three moments as tabs, and the first one open", () => {
    render(<OnTheRecord />);
    const section = document.getElementById("record")!;
    expect(section.tagName).toBe("SECTION");
    expect(section).toHaveAttribute("aria-labelledby", "record-title");
    const heading = screen.getByRole("heading", { level: 2, name: RECORD_TITLE });
    expect(heading).toHaveAttribute("id", "record-title");
    expect(heading.textContent).toBe(RECORD_TITLE);
    // Each sentence is kept whole where it fits, so the heading breaks between them first.
    expect([...heading.querySelectorAll("span.inline-block")].map((s) => s.textContent)).toEqual(["Pick a moment.", "Read the vault's answer."]);
    const tabs = within(screen.getByRole("tablist", { name: "Moments on Base mainnet" })).getAllByRole("tab");
    // Each tab: the moment's weekday and time in New York, computed from its block time, then what it was.
    expect(RECORD_MOMENTS.map((m) => recordTabTime(m.ts))).toEqual(["Thu 21:14", "Fri 12:58", "Fri 13:01"]);
    expect(tabs.map((t) => t.textContent)).toEqual(["Thu 21:14 Thanksgiving", "Fri 12:58 Before close", "Fri 13:01 After close"]);
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    // 44 px targets, as the ledger's filter chips.
    for (const t of tabs) expect(t.className.split(" ")).toContain("min-h-11");
    expect(panel("holiday")).toBeVisible();
    expect(panel("before-close")).not.toBeVisible();
    expect(panel("after-close")).not.toBeVisible();
    // A panel whose first content is not focusable takes focus itself.
    for (const m of RECORD_MOMENTS) expect(panel(m.id).tabIndex).toBe(0);
  });

  it("shows each moment's source, time, intent, sender, verdict, story and the way to its Decision on Basescan", () => {
    render(<OnTheRecord />);
    for (const m of RECORD_MOMENTS) {
      open(m.id);
      const p = panel(m.id);
      expect(p).toHaveAttribute("role", "tabpanel");
      expect(p).toHaveAttribute("aria-labelledby", `record-tab-${m.id}`);
      expect(p.querySelector("[data-record-source]")!.textContent).toBe(`Base mainnet · block ${formatInt(Number(m.block))}`);
      expect(p.querySelector("[data-record-when]")!.textContent).toBe(recordWhen(m.ts));
      const verdict = p.querySelector("[data-record-verdict]")!;
      expect(verdict).toHaveAttribute("data-record-verdict", m.allowed ? "allowed" : "refused");
      expect(verdict.textContent).toBe(`VAULT DECISION ${grammar(m.allowed, m.reason)}`);
      // The reason's words and its code wrap as one: "Market closed (MARKET_CLOSED)".
      expect(verdict.querySelector(".whitespace-nowrap")!.textContent).toBe(`${REASON_LABEL[m.reason]} (${m.reason})`);
      expect(p.querySelector("[data-record-story]")!.textContent).toBe(m.story);
      expect(p.querySelector("[data-record-intent]")!.textContent).toBe(`BUY ${m.symbol} · ${m.amount}`);
      expect(p.querySelector("[data-record-sender]")!.textContent).toBe(RECORD_SENDER[m.sender]);
      expect(p.querySelector("[data-record-calendar]")!.textContent).toBe(recordDay(m).line);
      expect(p.textContent).toContain(`tx ${shortTx(m.txHash)}`);
      const link = within(p).getByRole("link", { name: /Open it on Basescan/ });
      expect(link).toHaveAttribute("href", basescanDecision(m.txHash));
      expect(link.textContent).toBe("Open it on Basescan ↗");
      // A refusal says why Basescan reads "Success" anyway, at every width.
      const note = p.querySelector<HTMLElement>("[data-record-basescan-note]");
      if (m.reason === "OK") expect(note).toBeNull();
      else {
        expect(note!.textContent).toBe(basescanRefusalNote(m.reason));
        expect(note!.className).not.toMatch(/hidden/);
      }
    }
    open("holiday");
    const figure = panel("holiday").querySelector("figure")!;
    expect(figure.querySelector("blockquote")!.textContent).toBe(`“${HOLIDAY.quote}”`);
    expect(figure.querySelector("figcaption")!.textContent).toBe("Claude's words, carried in the transaction");
    open("before-close");
    expect(panel("before-close").querySelector("blockquote")).toBeNull();
  });

  it("draws the day's session and the Decision's minute on the regular day's bar, and says open or closed in words", () => {
    render(<OnTheRecord />);
    const session = (id: string) => {
      open(id);
      return panel(id).querySelector<HTMLElement>("[data-record-session]");
    };
    const needle = (id: string) => panel(id).querySelector<HTMLElement>("[data-record-needle]")!.style.left;
    const time = (id: string) => panel(id).querySelector<HTMLElement>("[data-record-time]")!;
    expect(RECORD_MOMENTS.map(recordTimeLabel)).toEqual(["21:14 · closed →", "12:58 · open", "13:01 · closed"]);
    // Thanksgiving: no session at all, and 21:14 is past the bar's 16:00 end: no needle, only the label at that end.
    expect(session("holiday")).toBeNull();
    expect(panel("holiday").querySelector("[data-record-needle]")).toBeNull();
    expect(panel("before-close").textContent).toBe("");
    expect(time("holiday").textContent).toBe("21:14 · closed →");
    expect(time("holiday").className.split(" ")).toContain("text-refuse");
    // The early close: 09:30 to 13:00 lit, 210 of the regular day's 390 minutes, its end square.
    expect(session("before-close")!.style.left).toBe("0%");
    expect(Number.parseFloat(session("before-close")!.style.width)).toBeCloseTo((210 / 390) * 100, 5);
    expect(session("before-close")!.className.split(" ")).toContain("rounded-l-full");
    expect(Number.parseFloat(needle("before-close"))).toBeCloseTo((208 / 390) * 100, 5);
    expect(time("before-close").textContent).toBe("12:58 · open");
    expect(time("before-close").className.split(" ")).toContain("text-accent");
    open("after-close");
    expect(Number.parseFloat(needle("after-close"))).toBeCloseTo((211 / 390) * 100, 5);
    expect(time("after-close").textContent).toBe("13:01 · closed");
    expect(time("after-close").className.split(" ")).toContain("text-refuse");
    for (const m of RECORD_MOMENTS) {
      open(m.id);
      for (const bar of panel(m.id).querySelectorAll("[data-record-day] > div")) expect(bar).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("switches moments on a click, and with the arrow keys, Home and End, moving focus with the selection", () => {
    render(<OnTheRecord />);
    const tab = (name: string) => screen.getByRole("tab", { name: new RegExp(name) });
    fireEvent.click(tab("After close"));
    expect(tab("After close")).toHaveAttribute("aria-selected", "true");
    expect(panel("after-close")).toBeVisible();
    expect(panel("holiday")).not.toBeVisible();

    const list = screen.getByRole("tablist");
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(tab("Thanksgiving")).toHaveAttribute("aria-selected", "true");
    expect(tab("Thanksgiving")).toHaveFocus();
    fireEvent.keyDown(list, { key: "ArrowLeft" });
    expect(tab("After close")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(list, { key: "Home" });
    expect(tab("Thanksgiving")).toHaveFocus();
    fireEvent.keyDown(list, { key: "End" });
    expect(tab("After close")).toHaveFocus();
    expect(panel("after-close")).toBeVisible();
    // A shortcut with a modifier key is the browser's: the selection stays.
    for (const mod of ["altKey", "ctrlKey", "metaKey"] as const) {
      fireEvent.keyDown(list, { key: "ArrowRight", [mod]: true });
      expect(tab("After close")).toHaveAttribute("aria-selected", "true");
    }
  });

  it("ends on the ledger and the simulator, each arrow tied to its last word, then the spec plate", () => {
    render(<OnTheRecord />);
    const section = document.getElementById("record")!;
    for (const l of RECORD_LINKS) {
      const a = within(section).getByRole("link", { name: l.label });
      expect(a).toHaveAttribute("href", l.href);
      expect(a.querySelector('[aria-hidden="true"]')!.textContent).toBe(` ${l.arrow}`);
    }
    expect(section.querySelector("[data-spec-plate]")).not.toBeNull();
  });

  it("holds the first moment in the static HTML and only its panel's shell for the others, with no full hash, no uppercase REFUSE and no word the lexicon keeps for later", () => {
    const html = renderToString(<OnTheRecord />);
    for (const m of RECORD_MOMENTS) expect(html).toContain(`id="record-panel-${m.id}"`);
    expect(html).toContain(HOLIDAY.story);
    expect(html).not.toContain(BEFORE.story);
    expect(html).not.toContain("REFUSE");
    const { container } = render(<OnTheRecord />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/0x[0-9a-fA-F]{40,}/);
    // How it works defines "mandate" where the page first says it; this block sits above it and does not say it.
    expect(text).not.toMatch(/\bmandate\b/i);
    expect(text).not.toMatch(/\bsafe\b/i);
  });
});

describe("the spec plate", () => {
  // Since spec 2026-11-28 (landing "a calmer first screen", section 1) the plate closes "On the record", under the hero.
  it("engraves the spec plate's labels and marks each figure with the fact it comes from", () => {
    render(<SpecPlate />);
    const plate = [
      ["CHECKS PER TRADE", "checksPerTrade", String(FACTS.checksPerTrade.value)],
      ["TYPED REFUSALS", "refusalCount", String(FACTS.refusalCount.value)],
      ["RULE TIMELOCK", "timelockHours", `${FACTS.timelockHours.value}h`],
    ] as const;
    for (const [label, fact, value] of plate) {
      const dt = screen.getByText(label);
      expect(dt.tagName).toBe("DT");
      expect(dt.className.split(" ")).toEqual(expect.arrayContaining(["font-mono", "text-[11px]", "tracking-[0.12em]", "text-label"]));
      const dd = dt.nextElementSibling!;
      expect(dd.tagName).toBe("DD");
      expect(dd).toHaveAttribute("data-fact", fact);
      expect(dd.textContent).toBe(value);
    }
  });
});
