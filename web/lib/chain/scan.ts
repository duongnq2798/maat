/** Inclusive block range. */
export interface BlockRange {
  from: bigint;
  to: bigint;
}

/**
 * The largest eth_getLogs range base-rpc.publicnode.com accepts ("exceed maximum block range: 50000", measured
 * 2026-11-20). Base makes about five blocks a second, so one chunk is under three hours.
 */
export const LOG_CHUNK = 50_000n;
/** mainnet.base.org's limit ("eth_getLogs is limited to a 200 range"): the smallest chunk worth trying. */
export const MIN_LOG_CHUNK = 200n;

/** `[from, to]` in chunks of `span` blocks, newest first; the oldest chunk is clipped at `from`. */
export function planChunks(from: bigint, to: bigint, span: bigint): BlockRange[] {
  const out: BlockRange[] = [];
  for (let hi = to; hi >= from; hi -= span) {
    const lo = hi - span + 1n;
    out.push({ from: lo > from ? lo : from, to: hi });
  }
  return out;
}

const RANGE_ERROR = /block range|ranges? over|limited to|max(?:imum)? (?:block )?range/i;

/** True when an RPC refused an eth_getLogs call for spanning too many blocks (the message varies by provider). */
export function isRangeError(e: unknown, depth = 0): boolean {
  if (e === null || typeof e !== "object" || depth > 4) return false;
  const o = e as { message?: unknown; details?: unknown; shortMessage?: unknown; cause?: unknown };
  const text = [o.message, o.details, o.shortMessage].filter((t): t is string => typeof t === "string").join(" ");
  return RANGE_ERROR.test(text) || isRangeError(o.cause, depth + 1);
}

export interface ScanOptions<L> {
  from: bigint;
  to: bigint;
  span?: bigint;
  minSpan?: bigint;
  concurrency?: number;
  getLogs: (range: BlockRange) => Promise<L[]>;
  onChunk?: (chunk: BlockRange & { logs: L[] }) => void;
  signal?: AbortSignal;
  /** Stop taking new chunks once this many have failed (default: never). */
  maxFailed?: number;
}

export interface ScanResult<L> {
  /** Logs of every completed chunk, newest chunk first, each chunk in the order the RPC returned it. */
  logs: L[];
  /** The contiguous range down from `to` that completed, or null when the newest chunk did not. */
  scanned: BlockRange | null;
  /** Ranges given up on: a non-range error twice, or a range error at the minimum span. */
  failed: BlockRange[];
  /** True when the scan stopped early because `maxFailed` chunks failed. */
  stopped: boolean;
}

const aborted = () => new DOMException("The log scan was aborted.", "AbortError");

/**
 * Reads logs over `[from, to]` newest first, `concurrency` chunks at a time. A range error splits the chunk in two and
 * retries both halves first; any other error retries the chunk once.
 */
export async function scanLogs<L>(opts: ScanOptions<L>): Promise<ScanResult<L>> {
  const { from, to, getLogs, onChunk, signal } = opts;
  const minSpan = opts.minSpan ?? MIN_LOG_CHUNK;
  const queue = planChunks(from, to, opts.span ?? LOG_CHUNK).map((range) => ({ range, retried: false }));
  const done: (BlockRange & { logs: L[] })[] = [];
  const failed: BlockRange[] = [];
  const maxFailed = opts.maxFailed ?? Number.POSITIVE_INFINITY;

  const worker = async () => {
    for (;;) {
      if (signal?.aborted) throw aborted();
      if (failed.length >= maxFailed) return;
      const job = queue.shift();
      if (!job) return;
      try {
        const logs = await getLogs(job.range);
        const chunk = { ...job.range, logs };
        done.push(chunk);
        onChunk?.(chunk);
      } catch (e) {
        const { from: lo, to: hi } = job.range;
        const size = hi - lo + 1n;
        if (isRangeError(e) && size > minSpan) {
          const mid = lo + size / 2n - 1n;
          queue.unshift({ range: { from: mid + 1n, to: hi }, retried: false }, { range: { from: lo, to: mid }, retried: false });
        } else if (!isRangeError(e) && !job.retried) {
          queue.unshift({ range: job.range, retried: true });
        } else {
          failed.push(job.range);
        }
      }
    }
  };

  const n = Math.max(1, opts.concurrency ?? 6);
  await Promise.all(Array.from({ length: n }, worker));

  done.sort((a, b) => (a.to === b.to ? 0 : a.to > b.to ? -1 : 1));
  failed.sort((a, b) => (a.to === b.to ? 0 : a.to > b.to ? -1 : 1));
  let low = to + 1n;
  for (const c of done) {
    if (c.to !== low - 1n) break;
    low = c.from;
  }
  return {
    logs: done.flatMap((c) => c.logs),
    scanned: low <= to ? { from: low, to } : null,
    failed,
    stopped: failed.length >= maxFailed && queue.length > 0,
  };
}
