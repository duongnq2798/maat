import type { ComponentProps, ReactNode } from "react";
import { SMALL_TEXT, type Surface } from "./types";

/**
 * Where a figure comes from (spec 2026-11-23 section 4), each with its shape: live a filled dot, replay a ring with
 * hatch, edition a square, simulated an outline, planned a dashed ring.
 */
export type PlateKind = "live" | "replay" | "edition" | "simulated" | "planned";

export interface SourcePlateProps extends Omit<ComponentProps<"span">, "className" | "children"> {
  kind: PlateKind;
  on?: Surface;
  /** The plate's words in their DOM case, for example "replay · Base fork · block 53,551,627": CSS uppercases them. */
  children: ReactNode;
  className?: string;
}

/**
 * A provenance plate: an aria-hidden shape, then the words. The words stay in the case they are written in, so a test
 * that matches the lower-case DOM text still matches; `uppercase` and the .12em engraving come from CSS. Other props,
 * such as data-fact, pass through to the plate.
 */
export function SourcePlate({ kind, on = "faceplate", children, className, ...rest }: SourcePlateProps) {
  const classes = ["plate inline-flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase", SMALL_TEXT[on], className]
    .filter(Boolean)
    .join(" ");
  return (
    <span data-plate={kind} {...rest} className={classes}>
      <span data-plate-shape="" aria-hidden="true" />
      {children}
    </span>
  );
}
