import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DecisionEngine } from "@/components/DecisionEngine";
import { beginTipDrag, TIP_MAX_DEG, type TipTarget, tipTarget } from "@/components/instrument/useTipDrag";
import { MOMENTS } from "@/content/engine";

// Read from web/, where vitest runs: under jsdom, import.meta.url is not a file URL.
const css = readFileSync("app/globals.css", "utf8");
const src = readFileSync("components/DecisionEngine.tsx", "utf8");
const CAPTION = "Only the nine checks move this beam.";

/** jsdom may have no PointerEvent: a MouseEvent with a pointerId is all the drag and React read. */
class FakePointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
    super(type, { bubbles: true, cancelable: true, ...init });
    this.pointerId = init.pointerId ?? 1;
  }
}

const send = (target: EventTarget, type: string, clientX: number, pointerId = 1) =>
  target.dispatchEvent(new FakePointerEvent(type, { clientX, pointerId }));

/** A Balance the drag writes to: each --tilt written, the attributes set, and how many animations were cancelled. */
function stubBalance() {
  const writes: number[] = [];
  const attrs = new Map<string, string>();
  let tilt: string | null = null;
  let cancelled = 0;
  const svg: TipTarget = {
    style: {
      setProperty: (name: string, value: string | null) => {
        if (name !== "--tilt" || value === null) return;
        tilt = value;
        writes.push(Number.parseFloat(value));
      },
      removeProperty: (name: string) => {
        if (name === "--tilt") tilt = null;
        return "";
      },
    },
    setAttribute: (name, value) => void attrs.set(name, value),
    removeAttribute: (name) => void attrs.delete(name),
    getAnimations: () => [{ cancel: () => void cancelled++ }, { cancel: () => void cancelled++ }],
  };
  return { svg, writes, attrs, tilt: () => tilt, cancelled: () => cancelled };
}

/** requestAnimationFrame as a queue the test runs: one frame every `stepMs`. */
function frameQueue() {
  const queue = new Map<number, FrameRequestCallback>();
  let id = 0;
  let now = 0;
  return {
    raf: (cb: FrameRequestCallback) => {
      queue.set(++id, cb);
      return id;
    },
    caf: (n: number) => void queue.delete(n),
    pending: () => queue.size,
    /** Runs frames until none is asked for, or `max` have run, and says how many ran. */
    run(stepMs = 1000 / 60, max = 1000) {
      let ran = 0;
      while (queue.size > 0 && ran < max) {
        now += stepMs;
        const due = [...queue.values()];
        queue.clear();
        for (const cb of due) cb(now);
        ran++;
      }
      return ran;
    },
  };
}

function start(restDeg = 0, startX = 100) {
  const balance = stubBalance();
  const frames = frameQueue();
  const zone = document.createElement("div");
  const onEnd = vi.fn();
  const drag = beginTipDrag({ svg: balance.svg, zone, pointerId: 1, startX, restDeg, raf: frames.raf, caf: frames.caf, onEnd });
  return { ...balance, frames, zone, onEnd, drag };
}

describe("beginTipDrag (spec 2026-11-23 sections 6.1 and 8.1, amendment A5)", () => {
  it("pulls the beam softly, and never past ±14°", () => {
    expect(tipTarget(0, 0)).toBe(0);
    expect(tipTarget(-6, 0)).toBe(-6);
    expect(tipTarget(0, 60)).toBeCloseTo(TIP_MAX_DEG * Math.tanh(1), 9);
    expect(tipTarget(0, 30)).toBeLessThan(tipTarget(0, 60));
    expect(tipTarget(0, 1e6)).toBe(TIP_MAX_DEG);
    expect(tipTarget(-6, 1e6)).toBe(8);
    expect(tipTarget(-6, -1e6)).toBe(-TIP_MAX_DEG);
  });

  it("starts by ending the CSS intro, marking the Balance and writing its rest angle, with no frame asked for", () => {
    const d = start(-6);
    expect(d.cancelled()).toBe(2);
    expect(d.attrs.get("data-dragging")).toBe("");
    expect(d.tilt()).toBe("-6.000deg");
    expect(d.frames.pending()).toBe(0);
  });

  it("follows its own pointer only", () => {
    const d = start();
    send(d.zone, "pointermove", 160, 2);
    send(d.zone, "pointerup", 160, 2);
    expect(d.frames.pending()).toBe(0);
    expect(d.onEnd).not.toHaveBeenCalled();
    send(d.zone, "pointermove", 160);
    expect(d.frames.pending()).toBe(1);
  });

  it("springs to the pull, clamps the overshoot at ±14°, and stops asking for frames once settled while held", () => {
    const d = start();
    send(d.zone, "pointermove", 220);
    const ran = d.frames.run();
    expect(ran).toBeGreaterThan(5);
    expect(ran).toBeLessThan(120);
    expect(d.frames.pending()).toBe(0);
    expect(d.writes.at(-1)!).toBeCloseTo(tipTarget(0, 120), 1);
    expect(Math.max(...d.writes)).toBe(TIP_MAX_DEG);
    expect(d.onEnd).not.toHaveBeenCalled();
  });

  it("on release swings back past rest on the needle spring, then cleans up and ends once", () => {
    const d = start();
    send(d.zone, "pointermove", 220);
    d.frames.run();
    const before = d.writes.length;
    send(d.zone, "pointerup", 220);
    d.frames.run();
    const back = d.writes.slice(before);
    expect(Math.min(...back)).toBeLessThan(-1);
    expect(back.every((x) => Math.abs(x) <= TIP_MAX_DEG)).toBe(true);
    expect(d.tilt()).toBeNull();
    expect(d.attrs.has("data-dragging")).toBe(false);
    expect(d.onEnd).toHaveBeenCalledTimes(1);
    expect(d.frames.pending()).toBe(0);
    const after = d.writes.length;
    send(d.zone, "pointermove", 300);
    expect(d.writes.length).toBe(after);
    expect(d.frames.pending()).toBe(0);
  });

  it("stays stable when frames come half a second apart", () => {
    const d = start();
    send(d.zone, "pointermove", -20);
    const ran = d.frames.run(500);
    expect(ran).toBeLessThan(60);
    expect(d.writes.every((x) => Number.isFinite(x) && Math.abs(x) <= TIP_MAX_DEG)).toBe(true);
    expect(d.writes.at(-1)!).toBeCloseTo(tipTarget(0, -120), 1);
    send(d.zone, "pointerup", -20);
    d.frames.run(500);
    expect(d.onEnd).toHaveBeenCalledTimes(1);
  });

  it("ends the same way on pointercancel, and at once when released at rest", () => {
    const d = start(-6);
    send(d.zone, "pointermove", 130);
    d.frames.run();
    send(d.zone, "pointercancel", 130);
    d.frames.run();
    expect(d.tilt()).toBeNull();
    expect(d.onEnd).toHaveBeenCalledTimes(1);

    const still = start();
    send(still.zone, "pointerup", 100);
    expect(still.onEnd).toHaveBeenCalledTimes(1);
    expect(still.frames.pending()).toBe(0);
    expect(still.tilt()).toBeNull();
  });

  it("stop() ends a drag at once, and only once", () => {
    const d = start();
    send(d.zone, "pointermove", 200);
    d.frames.run(1000 / 60, 3);
    expect(d.frames.pending()).toBe(1);
    d.drag.stop();
    expect(d.frames.pending()).toBe(0);
    expect(d.tilt()).toBeNull();
    expect(d.attrs.has("data-dragging")).toBe(false);
    d.drag.stop();
    send(d.zone, "pointerup", 200);
    expect(d.onEnd).toHaveBeenCalledTimes(1);
  });
});

describe("drag-to-tip in the engine card", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A browser that answers the reduced-motion query. jsdom has no matchMedia, which reads as "reduce". */
  const motion = (reduce: boolean) =>
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduce, media: query, addEventListener() {}, removeEventListener() {} }));

  function card() {
    const { container } = render(<DecisionEngine />);
    return {
      container,
      zone: () => container.querySelector<HTMLElement>("[data-weighing]")!,
      svg: () => container.querySelector("svg.balance")!,
    };
  }

  const pressOn = (zone: HTMLElement, button = 0) =>
    act(async () => {
      zone.dispatchEvent(new FakePointerEvent("pointerdown", { clientX: 100, button }));
    });

  /** Lets an import() a press started finish, so a test can see that it started nothing. */
  const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));

  it("loads the drag on the first primary press, marks the Balance and adds the caption", async () => {
    motion(false);
    const ui = card();
    expect(screen.queryByText(CAPTION)).toBeNull();
    await pressOn(ui.zone());
    await waitFor(() => expect(ui.svg()).toHaveAttribute("data-dragging"));
    expect(screen.getByText(CAPTION)).toBeInTheDocument();
    // 11 px text needs 7:1 (spec 9.2): label is 7.96:1 on white, ink-2 only 6.21:1. P0's contrast test does not scan this file.
    expect(screen.getByText(CAPTION).className.split(" ")).toContain("text-label");
  });

  it("ends the drag when a moment is chosen", async () => {
    motion(false);
    const ui = card();
    const first = ui.svg();
    await pressOn(ui.zone());
    await waitFor(() => expect(first).toHaveAttribute("data-dragging"));
    fireEvent.click(screen.getByRole("button", { name: MOMENTS.thu.toggleLabel }));
    expect(first).not.toHaveAttribute("data-dragging");
    expect(ui.container.querySelector("[data-dragging]")).toBeNull();
    expect(ui.svg()).toHaveAttribute("data-verdict", "allowed");
  });

  it("starts no drag under reduced motion, for a secondary button, or when the press ends before the drag loads", async () => {
    motion(true);
    const reduced = card();
    await pressOn(reduced.zone());
    await settle();
    expect(reduced.svg()).not.toHaveAttribute("data-dragging");
    cleanup();

    motion(false);
    const ui = card();
    await pressOn(ui.zone(), 2);
    await settle();
    expect(ui.svg()).not.toHaveAttribute("data-dragging");
    await act(async () => {
      ui.zone().dispatchEvent(new FakePointerEvent("pointerdown", { clientX: 100 }));
      ui.zone().dispatchEvent(new FakePointerEvent("pointerup", { clientX: 100 }));
    });
    await settle();
    expect(ui.svg()).not.toHaveAttribute("data-dragging");
    expect(screen.queryByText(CAPTION)).toBeNull();
  });

  it("imports the integrator lazily, and turns the beam's transitions off while dragging", () => {
    expect(src).toContain('import("@/components/instrument/useTipDrag")');
    expect(src).toMatch(/^import type \{ TipDrag \} from "@\/components\/instrument\/useTipDrag";$/m);
    expect(src.match(/from "@\/components\/instrument\/useTipDrag"/g)).toHaveLength(1);
    expect(css).toMatch(
      /\.balance\[data-dragging\] \.balance-beam,\s*\.balance\[data-dragging\] \.balance-pan\s*\{\s*transition:\s*none;\s*\}/,
    );
  });
});
