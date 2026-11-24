import { NEEDLE, SETTLE_EPSILON, type SpringState, springStep } from "@/lib/motion/spring";

/** How far a drag can tip the beam either way, degrees. */
export const TIP_MAX_DEG = 14;
/** The pointer travel over which the pull reaches tanh(1), 76%, of TIP_MAX_DEG, px. */
export const TIP_TRAVEL_PX = 60;
/** The longest step the spring takes: a slow frame is cut to this, so NEEDLE's ω·dt stays under 1. */
export const MAX_STEP_SEC = 1 / 30;
/** The step of the first frame after a start or a wake, before a frame time has been seen. */
const FIRST_STEP_SEC = 1 / 60;
/** Settled: this close to the target, in degrees, and slower than EPS_DEG · ω per second. */
export const EPS_DEG = SETTLE_EPSILON * TIP_MAX_DEG;

const clamp = (deg: number) => Math.min(TIP_MAX_DEG, Math.max(-TIP_MAX_DEG, deg));

/** Where a pointer `dx` px from the drag's start pulls the beam: the rest angle plus a soft pull, within ±14°. */
export function tipTarget(restDeg: number, dx: number): number {
  return clamp(restDeg + TIP_MAX_DEG * Math.tanh(dx / TIP_TRAVEL_PX));
}

const settled = (s: SpringState, target: number) =>
  Math.abs(s.x - target) < EPS_DEG && Math.abs(s.v) < EPS_DEG * NEEDLE.omega;

/** What the drag writes to: the Balance's svg, whose beam and pans read --tilt. */
export interface TipTarget {
  style: Pick<CSSStyleDeclaration, "setProperty" | "removeProperty">;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  getAnimations?(options?: GetAnimationsOptions): readonly { cancel(): void }[];
}

export interface TipDragOptions {
  svg: TipTarget;
  /** Where the pointer's events arrive: the element that captured it. */
  zone: EventTarget;
  pointerId: number;
  /** The pointer's clientX when the drag began. */
  startX: number;
  /** The beam's angle for the verdict shown: 0 when allowed, BALANCE.refusedDeg when refused. */
  restDeg: number;
  raf?: (cb: FrameRequestCallback) => number;
  caf?: (id: number) => void;
  /** Called once, when the drag has finished. */
  onEnd?: () => void;
}

export interface TipDrag {
  /** Ends the drag at once: the beam goes back to its CSS rest, and every listener and frame is dropped. */
  stop(): void;
}

/**
 * Drag-to-tip (spec 2026-11-23 sections 6.1 and 8.1, amendment A5): the beam follows the pointer on the NEEDLE spring,
 * one springStep per animation frame and only while it is unsettled, and swings back past rest when let go. Only the
 * nine checks move this beam: the drag never changes the verdict, and the beam always returns to it. A plain
 * function, loaded with import() on the first press, so the landing never downloads it before then.
 */
export function beginTipDrag(opts: TipDragOptions): TipDrag {
  const { svg, zone, pointerId, startX, restDeg, onEnd } = opts;
  const raf = opts.raf ?? ((cb: FrameRequestCallback) => requestAnimationFrame(cb));
  const caf = opts.caf ?? ((id: number) => cancelAnimationFrame(id));
  let state: SpringState = { x: restDeg, v: 0 };
  let target = restDeg;
  let frame: number | null = null;
  let last: number | null = null;
  let released = false;
  let done = false;

  const write = () => svg.style.setProperty("--tilt", `${clamp(state.x).toFixed(3)}deg`);

  const tick = (now: number) => {
    frame = null;
    const dt = last === null ? FIRST_STEP_SEC : Math.min(MAX_STEP_SEC, Math.max(0, (now - last) / 1000));
    last = now;
    state = springStep(state, target, NEEDLE, dt);
    write();
    if (!settled(state, target)) frame = raf(tick);
    else if (released) finish();
  };

  const wake = () => {
    if (frame !== null || done) return;
    last = null;
    frame = raf(tick);
  };

  const onMove = (e: Event) => {
    const p = e as PointerEvent;
    if (p.pointerId !== pointerId || released) return;
    target = tipTarget(restDeg, p.clientX - startX);
    wake();
  };

  const onUp = (e: Event) => {
    if ((e as PointerEvent).pointerId !== pointerId || released) return;
    released = true;
    target = restDeg;
    if (settled(state, target)) finish();
    else wake();
  };

  function finish() {
    if (done) return;
    done = true;
    zone.removeEventListener("pointermove", onMove);
    zone.removeEventListener("pointerup", onUp);
    zone.removeEventListener("pointercancel", onUp);
    if (frame !== null) caf(frame);
    frame = null;
    svg.style.removeProperty("--tilt");
    svg.removeAttribute("data-dragging");
    onEnd?.();
  }

  for (const a of svg.getAnimations?.({ subtree: true }) ?? []) a.cancel();
  svg.setAttribute("data-dragging", "");
  write();
  zone.addEventListener("pointermove", onMove);
  zone.addEventListener("pointerup", onUp);
  zone.addEventListener("pointercancel", onUp);
  return { stop: finish };
}
