import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SCAN_MS, scanOnce, useScan } from "@/components/instrument/useScan";

/** An IntersectionObserver the test drives: fire() reports every target in or out of view. */
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
  fire(isIntersecting: boolean) {
    const entries = this.targets.map((target) => ({ target, isIntersecting }) as IntersectionObserverEntry);
    this.callback(entries, this as unknown as IntersectionObserver);
  }
}

const animate = vi.fn<Element["animate"]>(() => ({}) as Animation);

/** matchMedia answering `reduce` for the reduced-motion query, and Element.prototype.animate as a spy. */
function stubMotion(reduce: boolean, withAnimate = true) {
  vi.stubGlobal("matchMedia", (media: string) => ({ matches: reduce, media, addEventListener() {}, removeEventListener() {} }));
  if (withAnimate) Element.prototype.animate = animate as unknown as Element["animate"];
}

let visibility: DocumentVisibilityState = "visible";

afterEach(() => {
  vi.unstubAllGlobals();
  delete (Element.prototype as { animate?: unknown }).animate;
  delete (document as { visibilityState?: unknown }).visibilityState;
  animate.mockClear();
  FakeIO.all = [];
  visibility = "visible";
});

function Probe({ k, held }: { k: number | null; held: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLSpanElement>(null);
  useScan(box, line, k, held);
  return (
    <div ref={box}>
      <span ref={line} data-scan="" />
    </div>
  );
}

/** The probe with a 120 px window, its first reading (key 1000) shown, and the observer's first report given. */
function mount(onScreen: boolean) {
  const r = render(<Probe k={null} held={false} />);
  Object.defineProperty(r.container.firstElementChild!, "clientHeight", { configurable: true, value: 120 });
  r.rerender(<Probe k={1_000} held={false} />);
  const io = FakeIO.all[0];
  if (io) act(() => io.fire(onScreen));
  return r;
}

describe("scanOnce (spec 2026-11-23 section 8.3: scan, 400 ms, once per read)", () => {
  it("draws nothing under reduced motion", () => {
    stubMotion(true);
    expect(scanOnce(document.createElement("span"), 100)).toBeNull();
    expect(animate).not.toHaveBeenCalled();
  });

  it("draws nothing where Element.prototype.animate is missing", () => {
    stubMotion(false, false);
    expect(scanOnce(document.createElement("span"), 100)).toBeNull();
  });

  it("runs one linear pass down the window, visible only while it runs", () => {
    stubMotion(false);
    scanOnce(document.createElement("span"), 118);
    expect(SCAN_MS).toBe(400);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenCalledWith(
      [
        { transform: "translateY(0)", visibility: "visible" },
        { transform: "translateY(118px)", visibility: "visible" },
      ],
      { duration: SCAN_MS, easing: "linear" },
    );
  });
});

describe("useScan (spec section 8.1 rule 4: pause what nobody sees)", () => {
  it("scans once per new reading while on screen, never for the first reading", () => {
    vi.stubGlobal("IntersectionObserver", FakeIO);
    stubMotion(false);
    const r = mount(true);
    expect(animate).not.toHaveBeenCalled();
    r.rerender(<Probe k={31_000} held={false} />);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0]![0]).toEqual([
      { transform: "translateY(0)", visibility: "visible" },
      { transform: "translateY(118px)", visibility: "visible" },
    ]);
    r.rerender(<Probe k={31_000} held={false} />);
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("stays still off screen, while held, and on a hidden tab", () => {
    vi.stubGlobal("IntersectionObserver", FakeIO);
    stubMotion(false);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    const r = mount(false);
    r.rerender(<Probe k={31_000} held={false} />);
    act(() => FakeIO.all[0]!.fire(true));
    r.rerender(<Probe k={61_000} held />);
    visibility = "hidden";
    r.rerender(<Probe k={91_000} held={false} />);
    expect(animate).not.toHaveBeenCalled();
  });

  it("runs nothing where IntersectionObserver is missing", () => {
    stubMotion(false);
    const r = mount(true);
    r.rerender(<Probe k={31_000} held={false} />);
    expect(FakeIO.all).toHaveLength(0);
    expect(animate).not.toHaveBeenCalled();
  });

  it("disconnects its observer when it unmounts", () => {
    vi.stubGlobal("IntersectionObserver", FakeIO);
    stubMotion(false);
    mount(true).unmount();
    expect(FakeIO.all[0]!.disconnected).toBe(true);
  });
});
