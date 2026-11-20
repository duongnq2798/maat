"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

/** "unmeasured" until the browser has measured the block, as in the exported HTML; then whether it is wider than its box. */
type Overflow = "unmeasured" | "scrolls" | "fits";

/**
 * Whether a block scrolls sideways, measured once the page runs, again whenever the block changes size (and its first
 * child, with `watchChild`), and once the web fonts are in. Without ResizeObserver it stays unmeasured, so it keeps its
 * tab stop.
 */
function useOverflow<T extends HTMLElement>(watchChild: boolean) {
  const ref = useRef<T>(null);
  const [overflow, setOverflow] = useState<Overflow>("unmeasured");
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setOverflow(el.scrollWidth > el.clientWidth ? "scrolls" : "fits");
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (watchChild && el.firstElementChild) observer.observe(el.firstElementChild);
    measure();
    void document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, [watchChild]);
  return [ref, overflow] as const;
}

/**
 * A block that scrolls must be reachable by keyboard (axe rule scrollable-region-focusable), so it is a named region with
 * a tab stop. A block that fits is neither, so a keyboard user does not land on it. data-overflow says which, for tests.
 */
function regionProps(label: string, overflow: Overflow) {
  return overflow === "fits"
    ? { "data-overflow": overflow }
    : { "data-overflow": overflow, role: "region", "aria-label": label, tabIndex: 0 };
}

/** A div that scrolls its content sideways: a table on a small screen. The table is a block, so it is watched too. */
export function ScrollRegion({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  const [ref, overflow] = useOverflow<HTMLDivElement>(true);
  return (
    <div ref={ref} className={className} {...regionProps(label, overflow)}>
      {children}
    </div>
  );
}

/**
 * A pre that scrolls its line sideways: a signature or a command. Its code is an inline box, which a ResizeObserver
 * reports as 0 by 0 and never again, so only the pre is watched.
 */
export function ScrollPre({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  const [ref, overflow] = useOverflow<HTMLPreElement>(false);
  return (
    <pre ref={ref} className={className} {...regionProps(label, overflow)}>
      {children}
    </pre>
  );
}
