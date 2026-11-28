"use client";

import { useEffect, useState } from "react";
import { useLiveIfAny } from "@/components/live/LiveSnapshotProvider";
import { andList } from "@/content/format";
import { REASON_LABEL } from "@/content/reasons";
import type { LiveState } from "@/lib/live/freshness";
import { MARKET_CHECKS_PASS, REFUSED } from "@/lib/live/verdict";
import { Lamp, type LampState } from "./Lamp";

/** The bar's lamp: lit only while the page's one reading is live, PASS when the basket passes, else REFUSE. */
export function thumbLamp(state: LiveState | undefined): LampState {
  if (state === undefined || state.status !== "live") return "reading";
  return state.reading.headline.kind === "pass-all" ? "pass" : "refuse";
}

/** The bar's label while the reading is live, before its verdict words (cold read of 2026-11-28, gap 5). */
export const THUMB_LEAD = "A buy right now:";
/** The bar's label while it has no live reading: reading, failed, stale or behind. Its lamp is unlit. */
export const THUMB_NOT_LIVE = "No live reading";

/**
 * The bar's verdict words, in the hero line's grammar (lib/live/verdict.ts): "Market checks pass" when no basket stock
 * is refused; "Refused · Market closed" when every one is refused for one reason, the verdict and its reason's label as
 * the lexicon's grammar has them (the code stays on the hero's line: a lamp never prints one); "Refused for NVDAc" (or
 * "for NVDAc and GOOGLc") when some are and some pass; and "Refused" when every one is, for more than one reason. Null
 * while the reading is not live. Never "Allowed": the bar runs none of the checks that need a vault.
 */
export function thumbWord(state: LiveState | undefined): string | null {
  if (state === undefined || state.status !== "live") return null;
  const h = state.reading.headline;
  if (h.kind === "pass-all") return MARKET_CHECKS_PASS;
  if (h.kind === "refuse-all") return `${REFUSED} · ${REASON_LABEL[h.reason]}`;
  if (h.passed.length > 0) return `${REFUSED} for ${andList(h.refused.map((x) => x.symbol))}`;
  return REFUSED;
}

/** What the bar knows of the page. */
export interface ThumbView {
  /** Both hero CTAs have scrolled out above the viewport. */
  ctasAbove: boolean;
  tryInView: boolean;
  footerInView: boolean;
}

/** The bar shows once both CTAs are gone above, and never over #try or the footer (spec 6.2 and 11 item 12). */
export function thumbShown(v: ThumbView): boolean {
  return v.ctasAbove && !v.tryInView && !v.footerInView;
}

type Mode = "none" | "shown" | "hidden";

/**
 * The phone bottom bar (spec 2026-11-23 section 6.2): a lamp from the page's one reading and "Try to make it say no".
 * The lamp prints the verdict words of the hero's line, "A buy right now: Refused · Market closed", at the label's 13 px,
 * or says "No live reading" unlit (thumbWord; cold read of 2026-11-28, gap 5). The row is at least 56 px and grows when
 * the words wrap, so "Refused for NVDAc and GOOGLc" stays inside it at 320 px (review of PR #120). It renders nothing
 * until both [data-hero-cta] links have scrolled out above the viewport, so the static HTML and the first screen never
 * hold it; after that it slides up, and back down (inert) while #try or the footer is in view. Two IntersectionObservers
 * of its own watch them: one for the CTAs on a root that reaches far below the screen, so a jump straight past them
 * still counts, and one for #try and the footer on the screen. Where there is none, the bar never shows. Below md only.
 * Mounted from app/(site)/page.tsx, never from the Hero.
 */
export function ThumbBar({ href = "#try" }: { href?: string }) {
  const live = useLiveIfAny();
  const [mode, setMode] = useState<Mode>("none");

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const ctas = [...document.querySelectorAll("[data-hero-cta]")];
    if (ctas.length === 0) return;
    const tryIt = document.getElementById("try");
    const footer = document.querySelector("footer");
    const above = new Map<Element, boolean>(ctas.map((el) => [el, false]));
    const view = { tryInView: false, footerInView: false };
    const onEntries = (entries: IntersectionObserverEntry[]) => {
      for (const e of entries) {
        if (above.has(e.target)) {
          // Out of the root above its top edge, the viewport's: scrolled past, not yet to come.
          above.set(e.target, !e.isIntersecting && e.boundingClientRect.bottom <= (e.rootBounds?.top ?? 0));
        } else if (e.target === tryIt) view.tryInView = e.isIntersecting;
        else if (e.target === footer) view.footerInView = e.isIntersecting;
      }
      const shown = thumbShown({ ctasAbove: [...above.values()].every(Boolean), ...view });
      setMode((m) => (shown ? "shown" : m === "none" ? "none" : "hidden"));
    };
    // The root reaches far below the screen, so a CTA leaves it only by passing above the top edge, even in one jump.
    const ctaIo = new IntersectionObserver(onEntries, { rootMargin: "0px 0px 100000px 0px" });
    const io = new IntersectionObserver(onEntries);
    for (const el of ctas) ctaIo.observe(el);
    if (tryIt !== null) io.observe(tryIt);
    if (footer !== null) io.observe(footer);
    return () => {
      ctaIo.disconnect();
      io.disconnect();
    };
  }, []);

  if (mode === "none") return null;
  const shown = mode === "shown";
  const word = thumbWord(live?.state);
  return (
    <div
      data-thumb-bar={mode}
      inert={!shown}
      className="thumb-bar fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white md:hidden"
    >
      <div className="wrap flex min-h-14 items-center justify-between gap-3 py-1.5">
        <span
          data-thumb-verdict=""
          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] leading-4 text-label"
        >
          {word === null ? THUMB_NOT_LIVE : THUMB_LEAD} <Lamp state={thumbLamp(live?.state)} word={word ?? undefined} size="label" />
        </span>
        <a href={href} className="pill-dark min-h-11 shrink-0 px-4 py-2.5 text-sm">
          Try to make it say no
        </a>
      </div>
    </div>
  );
}
