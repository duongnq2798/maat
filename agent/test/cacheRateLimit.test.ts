import { describe, expect, it } from "vitest";
import { TtlCache } from "../src/guard/cache.js";
import { clientKey, RateLimiter } from "../src/guard/rateLimit.js";

describe("TtlCache", () => {
  it("serves one load per key per TTL and shares the in-flight promise", async () => {
    let t = 0;
    let loads = 0;
    const cache = new TtlCache<number>(15_000, () => t);
    const load = async () => ++loads;
    const [a, b] = await Promise.all([cache.get("k", load), cache.get("k", load)]);
    expect([a, b, loads]).toEqual([1, 1, 1]);
    t = 14_999;
    expect(await cache.get("k", load)).toBe(1);
    t = 15_000;
    expect(await cache.get("k", load)).toBe(2);
    expect(await cache.get("other", load)).toBe(3);
  });

  it("does not cache a failed load", async () => {
    const cache = new TtlCache<number>(15_000, () => 0);
    await expect(cache.get("k", async () => Promise.reject(new Error("rpc down")))).rejects.toThrow("rpc down");
    expect(await cache.get("k", async () => 7)).toBe(7);
  });
});

describe("RateLimiter", () => {
  it("allows perMinute requests per key per minute, then gives a retry delay", () => {
    let t = 0;
    const rl = new RateLimiter(2, () => t);
    expect([rl.take("a"), rl.take("a"), rl.take("b")]).toEqual([0, 0, 0]);
    t = 20_000;
    expect(rl.take("a")).toBe(40);
    t = 60_000;
    expect(rl.take("a")).toBe(0);
  });
});

describe("clientKey", () => {
  const h = (m: Record<string, string>) => new Headers(m);
  it("prefers Fly-Client-IP, then the first X-Forwarded-For hop, then one shared bucket", () => {
    expect(clientKey(h({ "fly-client-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" }))).toBe("1.1.1.1");
    expect(clientKey(h({ "x-forwarded-for": "2.2.2.2, 10.0.0.1" }))).toBe("2.2.2.2");
    expect(clientKey(h({}))).toBe("local");
  });
});
