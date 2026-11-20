import { describe, expect, it, vi } from "vitest";
import { createReader, LIVE_RPCS, RpcError } from "@/lib/live/rpc";

const ok = (result: string) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
const rpcError = (message: string) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32011, message } }), { status: 200 });

describe("the keyless live reader", () => {
  it("tries the keyless endpoints in order, publicnode first", () => {
    expect(LIVE_RPCS).toEqual(["https://base-rpc.publicnode.com", "https://mainnet.base.org"]);
  });

  it("sends one eth_call and returns the data with the endpoint that answered", async () => {
    const f = vi.fn(async () => ok("0xabcd"));
    const reader = createReader({ fetch: f as unknown as typeof fetch });
    await expect(reader.call({ to: "0x01", data: "0x02" }, "latest")).resolves.toEqual({ data: "0xabcd", endpoint: LIVE_RPCS[0] });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(LIVE_RPCS[0]);
    expect(JSON.parse(String(init.body))).toMatchObject({ method: "eth_call", params: [{ to: "0x01", data: "0x02" }, "latest"] });
  });

  it("sends a block number as a hex tag", async () => {
    const f = vi.fn(async () => ok("0x11"));
    await createReader({ fetch: f as unknown as typeof fetch }).call({ to: "0x01", data: "0x02" }, 60_013_066n);
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).params[1]).toBe("0x393ba0a");
  });

  it("falls back on a JSON-RPC error body", async () => {
    const f = vi.fn().mockResolvedValueOnce(rpcError("request limit reached")).mockResolvedValueOnce(ok("0x11"));
    const r = await createReader({ fetch: f as unknown as typeof fetch }).call({ to: "0x01", data: "0x02" }, "latest");
    expect(r).toEqual({ data: "0x11", endpoint: LIVE_RPCS[1] });
  });

  it("falls back on HTTP errors and network failures, then reports every failure", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response("busy", { status: 503 })).mockRejectedValueOnce(new TypeError("fetch failed"));
    const p = createReader({ fetch: f as unknown as typeof fetch }).call({ to: "0x01", data: "0x02" }, "latest");
    await expect(p).rejects.toBeInstanceOf(RpcError);
    await p.catch((e: RpcError) => {
      expect(e.failures.map((x) => x.endpoint)).toEqual([...LIVE_RPCS]);
      expect(e.failures[0]?.message).toContain("503");
      expect(e.failures[1]?.message).toContain("fetch failed");
    });
  });

  it("gives up on an endpoint after the timeout", async () => {
    vi.useFakeTimers();
    try {
    const f = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted")))));
    const p = createReader({ fetch: f as unknown as typeof fetch, timeoutMs: 8000, urls: ["https://a.example"] }).call({ to: "0x01", data: "0x02" }, "latest");
    const caught = p.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(8000);
    const err = await caught;
    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).failures[0]?.message).toContain("no answer in 8 s");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a result that is not hex", async () => {
    const f = vi.fn(async () => ok("nope"));
    await expect(createReader({ fetch: f as unknown as typeof fetch, urls: ["https://a.example"] }).call({ to: "0x01", data: "0x02" }, "latest")).rejects.toBeInstanceOf(RpcError);
  });

  it("treats an empty result as a failed endpoint and moves on", async () => {
    const f = vi.fn().mockResolvedValueOnce(ok("0x")).mockResolvedValueOnce(ok("0x11"));
    const r = await createReader({ fetch: f as unknown as typeof fetch }).call({ to: "0x01", data: "0x02" }, "latest");
    expect(r).toEqual({ data: "0x11", endpoint: LIVE_RPCS[1] });
  });

  it("reports both messages when both endpoints return a JSON-RPC error", async () => {
    const f = vi.fn().mockResolvedValueOnce(rpcError("request limit reached")).mockResolvedValueOnce(rpcError("over rate limit"));
    const err = await createReader({ fetch: f as unknown as typeof fetch }).call({ to: "0x01", data: "0x02" }, "latest").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).failures).toEqual([
      { endpoint: LIVE_RPCS[0], message: "request limit reached" },
      { endpoint: LIVE_RPCS[1], message: "over rate limit" },
    ]);
  });
});
