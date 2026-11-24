import type { ComponentProps, ReactNode } from "react";

export interface ReadoutProps extends Omit<ComponentProps<"div">, "className"> {
  /**
   * The height per breakpoint, as Tailwind classes written out where the Readout is used, for example
   * "min-h-[132px] md:min-h-[112px]": sized for the tallest state at that breakpoint's narrowest width, so nothing
   * under the window moves when a reading lands (spec 2026-11-23 sections 3.5 and 5.1). A min-height keeps that height
   * while every state fits, and grows the window rather than let a taller state run over what is under it.
   */
  reserve: string;
  className?: string;
}

/** The window's own classes: a chassis-2 display window, radius 14, a 1 px chassis-line bezel, lcd text. */
export const READOUT_CLASS =
  "box-border w-full rounded-[14px] border border-chassis-line bg-chassis-2 px-4 py-3 text-lcd focus-visible:outline-pass-lit";

/**
 * The display window a live reading sits in, 100% of its column wide. It renders one div and passes every other prop
 * through, so the live strip keeps data-live-strip, tabIndex={-1} and the useRetry ref on this one element, and its
 * children stay the div's direct children in the order given (the sr-only announcer, the one <p>, the bezel keys,
 * the <noscript>). It adds no aria-live: the strip's announcer stays the only live region inside it.
 */
export function Readout({ reserve, className, children, ...rest }: ReadoutProps) {
  const classes = [READOUT_CLASS, reserve, className].filter(Boolean).join(" ");
  return (
    <div data-readout="" {...rest} className={classes}>
      {children}
    </div>
  );
}

export interface ReadoutKeysProps {
  children: ReactNode;
  className?: string;
}

/** The bezel keys under the reading: a div, never a <p>, so the strip keeps exactly one <p> child (spec 3.5). */
export function ReadoutKeys({ children, className }: ReadoutKeysProps) {
  const classes = ["flex flex-wrap items-center gap-2 font-mono text-[11px] text-lcd-2", className].filter(Boolean).join(" ");
  return (
    <div data-readout-keys="" className={classes}>
      {children}
    </div>
  );
}
