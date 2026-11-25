/** The most blocks one eth_getLogs asks for: 30 minutes of Base's 200 ms blocks. */
export const MAX_LOG_RANGE = 9_000n;
/**
 * The window a range error halves down to: mainnet.base.org's limit ("eth_getLogs is limited to a 200 range", as
 * web/lib/chain/scan.ts records it). The fallback RPC can be that endpoint.
 */
export const MIN_LOG_RANGE = 200n;

export interface BlockWindow {
  fromBlock: bigint;
  toBlock: bigint;
}

// The same test as web/lib/chain/scan.ts. "limited to" only with a block count and "range" after it:
// "limited to 25 per second" is a rate limit.
const RANGE_ERROR = /block range|ranges? over|limited to (?:a )?[\d,\s-]+(?:blocks? )?range|max(?:imum)? (?:block )?range/i;

/** True when an RPC refused an eth_getLogs call for spanning too many blocks (the message varies by provider). */
export function isRangeError(e: unknown, depth = 0): boolean {
  if (e === null || typeof e !== "object" || depth > 4) return false;
  const o = e as { message?: unknown; details?: unknown; shortMessage?: unknown; cause?: unknown };
  const text = [o.message, o.details, o.shortMessage].filter((t): t is string => typeof t === "string").join(" ");
  return RANGE_ERROR.test(text) || isRangeError(o.cause, depth + 1);
}

/**
 * Reads [from, to] oldest first, in inclusive windows of at most `size` blocks with no gap and no overlap, and returns
 * the first value `read` finds. A range error halves the window and retries it, down to `min` blocks; the smaller
 * window holds for the rest of the scan. A range error at `min`, or any other error, is thrown.
 */
export async function firstInLogWindows<T>(
  from: bigint,
  to: bigint,
  read: (w: BlockWindow) => Promise<T | undefined>,
  size: bigint = MAX_LOG_RANGE,
  min: bigint = MIN_LOG_RANGE,
): Promise<T | undefined> {
  if (min < 1n || size < min) throw new Error(`a log window needs at least one block and size >= min, got ${size} and ${min}`);
  for (let start = from; start <= to; ) {
    const end = start + size - 1n < to ? start + size - 1n : to;
    let found: T | undefined;
    try {
      found = await read({ fromBlock: start, toBlock: end });
    } catch (e) {
      if (!isRangeError(e) || size === min) throw e;
      size = size / 2n > min ? size / 2n : min;
      continue;
    }
    if (found !== undefined) return found;
    start = end + 1n;
  }
  return undefined;
}
