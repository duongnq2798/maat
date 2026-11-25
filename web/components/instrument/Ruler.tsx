/** The tick ruler's geometry (spec 2026-11-23 section 5.1); `.ruler` in app/globals.css draws it with these numbers. */
export const RULER = { minorPx: 8, majorPx: 56, heightPx: 12 } as const;

/** A decorative tick ruler: a minor tick every 8 px, a major one every 56 px. aria-hidden, and it holds no text. */
export function Ruler({ className }: { className?: string }) {
  return <div aria-hidden="true" data-ruler="" className={className ? `ruler ${className}` : "ruler"} />;
}
