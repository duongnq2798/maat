import { readFileSync } from "node:fs";
import { act, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import Page from "@/app/(site)/page";
import { ThumbBar, thumbLamp, thumbShown } from "@/components/instrument/ThumbBar";
import { LiveSnapshotProvider } from "@/components/live/LiveSnapshotProvider";
import { LiveStrip } from "@/components/live/LiveStrip";
import { classify } from "@/lib/live/freshness";
import type { LiveReader } from "@/lib/live/rpc";
import { type Answer, advance, fakeReader, FRI, installLiveClocks, readingAt, SAT } from "./helpers/fake-reader";
import { passingBasket } from "./helpers/live";

installLiveClocks();

const css = readFileSync("app/globals.css", "utf8");

/** An IntersectionObserver the test drives, one entry at a time. */
class FakeIO {
  static all: FakeIO[] = [];
  callback: IntersectionObserverCallback;
  targets: Element[] = [];
  disconnected = false;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeIO.all.push(this);
  }
  observe(el: Element) {
    this.targets.push(el);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  takeRecords() {
    return [];
  }
  /** Reports `target` in or out of view, its bottom edge at `bottom` px against a viewport whose top is 0. */
  report(target: Element, isIntersecting: boolean, bottom = 0) {
    const entry = {
      target,
      isIntersecting,
      boundingClientRect: { bottom } as DOMRectReadOnly,
      rootBounds: { top: 0 } as DOMRectReadOnly,
    } as IntersectionObserverEntry;
    act(() => this.callback([entry], this as unknown as IntersectionObserver));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeIO.all = [];
});

/** The landing's parts the bar knows: the strip, both CTAs, #try, the footer, then the bar, on one provider. */
function Landing({ reader }: { reader: LiveReader }) {
  return (
    <LiveSnapshotProvider reader={reader}>
      <LiveStrip />
      <a data-hero-cta="" href="/quickstart">
        Verify it in 5 minutes
      </a>
      <a data-hero-cta="" href="#try">
        Try to make it say no
      </a>
      <section id="try" />
      <footer />
      <ThumbBar />
    </LiveSnapshotProvider>
  );
}

async function mount(first: Answer = { timestamp: SAT }, wallSec = SAT + 14, observer = true) {
  if (observer) vi.stubGlobal("IntersectionObserver", FakeIO);
  vi.setSystemTime(wallSec * 1000);
  const fake = fakeReader(first);
  const { container, unmount } = render(<Landing reader={fake.reader} />);
  await advance(0);
  const [verify, tryCta] = [...container.querySelectorAll("[data-hero-cta]")];
  return {
    fake,
    unmount,
    io: () => FakeIO.all.find((o) => o.targets.some((t) => t.hasAttribute("data-hero-cta")))!,
    verify: verify!,
    tryCta: tryCta!,
    section: container.querySelector("#try")!,
    footer: container.querySelector("footer")!,
    bar: () => container.querySelector<HTMLElement>("[data-thumb-bar]"),
  };
}

/** Both CTAs scrolled out above the viewport. */
function scrollPast(ui: Awaited<ReturnType<typeof mount>>) {
  ui.io().report(ui.verify, false, -60);
  ui.io().report(ui.tryCta, false, -8);
}

describe("the ThumbBar (spec 2026-11-23 sections 6.2 and 11 item 12)", () => {
  it("shows only when both CTAs are above the viewport and neither #try nor the footer is in view", () => {
    expect(thumbShown({ ctasAbove: true, tryInView: false, footerInView: false })).toBe(true);
    expect(thumbShown({ ctasAbove: false, tryInView: false, footerInView: false })).toBe(false);
    expect(thumbShown({ ctasAbove: true, tryInView: true, footerInView: false })).toBe(false);
    expect(thumbShown({ ctasAbove: true, tryInView: false, footerInView: true })).toBe(false);
  });

  it("lights its lamp from a live reading only: PASS when the basket passes, REFUSE otherwise", () => {
    const sat = readingAt(SAT, { wallAtReadSec: SAT + 14 });
    const pass = readingAt(FRI, { edit: passingBasket, wallAtReadSec: FRI + 14 });
    expect(thumbLamp(undefined)).toBe("reading");
    expect(thumbLamp({ status: "reading" })).toBe("reading");
    expect(thumbLamp({ status: "error", message: "HTTP 503" })).toBe("reading");
    expect(thumbLamp(classify(sat, false, 0, SAT + 14))).toBe("refuse");
    expect(thumbLamp(classify(pass, false, 0, FRI + 14))).toBe("pass");
    expect(thumbLamp(classify(sat, true, 30_000, SAT + 44))).toBe("reading");
  });

  it("renders nothing until both hero CTAs have scrolled out above the viewport", async () => {
    const ui = await mount();
    expect(ui.bar()).toBeNull();
    ui.io().report(ui.verify, false, -60);
    expect(ui.bar()).toBeNull();
    ui.io().report(ui.tryCta, false, -8);
    const bar = ui.bar()!;
    expect(bar).toHaveAttribute("data-thumb-bar", "shown");
    expect(bar).not.toHaveAttribute("inert");
    const link = bar.querySelector("a")!;
    expect(link).toHaveAttribute("href", "#try");
    expect(link).toHaveTextContent("Try to make it say no");
  });

  it("never shows for CTAs below the viewport, which the page has not reached yet", async () => {
    const ui = await mount();
    ui.io().report(ui.verify, false, 900);
    ui.io().report(ui.tryCta, false, 960);
    expect(ui.bar()).toBeNull();
  });

  it("hides, inert, while #try or the footer is in view, and comes back after", async () => {
    const ui = await mount();
    scrollPast(ui);
    ui.io().report(ui.section, true);
    expect(ui.bar()).toHaveAttribute("data-thumb-bar", "hidden");
    expect(ui.bar()).toHaveAttribute("inert");
    ui.io().report(ui.section, false);
    expect(ui.bar()).toHaveAttribute("data-thumb-bar", "shown");
    ui.io().report(ui.footer, true);
    expect(ui.bar()).toHaveAttribute("data-thumb-bar", "hidden");
    ui.io().report(ui.footer, false);
    expect(ui.bar()).toHaveAttribute("data-thumb-bar", "shown");
  });

  it("lights its lamp from the page's one reading, beside the strip, on one read loop", async () => {
    const ui = await mount();
    scrollPast(ui);
    expect(ui.bar()!.querySelector("[data-lamp]")).toHaveAttribute("data-lamp", "refuse");
    expect(ui.fake.multicalls()).toBe(1);
  });

  it("renders nothing where IntersectionObserver is missing", async () => {
    const ui = await mount({ timestamp: SAT }, SAT + 14, false);
    expect(ui.bar()).toBeNull();
    expect(FakeIO.all).toHaveLength(0);
  });

  it("disconnects its observer when the page unmounts", async () => {
    const ui = await mount();
    const io = ui.io();
    ui.unmount();
    expect(io.disconnected).toBe(true);
  });

  it("keeps the landing's static HTML free of the bar, of lit lamps and of refusals", { timeout: 60_000 }, () => {
    const html = renderToString(<Page />);
    expect(html).not.toContain("data-thumb-bar");
    expect(html).not.toContain("REFUSE");
    expect(html).not.toMatch(/data-lamp="(pass|refuse)"/);
    expect(html.match(/data-live-strip=/g)).toHaveLength(1);
    expect(html).toContain('data-live-strip="reading"');
  });

  it("slides over --t-flip, and appears without sliding under reduced motion", () => {
    expect(css).toMatch(
      /\[data-thumb-bar\]\s*\{\s*transition:\s*translate var\(--t-flip\) var\(--ease-instrument\), visibility var\(--t-flip\);\s*\}/,
    );
    expect(css).toMatch(/\[data-thumb-bar="hidden"\]\s*\{\s*translate:\s*0 100%;\s*visibility:\s*hidden;\s*\}/);
    expect(css).toMatch(/@starting-style\s*\{\s*\[data-thumb-bar="shown"\]\s*\{\s*translate:\s*0 100%;\s*\}\s*\}/);
  });
});
