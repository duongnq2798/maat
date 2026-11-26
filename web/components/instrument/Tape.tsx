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
   * A row that landed while the page is open: it prints in once (`print`, 260 ms, clip-path). Rows in the static HTML
   * are never fresh, so they render at their final frame.
   */
  fresh?: boolean;
  children: ReactNode;
  className?: string;
}

/** One printed row. Its words carry the verdict; data-verdict only sets the colour of its rule. */
export function TapeRow({ verdict, fresh = false, children, className }: TapeRowProps) {
  return (
    <li
      data-tape-row=""
      data-verdict={verdict}
      data-fresh={fresh ? "" : undefined}
      className={className ? `tape-row ${className}` : "tape-row"}
    >
      {children}
    </li>
  );
}
