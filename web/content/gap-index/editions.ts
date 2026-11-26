import { closedWindows, type ClosedWindow } from "@/lib/gap/windows";

/** A window as an edition lists it: its id and its two edges in UTC. */
export interface ListedWindow {
  id: string;
  close: string;
  open: string;
}

/** An edition is a date range; its windows are the closed windows whose close falls in it (spec section 2). */
export interface EditionDef {
  edition: number;
  title: string;
  from: string;
  to: string;
  /**
   * The windows written out, when the edition lists them: editionWindows refuses the edition unless the calendar gives
   * exactly these, and the script checks each edge against MarketCalendar on Base before it measures.
   */
  windows?: readonly ListedWindow[];
  /** Each measured window also counts the vault's Decisions in its blocks. */
  decisions?: boolean;
}

export const EDITIONS: readonly EditionDef[] = [
  { edition: 0, title: "Three weekends, 6 to 23 November 2026", from: "2026-11-06", to: "2026-11-22" },
  {
    edition: 1,
    title: "Thanksgiving week, 25 to 30 November 2026",
    from: "2026-11-23",
    to: "2026-11-29",
    windows: [
      // Wednesday's close to Friday's open: Thanksgiving, Thursday 26 November, has no session.
      { id: "2026-11-25", close: "2026-11-25T21:00:00Z", open: "2026-11-27T14:30:00Z" },
      // Friday's early close at 13:00 ET to Monday's open.
      { id: "2026-11-27", close: "2026-11-27T18:00:00Z", open: "2026-11-30T14:30:00Z" },
    ],
    decisions: true,
  },
];

const utcIso = (ts: number) => new Date(ts * 1000).toISOString().replace(".000Z", "Z");
const edges = (ws: readonly ListedWindow[]) => ws.map((w) => `${w.id} ${w.close} → ${w.open}`).join(", ");

export function editionWindows(e: EditionDef): ClosedWindow[] {
  const found = closedWindows(e.from, e.to);
  if (e.windows) {
    const calendar = edges(found.map((w) => ({ id: w.id, close: utcIso(w.closeTs), open: utcIso(w.openTs) })));
    if (edges(e.windows) !== calendar) {
      throw new Error(`edition ${e.edition}: its listed windows (${edges(e.windows)}) are not the calendar's (${calendar})`);
    }
  }
  return found;
}
