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
 * Shows the preview under its term, or over it when it fits only there, whole and inside the window. A preview that fits
 * on neither side, or whose term is out of the window, stays closed: cut to the room, it would be a box that no keyboard
 * can scroll, hiding the end of the entry, often its status. The link still names the whole entry as its description,
 * and opens it. The preview is placed again whenever the page scrolls or the window changes size, so it opens once its
 * term has room for it, and closes when the room goes.
 */
function place(term: HTMLElement, tip: HTMLElement) {
  // Measured open, in the top layer; closed again in the same task when it does not fit, so it never paints.
  if (!isOpen(tip)) tip.showPopover();
  tip.style.left = "0px";
  tip.style.top = "0px";
  const t = term.getBoundingClientRect();
  const { width, height } = tip.getBoundingClientRect();
  const { clientWidth, clientHeight } = document.documentElement;
  const under = t.bottom + GAP_PX >= EDGE_PX && t.bottom + GAP_PX + height <= clientHeight - EDGE_PX;
  const over = t.top - GAP_PX <= clientHeight - EDGE_PX && t.top - GAP_PX - height >= EDGE_PX;
  if (!under && !over) {
    tip.hidePopover();
    return;
  }
  tip.style.left = `${Math.max(EDGE_PX, Math.min(t.left, clientWidth - width - EDGE_PX))}px`;
  tip.style.top = `${under ? t.bottom + GAP_PX : t.top - GAP_PX - height}px`;
}

/**
 * The preview a term holds, and that term. It shows while it fits beside the term (see `place`). One preview is held at a
 * time. A page draws each entry's preview once, so every term that links one entry holds the same preview, beside itself.
 */
let held: { term: HTMLElement; tip: HTMLElement } | undefined;
/** What holds a preview: the term or preview under the pointer, and the term with keyboard focus. */
let pointerOn: Element | null = null;
let focused: HTMLElement | null = null;
let timer: number | undefined;

function later(action: () => void, ms: number) {
  window.clearTimeout(timer);
  timer = window.setTimeout(action, ms);
}

// While a preview is held: Escape closes it wherever focus is, and keyboard focus no longer brings it back; it follows its
// term when the page scrolls.
const onKey = (e: KeyboardEvent) => {
  if (e.key !== "Escape") return;
  focused = null;
  hide();
};
const follow = () => {
  if (held) place(held.term, held.tip);
};

function show(term: HTMLElement, tip: HTMLElement) {
  window.clearTimeout(timer);
  // A timer set before the reader left the page fires after its term has gone.
  if (!term.isConnected || !tip.isConnected) return;
  if (held?.tip !== tip) {
    hide();
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
  }
  held = { term, tip };
  place(term, tip);
}

function hide() {
  window.clearTimeout(timer);
  if (held === undefined) return;
  const { tip } = held;
  held = undefined;
  document.removeEventListener("keydown", onKey);
  window.removeEventListener("scroll", follow, true);
  window.removeEventListener("resize", follow);
  if (isOpen(tip)) tip.hidePopover();
}

/**
 * Lets go of the held preview unless the pointer or keyboard focus still holds it. When the pointer lets go of another
 * term's preview, the term that still has keyboard focus gets its own back.
 */
function release() {
  if (!held || pointerOn === held.term || pointerOn === held.tip || focused === held.term) return;
  hide();
  if (focused?.isConnected !== true || focused !== document.activeElement) return;
  const tip = document.getElementById(focused.getAttribute("aria-describedby") ?? "");
  if (canPreview(tip)) show(focused, tip);
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

  // A term that leaves the page lets go of its preview, and of one still waiting to open.
  useEffect(() => {
    const el = term.current;
    return () => {
      if (held?.term === el || held?.tip.isConnected === false) hide();
      if (pointerOn === el) {
        pointerOn = null;
        window.clearTimeout(timer);
      }
      if (focused === el) focused = null;
    };
  }, []);

  // The pointer resting on a term opens its preview; on the held preview, or back on its term, it keeps it.
  const enter = (e: PointerEvent<HTMLElement>) => {
    const [anchor, tip] = [term.current, tipOf()];
    if (e.pointerType === "touch" || !anchor || !canPreview(tip)) return;
    pointerOn = e.currentTarget;
    if (held !== undefined && (held.term === e.currentTarget || held.tip === e.currentTarget)) window.clearTimeout(timer);
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
          if (held?.term === e.currentTarget) release();
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
          className="inset-auto m-0 hidden w-[min(24rem,calc(100%-1rem))] rounded-lg border border-fd-border bg-fd-popover p-3 text-left text-sm leading-relaxed font-normal whitespace-normal not-italic text-fd-popover-foreground shadow-lg wrap-anywhere open:block"
        >
          {preview}
        </span>
      )}
    </>
  );
}
