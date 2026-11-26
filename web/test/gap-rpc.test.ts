// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createLogReader, GAP_RPC, GAP_RPC_FIRST_BLOCK, GAP_RPC_FIRST_BLOCK_TS, SPAN } from "@/lib/gap/rpc";
import type { RawLog } from "@/lib/gap/decode";

interface Req {
  method: string;
  params: unknown[];
}
type Script = (req: Req, n: number) => unknown;

function fake(script: Script) {
  const calls: Req[] = [];
  const f = (async (_url: string, init: { body: string }) => {
    const req = JSON.parse(init.body) as Req & { id: number };
    calls.push(req);
    const out = script(req, calls.length);
    if (out instanceof Response) return out;
    const body = out instanceof Error ? { jsonrpc: "2.0", id: req.id, error: { message: out.message } } : { jsonrpc: "2.0", id: req.id, result: out };
    return new Response(JSON.stringify(body));
  }) as unknown as typeof fetch;
  return { f, calls };
}
const noSleep = async () => {};
const log = (block: number, idx: number): RawLog => ({
  address: "0xaa",
  topics: ["0x01"],
  data: "0x",
  blockNumber: `0x${block.toString(16)}`,
  logIndex: `0x${idx.toString(16)}`,
  transactionHash: "0xbb",
});
const range = (r: Req) => {
  const q = r.params[0] as { fromBlock: string; toBlock: string };
  return [Number(q.fromBlock), Number(q.toBlock)] as const;
};

describe("getLogs", () => {
  it("splits a long range into spans of at most 50,000 blocks", async () => {
    const { f, calls } = fake(() => []);
    const r = createLogReader({ fetch: f, sleep: noSleep });
    await r.getLogs({ address: "0xaa", topic0: "0x01", from: 0, to: 120_000 });
    expect(SPAN).toBe(50_000);
    expect(calls.map((c) => c.params[0])).toEqual([
      { address: "0xaa", topics: ["0x01"], fromBlock: "0x0", toBlock: "0xc34f" },
      { address: "0xaa", topics: ["0x01"], fromBlock: "0xc350", toBlock: "0x1869f" },
      { address: "0xaa", topics: ["0x01"], fromBlock: "0x186a0", toBlock: "0x1d4c0" },
    ]);
  });

  it("retries a refused span, then halves it, and merges in order", async () => {
    const { f, calls } = fake((req) => {
      const [a, b] = range(req);
      if (a === 0 && b === 49_999) return new Error("range too large");
      return a === 0 ? [log(10, 2)] : [log(30_000, 1), log(10, 1)];
    });
    const sleeps: number[] = [];
    const r = createLogReader({ fetch: f, sleep: async (ms) => void sleeps.push(ms) });
    const out = await r.getLogs({ address: "0xaa", topic0: "0x01", from: 0, to: 49_999 });
    expect(calls.length).toBe(5);
    expect(sleeps).toEqual([1000, 2000]);
    expect(out.map((l) => [l.blockNumber, l.logIndex])).toEqual([
      ["0xa", "0x1"],
      ["0xa", "0x2"],
      ["0x7530", "0x1"],
    ]);
  });

  it("fails at the floor naming the blocks", async () => {
    const { f } = fake(() => new Error("nope"));
    const r = createLogReader({ fetch: f, sleep: noSleep, minSpan: 1000 });
    await expect(r.getLogs({ address: "0xaa", topic0: "0x01", from: 0, to: 1_999 })).rejects.toThrow(/eth_getLogs refused blocks 0-999: .*nope/);
  });

  it("rejects more than 10 addresses before any call", async () => {
    const { f, calls } = fake(() => []);
    const r = createLogReader({ fetch: f, sleep: noSleep });
    const addrs = Array.from({ length: 11 }, (_, i) => `0x${i}`);
    await expect(r.getLogs({ address: addrs, topic0: "0x01", from: 0, to: 10 })).rejects.toThrow(/10 addresses/);
    expect(calls.length).toBe(0);
  });
});

describe("rpc errors", () => {
  it("throws RpcRefused on HTTP errors, JSON-RPC errors, bad bodies and timeouts", async () => {
    const cases: Script[] = [() => new Response("x", { status: 503 }), () => new Error("boom"), () => new Response("<html>"), () => new Response("null"), () => new Response("3")];
    for (const s of cases) {
      const { f } = fake(s);
      await expect(createLogReader({ fetch: f, sleep: noSleep }).call("0xaa", "0x00")).rejects.toMatchObject({ name: "RpcRefused" });
    }
    const hang = (async (_u: string, init: { signal: AbortSignal }) =>
      new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(init.signal.reason)))) as unknown as typeof fetch;
    await expect(createLogReader({ fetch: hang, sleep: noSleep, timeoutMs: 5 }).head()).rejects.toMatchObject({ name: "RpcRefused" });
  });

  it("defaults to the keyless endpoint", () => {
    expect(GAP_RPC).toBe("https://base-rpc.publicnode.com");
  });
});

describe("blocks", () => {
  const chain =
    (head: number): Script =>
    (req) => {
      if (req.method === "eth_blockNumber") return `0x${head.toString(16)}`;
      if (req.method === "eth_getBlockByNumber") {
        const n = Number(req.params[0]);
        return { timestamp: `0x${(1000 + Math.floor(n / 5)).toString(16)}` };
      }
      return null;
    };

  it("blockAt finds the first block at or after a timestamp", async () => {
    const { f } = fake(chain(1000));
    const r = createLogReader({ fetch: f, sleep: noSleep });
    expect(await r.blockAt(1003)).toBe(15);
    expect(await r.blockAt(1000)).toBe(0);
    expect(await r.blockAt(1200)).toBe(1000);
    expect(await r.blockTs(15)).toBe(1003);
    expect(await r.head()).toEqual({ block: 1000, ts: 1200 });
  });

  describe("blockAt on Base's real shape", () => {
    // 2 s blocks from the endpoint's floor to ERA, then 0.2 s blocks (5 per whole second); the endpoint refuses below FLOOR.
    const FLOOR = GAP_RPC_FIRST_BLOCK;
    const ERA = 53_556_000;
    const HEAD = 60_094_127;
    const T_FLOOR = GAP_RPC_FIRST_BLOCK_TS;
    const tsOf = (n: number) => (n <= ERA ? T_FLOOR + (n - FLOOR) * 2 : T_FLOOR + (ERA - FLOOR) * 2 + Math.floor((n - ERA) / 5));
    const firstAtOrAfter = (ts: number) => {
      let lo = FLOOR;
      let hi = HEAD;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (tsOf(mid) >= ts) hi = mid;
        else lo = mid + 1;
      }
      return lo;
    };
    const setup = () => {
      const asked: number[] = [];
      const { f } = fake((req) => {
        if (req.method === "eth_blockNumber") return `0x${HEAD.toString(16)}`;
        const n = Number(req.params[0]);
        if (n > HEAD) throw new Error(`asked above the head: ${n}`);
        asked.push(n);
        if (n < FLOOR) return new Response(JSON.stringify({ error: { code: -32602, message: "Archive requests require a personal token" } }), { status: 403 });
        return { timestamp: `0x${tsOf(n).toString(16)}` };
      });
      return { asked, r: createLogReader({ fetch: f, sleep: noSleep }) };
    };
    /** Distinct headers read per call, the head included: measured 7 to 28 (a handful of interpolation steps; near the floor a bisection of refused probes). Each refused header is asked 3 times by the reader. */
    const MAX_HEADERS = 30;

    const targets: [string, number][] = [
      ["just above the floor", T_FLOOR + 1],
      ["early in the 2 s era", T_FLOOR + 100_001],
      ["a week before 2026-11-06", 1_793_000_000],
      ["the era change", T_FLOOR + (ERA - FLOOR) * 2],
      ["just after the era change", T_FLOOR + (ERA - FLOOR) * 2 + 1],
      ["a second shared by 5 blocks", tsOf(57_113_037)],
      ["the next such second", tsOf(58_002_228) + 1],
      ["the head's own timestamp", tsOf(HEAD)],
    ];
    for (const [name, target] of targets) {
      it(`finds the exact block ${name}`, async () => {
        const { asked, r } = setup();
        const got = await r.blockAt(target);
        expect(got).toBe(firstAtOrAfter(target));
        expect(asked.includes(got)).toBe(true);
        expect(asked.includes(got - 1) || got === FLOOR).toBe(true);
        expect(new Set(asked).size).toBeLessThanOrEqual(MAX_HEADERS);
      });
    }

    it("never asks for a header above the head or returns an unverified end, over many targets", async () => {
      for (let i = 0; i < 60; i++) {
        const target = T_FLOOR + 1 + Math.floor(((tsOf(HEAD) - T_FLOOR - 1) * i) / 59);
        const { asked, r } = setup();
        expect(await r.blockAt(target)).toBe(firstAtOrAfter(target));
        expect(new Set(asked).size).toBeLessThanOrEqual(MAX_HEADERS);
      }
    });

    it("throws for a target older than the endpoint's floor, naming the block", async () => {
      const { r } = setup();
      await expect(r.blockAt(T_FLOOR - 1)).rejects.toThrow(new RegExp(`block ${FLOOR - 1} is below what the endpoint serves`));
    });
  });

  it("blockAt throws for a timestamp after the head", async () => {
    const { f } = fake(chain(1000));
    await expect(createLogReader({ fetch: f, sleep: noSleep }).blockAt(1201)).rejects.toThrow(/after the head/);
  });

  it("call returns the hex result", async () => {
    const { f, calls } = fake(() => "0x1234");
    expect(await createLogReader({ fetch: f, sleep: noSleep }).call("0xaa", "0xdead")).toBe("0x1234");
    expect(calls[0]!.params).toEqual([{ to: "0xaa", data: "0xdead" }, "latest"]);
  });
});

describe("the finalized block and a transaction", () => {
  it("finalized reads the block Base has finalized, with its number and timestamp, never the latest", async () => {
    const { f, calls } = fake((req) =>
      req.method === "eth_getBlockByNumber" && req.params[0] === "finalized" ? { number: "0x3b6a402", timestamp: "0x6b077434" } : new Error(`unexpected ${req.method}`),
    );
    expect(await createLogReader({ fetch: f, sleep: noSleep }).finalized()).toEqual({ block: 0x3b6a402, ts: 0x6b077434 });
    expect(calls.map((c) => [c.method, c.params])).toEqual([["eth_getBlockByNumber", ["finalized", false]]]);
  });

  it("finalized refuses an answer without a number or a timestamp", async () => {
    const { f } = fake(() => ({ timestamp: "0x10" }));
    await expect(createLogReader({ fetch: f, sleep: noSleep }).finalized()).rejects.toMatchObject({ name: "RpcRefused" });
  });

  it("transaction reads the sender, the recipient and the input of a hash, lowercase", async () => {
    const hash = `0x${"ab".repeat(32)}`;
    const { f, calls } = fake(() => ({ from: "0xAbC0000000000000000000000000000000000001", to: "0xDEF0000000000000000000000000000000000002", input: "0x4AD3993F" }));
    const r = createLogReader({ fetch: f, sleep: noSleep });
    expect(await r.transaction(hash)).toEqual({ from: "0xabc0000000000000000000000000000000000001", to: "0xdef0000000000000000000000000000000000002", input: "0x4ad3993f" });
    expect(calls[0]!).toMatchObject({ method: "eth_getTransactionByHash", params: [hash] });
  });

  it("transaction keeps a contract creation's null recipient and refuses an unknown hash", async () => {
    const created = fake(() => ({ from: "0x01", to: null, input: "0x" }));
    expect(await createLogReader({ fetch: created.f, sleep: noSleep }).transaction("0x01")).toEqual({ from: "0x01", to: null, input: "0x" });
    const missing = fake(() => null);
    await expect(createLogReader({ fetch: missing.f, sleep: noSleep }).transaction("0x02")).rejects.toThrow(/no transaction 0x02/);
  });
});

describe("single-shot reads retry", () => {
  it("one refusal then success gives the answer; three refusals throw", async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => void sleeps.push(ms);
    const flaky = fake((_r, n) => (n === 1 ? new Error("busy") : "0x77"));
    expect(await createLogReader({ fetch: flaky.f, sleep }).call("0xaa", "0x00")).toBe("0x77");
    expect(flaky.calls.length).toBe(2);
    expect(sleeps).toEqual([1000]);

    sleeps.length = 0;
    const dead = fake(() => new Error("busy"));
    await expect(createLogReader({ fetch: dead.f, sleep }).head()).rejects.toMatchObject({ name: "RpcRefused" });
    expect(dead.calls.length).toBe(3);
    expect(sleeps).toEqual([1000, 2000]);

    const ts = fake((req, n) => (n === 1 ? new Error("busy") : req.method === "eth_getBlockByNumber" ? { timestamp: "0x10" } : null));
    expect(await createLogReader({ fetch: ts.f, sleep }).blockTs(5)).toBe(16);
  });
});
