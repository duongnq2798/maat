"use client";

import { type RefObject, useEffect, useRef } from "react";
import { prefersReducedMotion } from "@/lib/motion/reduced-motion";

/** How long the scan line takes to cross the window, ms (spec 2026-11-23 section 8.3). */
export const SCAN_MS = 400;

/**
 * One pass of the 1 px scan line down `travelPx`, with WAAPI: visible only while it runs, so it ends on its base style,
 * hidden. Nothing under reduced motion, or where Element.prototype.animate is missing.
 */
export function scanOnce(line: HTMLElement, travelPx: number): Animation | null {
  if (prefersReducedMotion() || typeof line.animate !== "function") return null;
  return line.animate(
    [
      { transform: "translateY(0)", visibility: "visible" },
      { transform: `translateY(${travelPx}px)`, visibility: "visible" },
    ],
    { duration: SCAN_MS, easing: "linear" },
  );
}

/**
 * Runs scanOnce down `box` each time `key` (the reading's readAtMs) moves from one reading to the next: never for the
 * first reading, and only while `box` is on screen, the tab is visible and the reading is not held (spec section 8.1,
 * rule 4). Where IntersectionObserver is missing, the box counts as off screen, so nothing runs.
 */
export function useScan(
  box: RefObject<HTMLElement | null>,
  line: RefObject<HTMLElement | null>,
  key: number | null,
  held: boolean,
): void {
  const onScreen = useRef(false);
  const isHeld = useRef(held);
  const last = useRef<number | null>(null);

  useEffect(() => {
    isHeld.current = held;
  }, [held]);

  useEffect(() => {
    const el = box.current;
    if (el === null || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) onScreen.current = e.isIntersecting;
    });
    io.observe(el);
    return () => {
      io.disconnect();
      onScreen.current = false;
    };
  }, [box]);

  useEffect(() => {
    const prev = last.current;
    last.current = key;
    if (prev === null || key === null || prev === key) return;
    const el = box.current;
    const ln = line.current;
    if (el === null || ln === null) return;
    if (!onScreen.current || isHeld.current || document.visibilityState !== "visible") return;
    scanOnce(ln, Math.max(0, el.clientHeight - 2));
  }, [key, box, line]);
}
