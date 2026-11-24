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
  options: IntersectionObserverInit | undefined;
  targets: Element[] = [];
  disconnected = false;
  /** Whether each target was in the root at its last layout. */
  seen = new Map<Element, boolean>();
  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
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
  /** Reports `target` in or out of view, its bottom edge at `bottom` px against a root whose top is `rootTop`. */
  report(target: Element, isIntersecting: boolean, bottom = 0, rootTop = 0) {
    const entry = {
      target,
      isIntersecting,
      boundingClientRect: { bottom } as DOMRectReadOnly,
      rootBounds: { top: rootTop } as DOMRectReadOnly,
    } as IntersectionObserverEntry;
    act(() => this.callback([entry], this as unknown as IntersectionObserver));
  }
  /**
   * Lays `target` out from `top` to `bottom` px and reports it as a real observer with the default threshold does: on
   * its first layout, then only when it enters or leaves the root, the viewport grown by the observer's rootMargin
   * (px only). A jump that leaves a target out of the root on both sides is never reported.
   */
  layout(target: Element, top: number, bottom: number) {
    const margin = (this.options?.rootMargin ?? "0px").split(/\s+/).map((v) => Number.parseFloat(v));
    const marginTop = margin[0] ?? 0;
    const root = { top: -marginTop, bottom: window.innerHeight + (margin[2] ?? marginTop) };
    const isIntersecting = bottom >= root.top && top <= root.bottom;
    if (this.seen.get(target) === isIntersecting) return;
    this.seen.set(target, isIntersecting);
    this.report(target, isIntersecting, bottom, root.top);
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
    /** The observer that watches the CTAs. */
    io: () => FakeIO.all.find((o) => o.targets.some((t) => t.hasAttribute("data-hero-cta")))!,
    /** The observer that watches #try (and the footer). */
    pageIo: () => FakeIO.all.find((o) => o.targets.some((t) => t.id === "try"))!,
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

  it("watches the CTAs on a root that reaches far below the screen, and #try and the footer on the screen", async () => {
    const ui = await mount();
    expect(ui.io().targets).toEqual([ui.verify, ui.tryCta]);
    expect(ui.io().options?.rootMargin).toBe("0px 0px 100000px 0px");
    expect(ui.pageIo().targets).toEqual([ui.section, ui.footer]);
    expect(ui.pageIo().options?.rootMargin).toBeUndefined();
  });

  it("shows after one jump from below the screen to past the CTAs, which a real observer reports", async () => {
    const ui = await mount();
    const fold = window.innerHeight;
    // The first layout, as at 390x844: both CTAs just below the first screen, #try and the footer far below it.
    ui.io().layout(ui.verify, fold + 33, fold + 85);
    ui.io().layout(ui.tryCta, fold + 98, fold + 150);
    ui.pageIo().layout(ui.section, fold + 6000, fold + 7000);
    ui.pageIo().layout(ui.footer, fold + 12_000, fold + 12_400);
    expect(ui.bar()).toBeNull();
    // One instant jump to #how, as a fragment link under reduced motion or find-in-page makes: no frame in between.
    ui.io().layout(ui.verify, -3199, -3147);
    ui.io().layout(ui.tryCta, -3134, -3082);
    ui.pageIo().layout(ui.section, 2000, 3000);
    expect(ui.bar()).toHaveAttribute("data-thumb-bar", "shown");
    // One jump back to the hero, and one down again.
    ui.io().layout(ui.verify, fold + 33, fold + 85);
    ui.io().layout(ui.tryCta, fold + 98, fold + 150);
    expect(ui.bar()).toHaveAttribute("data-thumb-bar", "hidden");
    ui.io().layout(ui.verify, -3199, -3147);
    ui.io().layout(ui.tryCta, -3134, -3082);
    expect(ui.bar()).toHaveAttribute("data-thumb-bar", "shown");
  });

  it("hides, inert, while #try or the footer is in view, and comes back after", async () => {
    const ui = await mount();
    scrollPast(ui);
    ui.pageIo().report(ui.section, true);
    expect(ui.bar()).toHaveAttribute("data-thumb-bar", "hidden");
    expect(ui.bar()).toHaveAttribute("inert");
    ui.pageIo().report(ui.section, false);
    expect(ui.bar()).toHaveAttribute("data-thumb-bar", "shown");
    ui.pageIo().report(ui.footer, true);
    expect(ui.bar()).toHaveAttribute("data-thumb-bar", "hidden");
    ui.pageIo().report(ui.footer, false);
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

  it("disconnects both its observers when the page unmounts", async () => {
    const ui = await mount();
    const [ctaIo, pageIo] = [ui.io(), ui.pageIo()];
    ui.unmount();
    expect(ctaIo.disconnected).toBe(true);
    expect(pageIo.disconnected).toBe(true);
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
