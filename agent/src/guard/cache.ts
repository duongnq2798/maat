/**
 * A time-to-live cache that also shares the in-flight promise, so a burst of requests for one key costs one RPC round.
 * A rejected load is never cached: the next request tries again.
 */
export class TtlCache<T> {
  private entries = new Map<string, { at: number; value: Promise<T> }>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 1_000,
  ) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value;
    if (this.entries.size >= this.maxEntries) this.entries.clear(); // keys are bounded in practice; this is a backstop
    const value = load();
    this.entries.set(key, { at: this.now(), value });
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    return value;
  }
}
