import type { ReactNode } from "react";
import type { Verdict } from "./types";

export interface TapeProps {
  /** The list's accessible name, for example "Vault decisions". */
  label?: string;
  children: ReactNode;
  className?: string;
}

/** Printed verdict rows (spec 2026-11-23 section 5.1): an ordered list, never a table (the landing keeps one table). */
export function Tape({ label, children, className }: TapeProps) {
  return (
    <ol data-tape="" aria-label={label} className={className ? `tape ${className}` : "tape"}>
      {children}
    </ol>
  );
}

export interface TapeRowProps {
  verdict: Verdict;
  /**
   * A row that landed while the page is open, or that is new since the viewer's last look: it prints in once (`print`,
   * 260 ms, clip-path). Rows in the static HTML are never fresh, so they render at their final frame.
   */
  fresh?: boolean;
  /** Called when the row's own print-in ends, so its owner can stop marking it fresh and it never prints twice. */
  onPrinted?: () => void;
  children: ReactNode;
  className?: string;
}

/**
 * Calls `onPrinted` when the row's own animation ends; one inside the row does not count. A DOM listener rather than
 * onAnimationEnd, which React binds to a vendor-prefixed event name where the browser has no AnimationEvent.
 */
function printedRef(onPrinted: () => void) {
  return (el: HTMLLIElement | null) => {
    if (!el) return;
    const end = (e: Event) => {
      if (e.target === el) onPrinted();
    };
    el.addEventListener("animationend", end);
    return () => el.removeEventListener("animationend", end);
  };
}

/** One printed row. Its words carry the verdict; data-verdict only sets the colour of its rule. */
export function TapeRow({ verdict, fresh = false, onPrinted, children, className }: TapeRowProps) {
  return (
    <li
      ref={onPrinted ? printedRef(onPrinted) : undefined}
      data-tape-row=""
      data-verdict={verdict}
      data-fresh={fresh ? "" : undefined}
      className={className ? `tape-row ${className}` : "tape-row"}
    >
      {children}
    </li>
  );
}
