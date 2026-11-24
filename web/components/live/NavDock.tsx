"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { formatBlock } from "@/lib/live/format";
import { useLiveIfAny } from "./LiveSnapshotProvider";

/**
 * The nav's bar (spec 2026-11-23 sections 6.1 and 7.5): white and, from lg, pinned to the top of the screen, with a
 * hairline under it once the page has scrolled. Below lg the nav can wrap to two rows, so it scrolls away with the
 * page. One passive scroll listener sets data-scrolled; nothing else runs on scroll.
 */
export function NavBar({ children }: { children: ReactNode }) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bar.current;
    if (el === null) return;
    const update = () => el.toggleAttribute("data-scrolled", window.scrollY > 0);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  return (
    <div ref={bar} data-nav-bar="" className="nav-bar relative z-30 bg-white lg:sticky lg:top-0">
      {children}
    </div>
  );
}

/**
 * The docked mini readout (spec 6.1): once the hero has scrolled out of view, the nav repeats the page's one reading
 * as "● 60,013,066 · Saturday · NYSE closed", from xl only. It keeps to one row of at most 340 px, so a longer detail
 * ("MarketCalendar unreadable · counted closed") ends in an ellipsis instead of wrapping the bar onto a second row; the
 * strip in the hero prints it whole. It shows a live reading and nothing else. It reads the page's
 * LiveSnapshotProvider, never a loop of its own, and it is aria-hidden, because the strip's announcer is the page's
 * one live region.
 */
export function NavDock() {
  const live = useLiveIfAny();
  const [docked, setDocked] = useState(false);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const top = document.getElementById("top");
    if (top === null) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) setDocked(!e.isIntersecting);
    });
    io.observe(top);
    return () => io.disconnect();
  }, []);
  const state = live?.state;
  if (!docked || state === undefined || state.status !== "live") return null;
  const { snapshot, session } = state.reading;
  return (
    <span
      data-nav-dock=""
      aria-hidden="true"
      className="ml-3 hidden max-w-[340px] items-center gap-1.5 whitespace-nowrap font-mono text-[11px] text-label xl:inline-flex"
    >
      <span className="text-accent">●</span> <span className="min-w-0 truncate">{formatBlock(snapshot.block)} · {session.detail}</span>
    </span>
  );
}
