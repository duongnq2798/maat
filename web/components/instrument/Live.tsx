import type { LiveSnapshot } from "@/lib/live/snapshot";

/** The part of a snapshot a live mark names: the block, the RPC host that answered, and the block's time. */
export type LiveSource = Pick<LiveSnapshot, "block" | "timestamp" | "endpoint">;

export interface LiveAttrs {
  "data-live": string;
  "data-live-host": string;
  "data-live-time": string;
}

/** The attributes that mark a value read from the chain: block number, RPC host, block timestamp in seconds. */
export function liveAttrs(snapshot: LiveSource): LiveAttrs {
  return {
    "data-live": snapshot.block.toString(),
    "data-live-host": new URL(snapshot.endpoint).host,
    "data-live-time": String(snapshot.timestamp),
  };
}

/** The elements a live value may sit in. */
export type LiveTag = "span" | "strong" | "dd" | "td" | "p";

export interface LiveProps {
  snapshot: LiveSource;
  as?: LiveTag;
  /** The value as written, for example formatBlock(snapshot.block). */
  children: string;
  className?: string;
}

/**
 * Marks a value read from the chain (spec 2026-11-23 sections 5.1 and 10.2), on the element that holds it. Only client
 * code has a snapshot, so a live mark is never in the static HTML.
 */
export function Live({ snapshot, as: Tag = "span", children, className }: LiveProps) {
  return (
    <Tag {...liveAttrs(snapshot)} className={className}>
      {children}
    </Tag>
  );
}
