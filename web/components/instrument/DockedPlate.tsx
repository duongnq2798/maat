import { Lamp } from "./Lamp";

/**
 * The docked readout's unlit frame, for the pages that read no chain (spec 2026-11-23 section 7.5, amendment A6): an
 * unlit lamp and "Live on / and /now", linked to /now. It holds no live value and makes no RPC request, so it is
 * server-safe. `className` holds its display classes, "inline-flex" unless the caller hides it below a breakpoint.
 */
export function DockedPlate({ className = "inline-flex" }: { className?: string }) {
  return (
    <a
      href="/now"
      data-docked-plate="unlit"
      className={`min-h-11 items-center gap-2 rounded-full border border-line px-3 font-mono text-[11px] text-label ${className}`}
    >
      <Lamp state="reading" />
      Live on / and /now
    </a>
  );
}
