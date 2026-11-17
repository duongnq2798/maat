"use client";

import Link from "fumadocs-core/link";
import { type ComponentProps, type PointerEvent, type ReactNode, useEffect, useRef } from "react";

/** How long the pointer rests on a term before its preview opens, and how long a preview stays once the pointer leaves. */
const OPEN_DELAY_MS = 400;
const CLOSE_DELAY_MS = 200;
/** The space between a term and its preview, and the least space between a preview and the edge of the window. */
const GAP_PX = 6;
const EDGE_PX = 8;

/** Whether the browser has popovers. Without them a term stays a plain link, and `:popover-open` is not a selector. */
const canPreview = (el: HTMLElement | null): el is HTMLElement => typeof el?.showPopover === "function";
const isOpen = (el: HTMLElement | null) => canPreview(el) && el.matches(":popover-open");

/**
 * Puts the preview under its term, or over it when it fits only there, inside the window. A preview that fits on neither
 * side goes on the side with more room, cut to that room, and scrolls: the end of an entry, often its status, stays in
 * reach. It is placed again whenever the page scrolls, with the room its term then has, and keeps its own scroll.
 */
function place(term: HTMLElement, tip: HTMLElement) {
  const scrolled = tip.scrollTop;
  tip.style.left = "0px";
  tip.style.top = "0px";
  tip.style.maxHeight = "";
  const t = term.getBoundingClientRect();
  const { width, height } = tip.getBoundingClientRect();
  const { clientWidth, clientHeight } = document.documentElement;
  const below = clientHeight - EDGE_PX - (t.bottom + GAP_PX);
  const above = t.top - GAP_PX - EDGE_PX;
  const under = height <= below || (height > above && below >= above);
  const room = Math.max(0, under ? below : above);
  if (height > room) tip.style.maxHeight = `${room}px`;
  tip.style.left = `${Math.max(EDGE_PX, Math.min(t.left, clientWidth - width - EDGE_PX))}px`;
  tip.style.top = `${under ? t.bottom + GAP_PX : t.top - GAP_PX - Math.min(height, room)}px`;
  tip.scrollTop = scrolled;
}

/**
 * The preview that is open, and the term it is open for. One preview is open at a time. A page draws each entry's preview
 * once, so every term that links one entry opens the same preview, beside itself.
 */
let open: { term: HTMLElement; tip: HTMLElement } | undefined;
/** What holds the open preview: the term or preview under the pointer, and the term with keyboard focus. */
let pointerOn: Element | null = null;
let focused: Element | null = null;
let timer: number | undefined;

function later(action: () => void, ms: number) {
  window.clearTimeout(timer);
  timer = window.setTimeout(action, ms);
}

// While a preview is open: Escape closes it wherever focus is, and it follows its term when the page scrolls. The reader
// scrolling the preview itself moves nothing.
const onKey = (e: KeyboardEvent) => {
  if (e.key === "Escape") hide();
};
const follow = (e: Event) => {
  if (open && e.target !== open.tip) place(open.term, open.tip);
};

function show(term: HTMLElement, tip: HTMLElement) {
  window.clearTimeout(timer);
  if (open?.tip !== tip) {
    hide();
    if (!isOpen(tip)) tip.showPopover();
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
  }
  open = { term, tip };
  place(term, tip);
}

function hide() {
  window.clearTimeout(timer);
  if (open === undefined) return;
  const { tip } = open;
  open = undefined;
  document.removeEventListener("keydown", onKey);
  window.removeEventListener("scroll", follow, true);
  window.removeEventListener("resize", follow);
  if (isOpen(tip)) tip.hidePopover();
}

/** Closes the open preview unless the pointer or keyboard focus still holds it. */
function release() {
  if (open && pointerOn !== open.term && pointerOn !== open.tip && focused !== open.term) hide();
}

/**
 * A link to a glossary entry that previews the entry, so the reader can stay on the page: after the pointer rests on it,
 * and on keyboard focus. Escape, or the pointer or focus moving away, closes it; the pointer may move onto the preview.
 * A click still opens the entry. A touch opens no preview: the tap that would show it follows the link. The preview is a
 * native popover in the top layer, so a table that scrolls cannot clip it, and it describes the link for a screen reader.
 * The page's first link to an entry draws the preview (`preview`); every link to the entry names it by `previewId`.
 * Without JavaScript, or in a browser without popovers, the term is a plain link with a dotted underline.
 */
export function GlossaryTerm({ previewId, preview, className, ...props }: ComponentProps<"a"> & { previewId: string; preview?: ReactNode }) {
  const term = useRef<HTMLAnchorElement>(null);
  const tipOf = () => document.getElementById(previewId);

  // A term that leaves the page lets go of its preview.
  useEffect(() => {
    const el = term.current;
    return () => {
      if (open?.term === el || open?.tip.isConnected === false) hide();
      if (pointerOn === el) pointerOn = null;
      if (focused === el) focused = null;
    };
  }, []);

  // The pointer resting on a term opens its preview; on the open preview, or back on its term, it keeps it open.
  const enter = (e: PointerEvent<HTMLElement>) => {
    const [anchor, tip] = [term.current, tipOf()];
    if (e.pointerType === "touch" || !anchor || !canPreview(tip)) return;
    pointerOn = e.currentTarget;
    if (open !== undefined && (open.term === e.currentTarget || open.tip === e.currentTarget)) window.clearTimeout(timer);
    else later(() => show(anchor, tip), OPEN_DELAY_MS);
  };
  const leave = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType === "touch") return;
    if (pointerOn === e.currentTarget) pointerOn = null;
    later(release, CLOSE_DELAY_MS);
  };

  return (
    <>
      <Link
        {...props}
        ref={term}
        aria-describedby={previewId}
        className={["decoration-dotted", className].filter(Boolean).join(" ")}
        onPointerEnter={enter}
        onPointerLeave={leave}
        onFocus={(e) => {
          // Keyboard focus only: a click or a tap focuses the link as well, and opens the entry.
          const tip = tipOf();
          if (!canPreview(tip) || !e.currentTarget.matches(":focus-visible")) return;
          focused = e.currentTarget;
          show(e.currentTarget, tip);
        }}
        onBlur={(e) => {
          if (focused === e.currentTarget) focused = null;
          if (open?.term === e.currentTarget) release();
        }}
        onClick={hide}
      />
      {preview !== undefined && (
        <span
          id={previewId}
          role="tooltip"
          popover="manual"
          onPointerEnter={enter}
          onPointerLeave={leave}
          className="inset-auto m-0 hidden w-[min(24rem,calc(100%-1rem))] overflow-y-auto overscroll-contain rounded-lg border border-fd-border bg-fd-popover p-3 text-left text-sm leading-relaxed font-normal whitespace-normal not-italic text-fd-popover-foreground shadow-lg wrap-anywhere open:block"
        >
          {preview}
        </span>
      )}
    </>
  );
}
