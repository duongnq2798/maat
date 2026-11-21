import { closedWindows, type ClosedWindow } from "@/lib/gap/windows";

/** An edition is a date range; its windows are the closed windows whose close falls in it (spec section 2). */
export interface EditionDef {
  edition: number;
  title: string;
  from: string;
  to: string;
}

export const EDITIONS: readonly EditionDef[] = [
  { edition: 0, title: "Three weekends, 6 to 23 November 2026", from: "2026-11-06", to: "2026-11-22" },
  { edition: 1, title: "Thanksgiving week, 25 to 30 November 2026", from: "2026-11-23", to: "2026-11-29" },
];

export function editionWindows(e: EditionDef): ClosedWindow[] {
  return closedWindows(e.from, e.to);
}
