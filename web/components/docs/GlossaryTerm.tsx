"use client";

import Link from "fumadocs-core/link";
import { type ComponentProps, type PointerEvent, type ReactNode, useEffect, useId, useRef } from "react";

/** How long the pointer rests on a term before its preview opens, and how long a preview stays once the pointer leaves. */
const OPEN_DELAY_MS = 400;
const CLOSE_DELAY_MS = 200;
/** The space between a term and its preview, and the least space between a preview and the edge of the window. */
const GAP_PX = 6;
const EDGE_PX = 8;

/** Whether the browser has popovers. Without them a term stays a plain link, and `:popover-open` is not a selector. */
const canPreview = (el: HTMLElement | null): el is HTMLElement => typeof el?.showPopover === "function";
const isOpen = (el: HTMLElement | null) => canPreview(el) && el.matches(":popover-open");

/** Puts the preview under its term, or over it when it does not fit below, and inside the window. */
function place(term: HTMLElement, tip: HTMLElement) {
  tip.style.left = "0px";
  tip.style.top = "0px";
  const t = term.getBoundingClientRect();
  const { width, height } = tip.getBoundingClientRect();
  const { clientWidth, clientHeight } = document.documentElement;
  const above = t.top - GAP_PX - height;
  const below = t.bottom + GAP_PX;
  const top = below + height > clientHeight - EDGE_PX && above >= EDGE_PX ? above : below;
  tip.style.left = `${Math.max(EDGE_PX, Math.min(t.left, clientWidth - width - EDGE_PX))}px`;
  tip.style.top = `${top}px`;
}

/**
 * A link to a glossary entry that previews the entry, so the reader can stay on the page: after the pointer rests on it,
 * and on keyboard focus. Escape, or the pointer or focus moving away, closes it; the pointer may move onto the preview.
 * A click still opens the entry. A touch opens no preview: the tap that would show it follows the link. The preview is a
 * native popover in the top layer, so a table that scrolls cannot clip it, and it describes the link for a screen reader.
 * Without JavaScript, or in a browser without popovers, the term is a plain link with a dotted underline.
 */
export function GlossaryTerm({ preview, className, ...props }: ComponentProps<"a"> & { preview: ReactNode }) {
  const id = useId();
  const term = useRef<HTMLAnchorElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | undefined>(undefined);
  // What holds the preview open: the pointer, on the term or on the preview, and keyboard focus on the term.
  const pointer = useRef(false);
  const focus = useRef(false);

  const show = () => {
    const [anchor, el] = [term.current, tip.current];
    if (!anchor || !canPreview(el)) return;
    if (!isOpen(el)) el.showPopover();
    place(anchor, el);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    if (isOpen(tip.current)) tip.current?.hidePopover();
  };
  const later = (action: () => void, ms: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(action, ms);
  };

  // While the preview is open: Escape closes it wherever focus is, and it follows its term when the page scrolls.
  useEffect(() => {
    const [anchor, el] = [term.current, tip.current];
    if (!anchor || !el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    const onMove = () => place(anchor, el);
    const stop = () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
    const onToggle = (e: Event) => {
      if ((e as ToggleEvent).newState !== "open") {
        stop();
        return;
      }
      document.addEventListener("keydown", onKey);
      window.addEventListener("scroll", onMove, true);
      window.addEventListener("resize", onMove);
    };
    el.addEventListener("toggle", onToggle);
    return () => {
      el.removeEventListener("toggle", onToggle);
      stop();
      window.clearTimeout(timer.current);
    };
  }, []);

  const enter = (e: PointerEvent) => {
    if (e.pointerType === "touch" || !canPreview(tip.current)) return;
    pointer.current = true;
    if (isOpen(tip.current)) window.clearTimeout(timer.current);
    else later(show, OPEN_DELAY_MS);
  };
  const leave = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    pointer.current = false;
    if (focus.current) window.clearTimeout(timer.current);
    else later(hide, CLOSE_DELAY_MS);
  };

  return (
    <>
      <Link
        {...props}
        ref={term}
        aria-describedby={id}
        className={["decoration-dotted", className].filter(Boolean).join(" ")}
        onPointerEnter={enter}
        onPointerLeave={leave}
        onFocus={(e) => {
          // Keyboard focus only: a click or a tap focuses the link as well, and opens the entry.
          if (!canPreview(tip.current) || !e.currentTarget.matches(":focus-visible")) return;
          focus.current = true;
          window.clearTimeout(timer.current);
          show();
        }}
        onBlur={() => {
          focus.current = false;
          if (!pointer.current) hide();
        }}
        onClick={hide}
      />
      <span
        ref={tip}
        id={id}
        role="tooltip"
        popover="manual"
        onPointerEnter={enter}
        onPointerLeave={leave}
        className="inset-auto m-0 hidden w-[min(24rem,calc(100vw-1rem))] rounded-lg border border-fd-border bg-fd-popover p-3 text-left text-sm leading-relaxed font-normal whitespace-normal not-italic text-fd-popover-foreground shadow-lg wrap-anywhere open:block"
      >
        {preview}
      </span>
    </>
  );
}
