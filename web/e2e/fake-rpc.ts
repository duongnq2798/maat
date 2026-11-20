import type { Page } from "@playwright/test";
import { decodeFunctionData, encodeFunctionResult, multicall3Abi, toHex, zeroAddress, type Abi, type Address, type Hash, type Hex } from "viem";
import { b20Abi, creditAdapterAbi, erc20Abi, feedAbi, vaultAbi } from "../lib/chain/abi";
import type { CachedLog } from "../lib/chain/cache";

/** The RPCs the built page calls (lib/chain/rpc.ts DEFAULT_RPCS); every request to them is answered here. */
export const RPC_HOSTS: readonly string[] = ["base-rpc.publicnode.com", "mainnet.base.org"];
const MULTICALL3 = "0xca11bde05977b3631167028862be2a173976ca11";
const ZERO32 = `0x${"0".repeat(64)}` as Hash;
const BLOOM = `0x${"0".repeat(512)}` as Hex;
const ABIS: readonly Abi[] = [vaultAbi, b20Abi, feedAbi, creditAdapterAbi, erc20Abi];

type Answer = unknown | ((args: readonly unknown[]) => unknown);

export interface FakeScenario {
  head: bigint;
  /** Unix seconds of the head block. */
  headTime: number;
  vault: Address;
  logs: readonly CachedLog[];
  /** Block number → unix seconds. */
  times: Readonly<Record<string, number>>;
  /** Lowercased tx hash → its block and gas. */
  receipts: Readonly<Record<string, { block: bigint; gasUsed: bigint }>>;
  /** Lowercased contract → function name → its result, or a function of the call's args. A missing entry reverts. */
  calls: Readonly<Record<string, Readonly<Record<string, Answer>>>>;
  /** eth_getLogs refuses wider ranges, as publicnode does (50,000). */
  maxLogRange?: bigint;
}

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: Hex,
  ) {
    super(message);
  }
}

const blockHash = (n: bigint) => toHex(n, { size: 32 });

function contractCall(s: FakeScenario, to: Address, data: Hex): { success: boolean; returnData: Hex } {
  const table = s.calls[to.toLowerCase()];
  if (!table) return { success: false, returnData: "0x" };
  for (const abi of ABIS) {
    let decoded: { functionName: string; args?: readonly unknown[] };
    try {
      decoded = decodeFunctionData({ abi, data }) as typeof decoded;
    } catch {
      continue;
    }
    const entry = table[decoded.functionName];
    if (entry === undefined) return { success: false, returnData: "0x" };
    const result = typeof entry === "function" ? (entry as (a: readonly unknown[]) => unknown)(decoded.args ?? []) : entry;
    return { success: true, returnData: encodeFunctionResult({ abi, functionName: decoded.functionName, result } as never) };
  }
  return { success: false, returnData: "0x" };
}

function block(s: FakeScenario, n: bigint) {
  const time = n === s.head ? s.headTime : s.times[n.toString()];
  if (time === undefined) return null;
  return {
    number: toHex(n),
    hash: blockHash(n),
    parentHash: blockHash(n - 1n),
    timestamp: toHex(time),
    transactions: [],
    uncles: [],
    gasLimit: "0x1c9c380",
    gasUsed: "0x0",
    baseFeePerGas: "0x1",
    difficulty: "0x0",
    totalDifficulty: "0x0",
    extraData: "0x",
    logsBloom: BLOOM,
    miner: zeroAddress,
    mixHash: ZERO32,
    nonce: "0x0000000000000000",
    receiptsRoot: ZERO32,
    sha3Uncles: ZERO32,
    size: "0x1",
    stateRoot: ZERO32,
    transactionsRoot: ZERO32,
  };
}

function handle(s: FakeScenario, method: string, params: readonly unknown[]): unknown {
  switch (method) {
    case "eth_chainId":
      return "0x2105";
    case "eth_blockNumber":
      return toHex(s.head);
    case "eth_getCode":
      return String(params[0]).toLowerCase() === s.vault.toLowerCase() ? "0x6080604052" : "0x";
    case "eth_call": {
      const { to, data } = params[0] as { to: Address; data: Hex };
      if (to.toLowerCase() === MULTICALL3) {
        const { args } = decodeFunctionData({ abi: multicall3Abi, data });
        const calls = (args?.[0] ?? []) as readonly { target: Address; callData: Hex }[];
        const result = calls.map((c) => contractCall(s, c.target, c.callData));
        return encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result });
      }
      const r = contractCall(s, to, data);
      if (!r.success) throw new RpcError(3, "execution reverted", "0x");
      return r.returnData;
    }
    case "eth_getBlockByNumber": {
      const tag = String(params[0]);
      const b = block(s, tag === "latest" ? s.head : BigInt(tag));
      return b;
    }
    case "eth_getLogs": {
      const { fromBlock, toBlock } = params[0] as { fromBlock: Hex; toBlock: Hex };
      const from = BigInt(fromBlock);
      const to = BigInt(toBlock);
      const max = s.maxLogRange ?? 50_000n;
      if (to - from + 1n > max) throw new RpcError(-32600, `exceed maximum block range: ${max}`);
      return s.logs
        .filter((l) => BigInt(l.blockNumber) >= from && BigInt(l.blockNumber) <= to)
        .map((l) => ({
          address: s.vault,
          blockHash: blockHash(BigInt(l.blockNumber)),
          blockNumber: toHex(BigInt(l.blockNumber)),
          data: l.data,
          logIndex: toHex(l.logIndex),
          removed: false,
          topics: l.topics,
          transactionHash: l.transactionHash,
          transactionIndex: "0x0",
        }));
    }
    case "eth_getTransactionReceipt": {
      const hash = String(params[0]).toLowerCase() as Hash;
      const r = s.receipts[hash];
      if (!r) return null;
      return {
        blockHash: blockHash(r.block),
        blockNumber: toHex(r.block),
        contractAddress: null,
        cumulativeGasUsed: toHex(r.gasUsed),
        effectiveGasPrice: "0x1",
        from: zeroAddress,
        gasUsed: toHex(r.gasUsed),
        logs: [],
        logsBloom: BLOOM,
        status: "0x1",
        to: s.vault,
        transactionHash: hash,
        transactionIndex: "0x0",
        type: "0x2",
      };
    }
    default:
      throw new RpcError(-32601, `the method ${method} does not exist`);
  }
}

/**
 * Answers every JSON-RPC request (single or batched) the page sends to the Base RPCs from `scenario`. Returns the
 * methods called, in order.
 */
export async function installFakeChain(page: Page, scenario: FakeScenario): Promise<string[]> {
  const methods: string[] = [];
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
  await page.route(
    (url) => RPC_HOSTS.includes(url.host),
    async (route) => {
      const req = route.request();
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      const one = (r: { id: number; method: string; params?: unknown[] }) => {
        methods.push(r.method);
        try {
          return { jsonrpc: "2.0", id: r.id, result: handle(scenario, r.method, r.params ?? []) };
        } catch (e) {
          const err = e instanceof RpcError ? { code: e.code, message: e.message, data: e.data } : { code: -32603, message: String(e) };
          return { jsonrpc: "2.0", id: r.id, error: err };
        }
      };
      const body = JSON.parse(req.postData() ?? "null");
      const out = Array.isArray(body) ? body.map(one) : one(body);
      await route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(out) });
    },
  );
  return methods;
}
