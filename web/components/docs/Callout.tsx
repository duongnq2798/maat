import { Callout as FumadocsCallout } from "fumadocs-ui/components/callout";
import type { CSSProperties, ReactNode } from "react";

type CalloutType = "note" | "warning" | "fork";

interface CalloutProps {
  type?: CalloutType;
  title?: ReactNode;
  children: ReactNode;
}

function ForkIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="-me-0.5 size-5 shrink-0 text-(--callout-color)"
    >
      <circle cx="12" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <circle cx="18" cy="6" r="3" />
      <path d="M18 9v2a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V9" />
      <path d="M12 12v3" />
    </svg>
  );
}

/**
 * The docs callout: note (information), warning, or fork (true on a mainnet fork, not yet on mainnet).
 * MDX props are not type-checked, so an unknown type fails the build instead of rendering as a note.
 */
export function Callout({ type = "note", title, children }: CalloutProps) {
  if (type === "fork") {
    return (
      <FumadocsCallout
        type="info"
        data-callout="fork"
        icon={<ForkIcon />}
        title={title ?? "Fork only"}
        style={{ "--callout-color": "var(--color-fd-primary)" } as CSSProperties}
      >
        {children}
      </FumadocsCallout>
    );
  }
  if (type !== "note" && type !== "warning") throw new Error(`<Callout type="${String(type)}"> must be note, warning or fork`);
  return (
    <FumadocsCallout type={type === "note" ? "info" : "warning"} data-callout={type} title={title}>
      {children}
    </FumadocsCallout>
  );
}
