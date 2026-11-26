/** What a ghost may show: unlit 8s, and the separators a reading keeps. */
const GHOST_PATTERN = /^[8,.: ]+$/;

/** The unlit shape of a reading like `sample`: every digit becomes an 8, so "60,013,066" gives "88,888,888". */
export function ghostOf(sample: string): string {
  return sample.replace(/\d/g, "8");
}

export interface GhostProps {
  /** The unlit shape, for example "88,888,888": 8s and the separators , . : and space only. */
  pattern: string;
  className?: string;
}

/**
 * Unlit segments: "not read yet" (spec 2026-11-23 sections 4 and 5.1). The 8s are CSS generated content on an empty
 * aria-hidden span, so they are in no accessible text and no textContent, and never read as a 0. `.ghost` in
 * app/globals.css draws them, and hides them under forced-colors.
 */
export function Ghost({ pattern, className }: GhostProps) {
  if (!GHOST_PATTERN.test(pattern)) {
    throw new Error(`a ghost pattern holds only 8s and the separators , . : or space: ${JSON.stringify(pattern)}`);
  }
  return <span aria-hidden="true" data-ghost={pattern} className={className ? `ghost ${className}` : "ghost"} />;
}
