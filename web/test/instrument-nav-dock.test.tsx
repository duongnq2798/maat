import { readFileSync } from "node:fs";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveSnapshotProvider } from "@/components/live/LiveSnapshotProvider";
import { NavBar, NavDock } from "@/components/live/NavDock";
import { Nav } from "@/components/sections/Nav";
import { formatBlock } from "@/lib/live/format";
import { SITE } from "@/lib/site";
import { advance, BLOCK, fakeReader, installLiveClocks, SAT } from "./helpers/fake-reader";

installLiveClocks();

// Read by path from web/, where vitest runs, as the other jsdom tests do: under jsdom, Vite resolves
// new URL(..., import.meta.url) to an http URL.
const read = (rel: string) => readFileSync(rel, "utf8");
const css = read("app/globals.css");

/** An IntersectionObserver the test drives. */
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
  report(target: Element, isIntersecting: boolean) {
    const entry = { target, isIntersecting } as IntersectionObserverEntry;
    act(() => this.callback([entry], this as unknown as IntersectionObserver));
  }
}

const observing = (el: Element) => FakeIO.all.find((o) => o.targets.includes(el))!;
const setScrollY = (y: number) => Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: y });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  FakeIO.all = [];
  setScrollY(0);
});

describe("the nav bar and its docked reading (spec 2026-11-23 sections 6.1 and 7.5)", () => {
  it("marks the bar once the page has scrolled, from one passive listener that it removes on unmount", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    setScrollY(0);
    const { container, unmount } = render(
      <NavBar>
        <span />
      </NavBar>,
    );
    const bar = container.querySelector("[data-nav-bar]")!;
    expect(bar).not.toHaveAttribute("data-scrolled");
    setScrollY(120);
    fireEvent.scroll(window);
    expect(bar).toHaveAttribute("data-scrolled", "");
    setScrollY(0);
    fireEvent.scroll(window);
    expect(bar).not.toHaveAttribute("data-scrolled");
    const listener = add.mock.calls.find(([type]) => type === "scroll");
    expect(listener?.[2]).toEqual({ passive: true });
    unmount();
    expect(remove).toHaveBeenCalledWith("scroll", listener?.[1]);
  });

  it("docks the page's live reading once #top has left the screen, on the page's one read loop", async () => {
    vi.stubGlobal("IntersectionObserver", FakeIO);
    vi.setSystemTime((SAT + 14) * 1000);
    const fake = fakeReader({ timestamp: SAT });
    const { container } = render(
      <LiveSnapshotProvider reader={fake.reader}>
        <header id="top" />
        <NavDock />
      </LiveSnapshotProvider>,
    );
    await advance(0);
    const top = container.querySelector("#top")!;
    const dock = () => container.querySelector<HTMLElement>("[data-nav-dock]");
    observing(top).report(top, true);
    expect(dock()).toBeNull();
    observing(top).report(top, false);
    expect(dock()).toHaveTextContent(`● ${formatBlock(BLOCK)} · Saturday · NYSE closed`);
    expect(dock()).toHaveAttribute("aria-hidden", "true");
    expect(dock()!.className.split(" ")).toEqual(expect.arrayContaining(["hidden", "xl:inline-flex"]));
    // One row, at most 340 px: a longer detail ("MarketCalendar unreadable · counted closed") is cut short with an
    // ellipsis instead of wrapping the bar onto a second row.
    expect(dock()!.className.split(" ")).toEqual(expect.arrayContaining(["max-w-[340px]", "whitespace-nowrap"]));
    expect(dock()!.lastElementChild!.className.split(" ")).toEqual(expect.arrayContaining(["min-w-0", "truncate"]));
    observing(top).report(top, true);
    expect(dock()).toBeNull();
    expect(fake.multicalls()).toBe(1);
  });

  it("docks nothing for a reading that is not live, nor without a provider or an observer", async () => {
    vi.stubGlobal("IntersectionObserver", FakeIO);
    vi.setSystemTime((SAT + 14) * 1000);
    const fake = fakeReader({ timestamp: SAT });
    fake.hold();
    const reading = render(
      <LiveSnapshotProvider reader={fake.reader}>
        <header id="top" />
        <NavDock />
      </LiveSnapshotProvider>,
    );
    await advance(0);
    const top = reading.container.querySelector("#top")!;
    observing(top).report(top, false);
    expect(reading.container.querySelector("[data-nav-dock]")).toBeNull();
    reading.unmount();
    expect(FakeIO.all.every((o) => o.disconnected)).toBe(true);

    const alone = render(
      <>
        <header id="top" />
        <NavDock />
      </>,
    );
    const aloneTop = alone.container.querySelector("#top")!;
    observing(aloneTop).report(aloneTop, false);
    expect(alone.container.querySelector("[data-nav-dock]")).toBeNull();
    alone.unmount();

    vi.stubGlobal("IntersectionObserver", undefined);
    FakeIO.all = [];
    render(
      <>
        <header id="top" />
        <NavDock />
      </>,
    );
    expect(FakeIO.all).toHaveLength(0);
    expect(document.querySelector("[data-nav-dock]")).toBeNull();
  });

  it("wraps the nav in the bar, lists the pages in the bar and then in the phone menu, and docks the reading on the landing only", () => {
    render(<Nav askOpen={false} />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(nav.parentElement).toHaveAttribute("data-nav-bar");
    const pages = [
      ["Now", "/now"],
      ["Gap Index", "/gap-index"],
      ["Ledger", "/ledger"],
      ["Docs", SITE.docsUrl],
    ];
    expect(within(nav).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["maat", "#top"],
      ...pages,
      ...pages,
      ["View on GitHub ↗", SITE.repoUrl],
    ]);
    expect(read("components/sections/Nav.tsx")).toContain("{onLanding ? <NavDock /> : null}");
  });

  it("draws the hairline on the 120 ms tick, and from lg pads the scrollport below the pinned bar, on pages that have it", () => {
    expect(css).toMatch(
      /\.nav-bar\s*\{\s*border-bottom:\s*1px solid transparent;\s*transition:\s*border-color var\(--t-tick\) var\(--ease-instrument\);\s*\}/,
    );
    expect(css).toMatch(/\.nav-bar\[data-scrolled\]\s*\{\s*border-bottom-color:\s*var\(--color-line\);\s*\}/);
    expect(css).toMatch(
      /@layer base\s*\{\s*@media \(min-width: 64rem\)\s*\{\s*html:has\(\[data-nav-bar\]\)\s*\{\s*scroll-padding-top:\s*82px;\s*\}\s*\}\s*\}/,
    );
    // The padding offsets focus as well as anchors; an [id] margin offsets anchors only, so none is added on top of it.
    expect(css).not.toMatch(/html:has\(\[data-nav-bar\]\) \[id\]/);
  });
});
