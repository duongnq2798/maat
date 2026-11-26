// What the Monday data PR commits: edition 1, whose windows start on a Wednesday before a holiday and after a Friday
// early close, measured, with the vault's Decisions in each. The edition is made up from edition 0 (helpers/gap-edition.ts),
// never written to disk, and published here beside the committed files, so the page, the file checks and every page test
// run on it before it exists.
import { render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Page, { metadata } from "@/app/(site)/gap-index/page";
import { GapWindow } from "@/components/gap/GapWindow";
import { closureNote, decisionsSentence, PUBLISHED } from "@/content/gap-index";
import { EDITIONS, editionWindows } from "@/content/gap-index/editions";
import { checkGapIndexPage } from "@/lib/check-out";
import { DECISION_TOPIC, decisionCounts, type WindowDecision } from "@/lib/gap/decisions";
import type { Decisions, EditionFile } from "@/lib/gap/schema";
import { closedWindows } from "@/lib/gap/windows";
import { SITE } from "@/lib/site";
import { editionFileChecks } from "./helpers/gap-edition";

vi.mock("@/content/gap-index", async (importActual) => {
  const real = await importActual<typeof import("@/content/gap-index")>();
  const { syntheticEdition1 } = await import("./helpers/gap-edition");
  return { ...real, PUBLISHED: [syntheticEdition1(real.PUBLISHED.find((e) => e.edition === 0)!), ...real.PUBLISHED] };
});

type Complete = Extract<EditionFile["windows"][number], { status: "complete" }>;

const decisions = (list: Pick<WindowDecision, "sender" | "reason">[]): Decisions => {
  const full = list.map((d, i) => ({ block: i + 1, logIndex: 0, ts: i + 1, tx: `0x${(i + 1).toString(16).padStart(64, "0")}`, allowed: d.reason === "OK", ...d }));
  return { vault: `0x${"5a".repeat(20)}`, topic: DECISION_TOPIC, ...decisionCounts(full), list: full };
};

describe("what closed a window", () => {
  it("says nothing for a plain weekend, a Friday close to a Monday open, as every edition 0 window is", () => {
    for (const w of editionWindows(EDITIONS[0]!)) expect(closureNote(w), w.id).toBeNull();
  });

  it("names the holiday of a window that starts on a Wednesday, with its length", () => {
    expect(closureNote(editionWindows(EDITIONS[1]!)[0]!)).toBe("Thanksgiving, Thu 26 Nov · 41.50 h closed");
  });

  it("names the early close a window follows, then the weekend", () => {
    expect(closureNote(editionWindows(EDITIONS[1]!)[1]!)).toBe("Early close at 13:00 ET, then the weekend · 68.50 h closed");
  });

  it("names an early close, a holiday and the weekend in order, and a window across a month end", () => {
    expect(closureNote(closedWindows("2026-12-24", "2026-12-24")[0]!)).toBe("Early close at 13:00 ET, then Christmas, Fri 25 Dec, then the weekend · 92.50 h closed");
    expect(closureNote(closedWindows("2026-12-31", "2026-12-31")[0]!)).toBe("New Year, Fri 1 Jan, then the weekend · 89.50 h closed");
    expect(closureNote(closedWindows("2027-01-15", "2027-01-15")[0]!)).toBe("The weekend, then Martin Luther King Jr. Day, Mon 18 Jan · 89.50 h closed");
  });
});

describe("the Decisions line", () => {
  it("says when the vault recorded no Decision", () => {
    expect(decisionsSentence(decisions([]))).toBe("The vault recorded no Decision in this window.");
  });

  it("counts them by sender and says the vault refused every one with MARKET_CLOSED", () => {
    const closed = { reason: "MARKET_CLOSED" } as const;
    expect(decisionsSentence(decisions([{ sender: "agent", ...closed }]))).toBe(
      "The vault recorded 1 Decision in this window: 1 from the agent. It refused it with MARKET_CLOSED.",
    );
    expect(decisionsSentence(decisions([{ sender: "agent", ...closed }, { sender: "probe", ...closed }]))).toBe(
      "The vault recorded 2 Decisions in this window: 1 from the agent and 1 probe. It refused both with MARKET_CLOSED.",
    );
    expect(
      decisionsSentence(
        decisions([
          { sender: "agent", ...closed },
          { sender: "agent", ...closed },
          { sender: "probe", ...closed },
          { sender: "brief", ...closed },
          { sender: "owner", ...closed },
        ]),
      ),
    ).toBe("The vault recorded 5 Decisions in this window: 2 from the agent, 1 probe, 1 brief-driven and 1 from the owner by hand. It refused all 5 with MARKET_CLOSED.");
  });

  it("says, by sender, how many were refused with MARKET_CLOSED when not every one was", () => {
    expect(
      decisionsSentence(
        decisions([
          { sender: "agent", reason: "MARKET_CLOSED" },
          { sender: "agent", reason: "MARKET_CLOSED" },
          { sender: "owner", reason: "OK" },
          { sender: "unlabelled", reason: "FEED_STALE" },
        ]),
      ),
    ).toBe(
      "The vault recorded 4 Decisions in this window: 2 from the agent, 1 from the owner by hand and 1 through another contract. Refused with MARKET_CLOSED: 2 of the 2 from the agent, 0 of the 1 from the owner by hand and 0 of the 1 through another contract.",
    );
  });
});

describe("a window that starts on a weekday, on the page", () => {
  const e1 = PUBLISHED.find((e) => e.edition === 1)!;
  const e0 = PUBLISHED.find((e) => e.edition === 0)!;
  const [thanksgiving, weekend] = e1.windows as Complete[];

  it("publishes the made-up edition 1 first, both windows measured", () => {
    expect(PUBLISHED.map((e) => e.edition)).toEqual([1, 0]);
    expect(e1.windows.map((w) => [w.id, w.status])).toEqual([
      ["2026-11-25", "complete"],
      ["2026-11-27", "complete"],
    ]);
  });

  it("heads the Wednesday window with its days, notes the holiday, and says the vault recorded no Decision", () => {
    const s = render(<GapWindow w={thanksgiving!} edition={1} />).container.querySelector("section")!;
    expect(s.querySelector("[data-window-headline]")!.textContent).toMatch(/^Wed 25 Nov 16:00 ET → Fri 27 Nov 09:30 ET · window 2026-11-25 · blocks /);
    expect(s.querySelector("[data-window-note]")!.textContent).toBe("Thanksgiving, Thu 26 Nov · 41.50 h closed");
    expect(s.querySelector("[data-window-decisions]")!.textContent).toBe("The vault recorded no Decision in this window.");
  });

  it("notes the early close of the weekend window and prints its Decisions line, with a link to /ledger", () => {
    const s = render(<GapWindow w={weekend!} edition={1} />).container.querySelector("section")!;
    expect(s.querySelector("[data-window-headline]")!.textContent).toMatch(/^Fri 27 Nov 13:00 ET → Mon 30 Nov 09:30 ET · window 2026-11-27 · blocks /);
    expect(s.querySelector("[data-window-note]")!.textContent).toBe("Early close at 13:00 ET, then the weekend · 68.50 h closed");
    const line = s.querySelector<HTMLElement>("[data-window-decisions]")!;
    expect(line.textContent).toBe(
      "The vault recorded 3 Decisions in this window: 2 from the agent and 1 probe. It refused all 3 with MARKET_CLOSED. Each one is on the ledger.",
    );
    expect(line.querySelector("a")).toHaveAttribute("href", "/ledger");
  });

  it("notes a pending weekday window too, with no Decisions line", () => {
    const w = { status: "pending" as const, ...editionWindows(EDITIONS[1]!)[1]! };
    const s = render(<GapWindow w={w} edition={1} />).container.querySelector("section")!;
    expect(s.querySelector("[data-window-note]")!.textContent).toBe("Early close at 13:00 ET, then the weekend · 68.50 h closed");
    expect(s.querySelector("[data-window-decisions]")).toBeNull();
  });

  it("leaves every edition 0 window as it was: no note and no Decisions line", () => {
    for (const w of e0.windows) {
      const s = render(<GapWindow w={w} edition={0} />).container.querySelector("section")!;
      expect(s.querySelector("[data-window-note], [data-window-decisions]"), w.id).toBeNull();
    }
  });

  it("says in its method how Decisions are read, once an edition has them", () => {
    const html = renderToString(<Page />);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const method = doc.querySelector("section#method")!.textContent!;
    expect(method).toContain(DECISION_TOPIC);
    expect(method).toContain("eth_getTransactionByHash");
    expect(method).toContain("as /ledger labels it");
  });

  it("passes the export check", () => {
    const html = [
      `<!DOCTYPE html><html lang="en"><head><title>Weekend Gap Index · ${SITE.name}</title>`,
      `<meta name="description" content="${metadata.description}"/>`,
      '<link rel="canonical" href="https://maat.example/gap-index"/>',
      '<meta property="og:image" content="https://maat.example/opengraph-image.png"/></head><body>',
      renderToString(<Page />),
      "</body></html>",
    ].join("");
    expect(checkGapIndexPage(html)).toEqual([]);
  });
});

// The checks every committed file gets, on the made-up edition 1.
editionFileChecks("edition-1.json", PUBLISHED.find((e) => e.edition === 1));

// And every test of the page, run again with edition 1 published.
await import("./gap-page.test");
