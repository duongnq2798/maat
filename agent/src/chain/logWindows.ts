/** The most blocks one eth_getLogs asks for. Free Base RPCs cap a query at about 10,000 (33 minutes of 200 ms blocks). */
export const MAX_LOG_RANGE = 9_000n;

export interface BlockWindow {
  fromBlock: bigint;
  toBlock: bigint;
}

/** Inclusive windows of at most `size` blocks covering [from, to], oldest first, with no gap and no overlap. */
export function* logWindows(from: bigint, to: bigint, size: bigint = MAX_LOG_RANGE): Generator<BlockWindow> {
  if (size < 1n) throw new Error(`a log window needs at least one block, got ${size}`);
  for (let start = from; start <= to; start += size) {
    const end = start + size - 1n;
    yield { fromBlock: start, toBlock: end < to ? end : to };
  }
}
