import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** An IntersectionObserver stand-in that records what it watches and lets a test report intersections. */
class FakeObserver {
  static made: FakeObserver[] = [];
  readonly watched = new Set<Element>();
  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit,
  ) {
    FakeObserver.made.push(this);
  }
  observe(el: Element) {
    this.watched.add(el);
  }
  unobserve(el: Element) {
    this.watched.delete(el);
  }
  disconnect() {
    this.watched.clear();
  }
  /** Reports `el` crossing into (or out of) the band. */
  report(el: Element, isIntersecting: boolean) {
    this.callback([{ target: el, isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

/** A fresh copy of the module, so each test starts with no shared observer. */
async function load() {
  vi.resetModules();
  return import("@/lib/motion/once-in-view");
}

beforeEach(() => {
  FakeObserver.made = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("onceInView (lib/motion/once-in-view.ts)", () => {
  it("sets data-seen at once where IntersectionObserver is missing, as in jsdom", async () => {
    const { onceInView } = await load();
    expect(typeof IntersectionObserver).toBe("undefined");
    const el = document.createElement("div");
    const stop = onceInView(el);
    expect(el).toHaveAttribute("data-seen", "");
    expect(() => stop()).not.toThrow();
  });

  it("watches every element through one observer, with the spec's band", async () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const { onceInView, SEEN_ROOT_MARGIN } = await load();
    const a = document.createElement("div");
    const b = document.createElement("div");
    onceInView(a);
    onceInView(b);
    expect(FakeObserver.made).toHaveLength(1);
    expect(FakeObserver.made[0]!.options).toEqual({ rootMargin: "100000px 0px -12% 0px" });
    expect(SEEN_ROOT_MARGIN).toBe("100000px 0px -12% 0px");
    expect([...FakeObserver.made[0]!.watched]).toEqual([a, b]);
    expect(a).not.toHaveAttribute("data-seen");
  });

  it("marks an element seen when it enters the band, then stops watching it", async () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const { onceInView } = await load();
    const el = document.createElement("div");
    onceInView(el);
    const io = FakeObserver.made[0]!;
    io.report(el, false);
    expect(el).not.toHaveAttribute("data-seen");
    io.report(el, true);
    expect(el).toHaveAttribute("data-seen", "");
    expect(io.watched.has(el)).toBe(false);
  });

  it("leaves an element already seen alone, and its cleanup stops watching", async () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const { onceInView } = await load();
    const seen = document.createElement("div");
    seen.setAttribute("data-seen", "");
    onceInView(seen);
    expect(FakeObserver.made).toHaveLength(0);
    const el = document.createElement("div");
    const stop = onceInView(el);
    expect(FakeObserver.made[0]!.watched.has(el)).toBe(true);
    stop();
    expect(FakeObserver.made[0]!.watched.has(el)).toBe(false);
  });
});
