import { readFileSync } from "node:fs";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Hero } from "@/components/sections/Hero";
import { HeroNote, type RecordedNote } from "@/components/sections/HeroNote";
import type { VaultStatus, VaultView } from "@/components/sections/VaultDecisions";
import { RECORDED_ROWS } from "@/components/sections/vault-rows";
import { FACTS } from "@/content/facts";
import agentNote from "@/content/generated/agent-note.json";
import { HERO_CTAS, HERO_DEFINITION } from "@/content/hero";
import { etLabel } from "@/lib/chain/ledger";
import { NOTE_ROUND_SEC, noteSuperseded } from "@/lib/live/hero-note";
import { SITE } from "@/lib/site";

const css = readFileSync("app/globals.css", "utf8");
const hero = () => document.getElementById("top")!;
const classes = (el: Element) => el.getAttribute("class")!.split(" ");

describe("the hero (spec 2026-11-23 sections 6.1, 6.2 and 9.1)", () => {
  it("draws the tick ruler where the masked grid was", () => {
    render(<Hero />);
    const ruler = hero().querySelector(":scope > [data-ruler]");
    expect(ruler).not.toBeNull();
    expect(ruler).toHaveAttribute("aria-hidden", "true");
    expect(hero().querySelector(".grid-bg")).toBeNull();
    expect(hero().querySelector(".hero-glow")).not.toBeNull();
  });

  it("sets the H1 at clamp(44px,5.4vw,78px), line-height .96 and -0.055em, with its words unchanged", () => {
    render(<Hero />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(classes(h1)).toEqual(
      expect.arrayContaining(["text-[clamp(44px,5.4vw,78px)]", "leading-[0.96]", "tracking-[-0.055em]", "font-semibold"]),
    );
    expect(h1).toHaveTextContent("The AI agent that knows when not to trade.");
  });

  it("says what Maat is right under the H1, then its three steps in one row, each a 44 px link to How it works", () => {
    render(<Hero />);
    // Spec 2026-11-27 section 1: the definition, then the steps, then the one live line.
    const h1 = screen.getByRole("heading", { level: 1 });
    const definition = h1.nextElementSibling!;
    expect(definition).toHaveAttribute("data-hero-definition");
    expect(definition.tagName).toBe("P");
    expect(definition).toHaveTextContent(HERO_DEFINITION);
    const steps = definition.nextElementSibling!;
    expect(steps.tagName).toBe("OL");
    expect(classes(steps)).toEqual(expect.arrayContaining(["grid", "grid-cols-3"]));
    const links = [...steps.querySelectorAll("a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["#how", "#how", "#how"]);
    for (const a of links) expect(classes(a)).toContain("min-h-11");
    expect(steps.nextElementSibling).toHaveAttribute("data-live-strip");
    // The site's description stays the meta description; the hero no longer repeats it.
    expect(hero()).not.toHaveTextContent(SITE.description);
  });

  it("puts both CTAs right after the live line: 52 px and stacked on phones, 44 px in a row from sm", () => {
    render(<Hero />);
    const ctas = [...hero().querySelectorAll<HTMLAnchorElement>("[data-hero-cta]")];
    expect(ctas.map((a) => [a.textContent, a.getAttribute("href")])).toEqual(HERO_CTAS.map((c) => [c.label, c.href]));
    expect(ctas.map((a) => a.className.split(" ")[0])).toEqual(["pill-dark", "pill-line"]);
    for (const a of ctas) expect(classes(a)).toEqual(expect.arrayContaining(["min-h-[52px]", "sm:min-h-11", "justify-center"]));
    const group = ctas[0]!.parentElement!;
    expect(classes(group)).toEqual(expect.arrayContaining(["flex", "flex-col", "sm:flex-row"]));
    expect(group.previousElementSibling).toHaveAttribute("data-live-strip");
  });

  it("opens the film band with the first CTA and the simulator with the second", () => {
    expect(HERO_CTAS[0]).toEqual({ label: "Watch the film (1:40)", href: "#film" });
    expect(HERO_CTAS[1]).toEqual({ label: "Try to make it say no", href: "#try" });
  });

  it("puts the agent's last recorded round under the engine card, copied from the journal with its line", () => {
    render(<Hero />);
    const card = hero().querySelector("[data-hero-card]")!;
    const note = card.nextElementSibling!;
    // The note is newer than every Decision recorded in this build, so the static page quotes it.
    expect(note).toHaveAttribute("data-hero-note", "recorded");
    expect(note).toHaveTextContent(`Maat's agent, last round recorded in this build · ${agentNote.note.when}`);
    expect(note.querySelector("blockquote")!.textContent).toBe(agentNote.note.summary);
    const line = within(note as HTMLElement).getByRole("link", { name: `journal/${agentNote.note.file} line ${agentNote.note.line}` });
    expect(line).toHaveAttribute("href", `${SITE.repoUrl}/blob/agent-journal/journal/${agentNote.note.file}#L${agentNote.note.line}`);
    expect(within(note as HTMLElement).getByRole("link", { name: "Newer rounds on /now" })).toHaveAttribute("href", "/now");
  });

  it("records a note that npm run agent-note wrote: a verified round's summary, its New York time and its journal line", () => {
    expect(agentNote.head).toMatch(/^0x[0-9a-f]{64}$/);
    expect(agentNote.rows).toBeGreaterThanOrEqual(agentNote.note.line);
    expect(agentNote.note.file).toMatch(/^\d{4}-\d{2}-\d{2}\.jsonl$/);
    expect(agentNote.note.when).toBe(`${etLabel(Math.floor(agentNote.note.ts))} ET`);
    expect(agentNote.note.summary.length).toBeGreaterThan(0);
  });

  it("shows a note as text, never as markup, and nothing at all when the build records none", () => {
    const { container, unmount } = render(
      <HeroNote recorded={{ summary: "<b>no</b> trade", ts: 1_795_788_934.097, when: "Fri 27 Nov 09:15 ET", file: "2026-11-27.jsonl", line: 3 }} />,
    );
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("blockquote")!.textContent).toBe("<b>no</b> trade");
    unmount();
    expect(render(<HeroNote recorded={null} />).container).toBeEmptyDOMElement();
  });

  it("drops a note once the vault's latest Decision is newer than its round, never for a Decision of that round", () => {
    // The review of PR #105: the note of journal/2026-11-27.jsonl line 19 (14:15:34 UTC, "I proposed nothing this
    // round") beside the buy the next round sent, at 15:15:43 UTC.
    const line19 = 1_795_788_934.097;
    expect(noteSuperseded(line19, 1_795_792_543)).toBe(true);
    // Line 20, the round that proposed that buy: its run row is written before the intents it sends.
    const line20 = 1_795_792_539.35;
    expect(noteSuperseded(line20, 1_795_792_543)).toBe(false);
    expect(noteSuperseded(line20, Math.floor(line20) + NOTE_ROUND_SEC)).toBe(false);
    expect(noteSuperseded(line20, Math.ceil(line20) + NOTE_ROUND_SEC)).toBe(true);
    // An older Decision, and one whose time was not read, never drop it.
    expect(noteSuperseded(line19, line19 - 3600)).toBe(false);
    expect(noteSuperseded(line19, null)).toBe(false);
  });

  describe("beside the vault card's latest Decision, live or recorded", () => {
    const recorded: RecordedNote = {
      summary: "Market is closed, so I proposed nothing this round.",
      ts: 1_795_788_934.097,
      when: "Fri 27 Nov 09:15 ET",
      file: "2026-11-27.jsonl",
      line: 19,
    };
    const view = (status: VaultStatus, timestamp: number | null): VaultView => ({
      status,
      decisions: [{ ...RECORDED_ROWS[0]!, timestamp }, ...RECORDED_ROWS.slice(1)],
      head: status === "live" ? "63010853" : null,
      retry: null,
    });
    const STATUSES: readonly VaultStatus[] = ["live", "recorded", "reading"];

    it.each(STATUSES)("quotes the note while the %s Decision is older than its round", (status) => {
      for (const t of [recorded.ts - 3600, recorded.ts + 8, null]) {
        const { container, unmount } = render(<HeroNote recorded={recorded} view={view(status, t)} />);
        const note = container.querySelector("[data-hero-note]")!;
        expect(note).toHaveAttribute("data-hero-note", "recorded");
        expect(note.querySelector("blockquote")!.textContent).toBe(recorded.summary);
        unmount();
      }
    });

    it.each(STATUSES)("gives way to one dated line that points to /now once the %s Decision is newer", (status) => {
      const { container } = render(<HeroNote recorded={recorded} view={view(status, 1_795_792_543)} />);
      const note = container.querySelector<HTMLElement>("[data-hero-note]")!;
      expect(note).toHaveAttribute("data-hero-note", "superseded");
      expect(note.querySelector("blockquote")).toBeNull();
      expect(note).not.toHaveTextContent("proposed nothing");
      expect(note.textContent).toBe(
        "The vault's latest Decision is newer than the last note from Maat's agent in this build (Fri 27 Nov 09:15 ET). Newer rounds on /now →",
      );
      expect(within(note).getByRole("link", { name: "Newer rounds on /now" })).toHaveAttribute("href", "/now");
    });
  });

  it("engraves the spec plate's labels and marks each figure with the fact it comes from", () => {
    render(<Hero />);
    const plate = [
      ["CHECKS PER TRADE", "checksPerTrade", String(FACTS.checksPerTrade.value)],
      ["TYPED REFUSALS", "refusalCount", String(FACTS.refusalCount.value)],
      ["RULE TIMELOCK", "timelockHours", `${FACTS.timelockHours.value}h`],
    ] as const;
    for (const [label, fact, value] of plate) {
      const dt = screen.getByText(label);
      expect(dt.tagName).toBe("DT");
      expect(classes(dt)).toEqual(expect.arrayContaining(["font-mono", "text-[11px]", "tracking-[0.12em]", "text-label"]));
      const dd = dt.nextElementSibling!;
      expect(dd.tagName).toBe("DD");
      expect(dd).toHaveAttribute("data-fact", fact);
      expect(dd.textContent).toBe(value);
    }
  });

  it("sets .h2 at clamp(32px, 3.6vw, 52px) and -0.045em, balanced", () => {
    expect(css).toMatch(
      /\.h2\s*\{\s*margin:\s*0;\s*font-size:\s*clamp\(32px, 3\.6vw, 52px\);\s*line-height:\s*1\.02;\s*letter-spacing:\s*-0\.045em;\s*font-weight:\s*600;\s*text-wrap:\s*balance;\s*\}/,
    );
  });
});
