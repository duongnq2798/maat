// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLedgerClient, DEFAULT_RPCS } from "@/lib/chain/rpc";
import { scanLogs } from "@/lib/chain/scan";
import { FAKE_VAULT } from "./helpers/fake-ledger";

// The real viem transport stack under createLedgerClient, with fetch replaced: each endpoint answers HTTP 200 and
// puts its refusals in the JSON-RPC error field, as public RPCs do.
type Rpc = { id: number; method: string; params: unknown[] };
type Answer = { result: unknown } | { error: { code: number; message: string } };

const PUBLICNODE = DEFAULT_RPCS[0];
const BASE_ORG = DEFAULT_RPCS[1];
// mainnet.base.org refuses eth_getLogs over more than 200 blocks, which no scan chunk is.
const baseOrg = (rpc: Rpc): Answer =>
  rpc.method === "eth_getLogs" ? { error: { code: -32000, message: "eth_getLogs is limited to a 200 range" } } : { result: "0x10" };

function fakeRpcs(answer: Record<string, (rpc: Rpc) => Answer>) {
  const seen: { url: string; method: string }[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input).replace(/\/$/, "");
    const body = JSON.parse(String(init?.body)) as Rpc | Rpc[];
    const reply = (rpc: Rpc) => {
      seen.push({ url, method: rpc.method });
      return { jsonrpc: "2.0", id: rpc.id, ...answer[url]!(rpc) };
    };
    const out = Array.isArray(body) ? body.map(reply) : reply(body);
    return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
  });
  const calls = (url: string, method: string) => seen.filter((s) => s.url === url && s.method === method).length;
  return { calls };
}

const span = (rpc: Rpc) => {
  const [filter] = rpc.params as [{ fromBlock: string; toBlock: string }];
  return Number(BigInt(filter.toBlock) - BigInt(filter.fromBlock)) + 1;
};

const scan = (client = createLedgerClient([...DEFAULT_RPCS])) =>
  scanLogs({
    from: 1n,
    to: 100_000n,
    minSpan: 6_250n,
    maxFailed: 3,
    getLogs: async (r) => client.getLogs({ address: FAKE_VAULT, fromBlock: r.from, toBlock: r.to }),
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createLedgerClient", () => {
  it("treats a rate limit inside HTTP 200 as a failed chunk: no split, no detour to an RPC that cannot serve it", async () => {
    const rpc = fakeRpcs({
      [PUBLICNODE]: (r) => (r.method === "eth_getLogs" ? { error: { code: -32005, message: "rate limit exceeded" } } : { result: "0x10" }),
      [BASE_ORG]: baseOrg,
    });
    const result = await scan();
    expect(result.scanned).toBeNull();
    expect(result.failed).toEqual([
      { from: 50_001n, to: 100_000n },
      { from: 1n, to: 50_000n },
    ]);
    expect(rpc.calls(BASE_ORG, "eth_getLogs")).toBe(0);
    // Two tries per call (one retry) and the scan's own retry of each chunk: at most 4 per chunk.
    expect(rpc.calls(PUBLICNODE, "eth_getLogs")).toBeLessThanOrEqual(8);
  }, 20_000);

  it("splits a chunk the RPC refuses for its range, and reads it all", async () => {
    const rpc = fakeRpcs({
      [PUBLICNODE]: (r) =>
        r.method !== "eth_getLogs"
          ? { result: "0x10" }
          : span(r) > 25_000
            ? { error: { code: -32000, message: "exceed maximum block range: 25000" } }
            : { result: [] },
      [BASE_ORG]: baseOrg,
    });
    const result = await scan();
    expect(result.scanned).toEqual({ from: 1n, to: 100_000n });
    expect(result.failed).toEqual([]);
    expect(rpc.calls(BASE_ORG, "eth_getLogs")).toBe(0);
  }, 20_000);

  it("still falls back to mainnet.base.org for the other reads", async () => {
    const rpc = fakeRpcs({
      [PUBLICNODE]: () => ({ error: { code: -32603, message: "internal error" } }),
      [BASE_ORG]: baseOrg,
    });
    await expect(createLedgerClient([...DEFAULT_RPCS]).getBlockNumber()).resolves.toBe(16n);
    expect(rpc.calls(BASE_ORG, "eth_blockNumber")).toBeGreaterThan(0);
  }, 20_000);
});
