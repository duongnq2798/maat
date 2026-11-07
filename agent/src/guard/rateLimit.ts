import type { MiddlewareHandler } from "hono";

/** Fixed one-minute window per client key. In memory: one Fly machine runs the guard. */
export class RateLimiter {
  private windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Seconds until the caller may retry, or 0 when this request is allowed. */
  take(key: string): number {
    const t = this.now();
    const w = this.windows.get(key);
    if (!w || t - w.start >= 60_000) {
      if (this.windows.size > 10_000) this.windows.clear();
      this.windows.set(key, { start: t, count: 1 });
      return 0;
    }
    if (w.count >= this.perMinute) return Math.ceil((w.start + 60_000 - t) / 1000);
    w.count += 1;
    return 0;
  }
}

/**
 * Fly's proxy sets Fly-Client-IP; the first X-Forwarded-For hop is the fallback for other proxies. Without either
 * (a local run) every caller shares one bucket, which is the safe direction to fail.
 */
export function clientKey(headers: { get(name: string): string | null | undefined }): string {
  return headers.get("fly-client-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

export function rateLimit(limiter: RateLimiter): MiddlewareHandler {
  return async (c, next) => {
    const retry = limiter.take(clientKey(c.req.raw.headers));
    if (retry > 0) {
      c.header("Retry-After", String(retry));
      return c.json({ error: "RATE_LIMITED", retryAfterSeconds: retry }, 429);
    }
    await next();
  };
}
