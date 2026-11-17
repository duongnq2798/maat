"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

/** "unmeasured" until the browser has measured the block, as in the exported HTML; then whether it is wider than its box. */
type Overflow = "unmeasured" | "scrolls" | "fits";

/**
 * Whether a block scrolls sideways, measured once the page runs and again whenever the block or its first child changes
 * size, and once the web fonts are in. Without ResizeObserver it stays unmeasured, so it keeps its tab stop.
 */
function useOverflow<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [overflow, setOverflow] = useState<Overflow>("unmeasured");
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setOverflow(el.scrollWidth > el.clientWidth ? "scrolls" : "fits");
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    measure();
    void document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, []);
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

/** A div that scrolls its content sideways: a table on a small screen. */
export function ScrollRegion({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  const [ref, overflow] = useOverflow<HTMLDivElement>();
  return (
    <div ref={ref} className={className} {...regionProps(label, overflow)}>
      {children}
    </div>
  );
}

/** A pre that scrolls its line sideways: a signature or a command. */
export function ScrollPre({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  const [ref, overflow] = useOverflow<HTMLPreElement>();
  return (
    <pre ref={ref} className={className} {...regionProps(label, overflow)}>
      {children}
    </pre>
  );
}
