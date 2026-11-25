import type { Page } from "@playwright/test";
import { decodeFunctionData, encodeFunctionResult, toHex, zeroAddress, type Abi, type Address, type Hash, type Hex } from "viem";
import { b20Abi, vaultAbi } from "../lib/chain/abi";
import type { CachedLog } from "../lib/chain/cache";
import { RPC_HOSTS } from "./fake-rpc";

// The Base RPCs as /ask reads them: the vault's owner, its Decision logs and previewIntent, a token's decimals, the
// inbox's Brief logs and the receipts the page waits for. Every request to RPC_HOSTS is answered here.

const ZERO32 = `0x${"0".repeat(64)}` as Hash;
const BLOOM = `0x${"0".repeat(512)}` as Hex;
const blockHash = (n: bigint) => toHex(n, { size: 32 });

export interface AskChain {
  head: bigint;
  vault: Address;
  owner: Address;
  /** The vault's logs, and the inbox's: answered by address. */
  vaultLogs: readonly CachedLog[];
  inbox?: Address;
  inboxLogs?: CachedLog[];
  /** Lowercased tx hash → its receipt block, the status the page reads, and the logs its `to` emitted. */
  receipts: Record<string, { block: bigint; status?: "0x1" | "0x0"; to?: Address; logs?: readonly CachedLog[] }>;
  /** Lowercased tx hash → its sender, target and input. */
  txs: Record<string, { from: Address; to: Address; input: Hex }>;
  /** The number previewIntent answers with, or a function of the intent. */
  preview: number | ((intent: { action: number; token: Address; amount: bigint }) => number);
  /** Lowercased token → decimals(). */
  decimals: Record<string, number>;
  /** Sees each receipt the page asks for, so a test can add the log its brief made. */
  onReceipt?: (hash: string) => void;
}

export interface AskRpcLog {
  methods: string[];
  /** Each previewIntent call, decoded. */
  previews: { action: number; token: Address; amount: bigint }[];
  logRequests: { address: string; from: bigint; to: bigint }[];
}

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

function call(s: AskChain, seen: AskRpcLog, to: Address, data: Hex): Hex {
  const tryAbi = (abi: Abi) => {
    try {
      return decodeFunctionData({ abi, data }) as { functionName: string; args?: readonly unknown[] };
    } catch {
      return null;
    }
  };
  if (to.toLowerCase() === s.vault.toLowerCase()) {
    const d = tryAbi(vaultAbi);
    if (d?.functionName === "owner") return encodeFunctionResult({ abi: vaultAbi, functionName: "owner", result: s.owner });
    if (d?.functionName === "previewIntent") {
      const intent = d.args![0] as { action: number; token: Address; amount: bigint };
      seen.previews.push({ action: intent.action, token: intent.token, amount: intent.amount });
      const reason = typeof s.preview === "function" ? s.preview(intent) : s.preview;
      return encodeFunctionResult({ abi: vaultAbi, functionName: "previewIntent", result: reason });
    }
  }
  const decimals = s.decimals[to.toLowerCase()];
  if (decimals !== undefined && tryAbi(b20Abi)?.functionName === "decimals") return encodeFunctionResult({ abi: b20Abi, functionName: "decimals", result: decimals });
  throw new RpcError(3, "execution reverted");
}

const rpcLog = (address: Address, l: CachedLog) => ({
  address,
  blockHash: blockHash(BigInt(l.blockNumber)),
  blockNumber: toHex(BigInt(l.blockNumber)),
  data: l.data,
  logIndex: toHex(l.logIndex),
  removed: false,
  topics: l.topics,
  transactionHash: l.transactionHash,
  transactionIndex: "0x0",
});

function handle(s: AskChain, seen: AskRpcLog, method: string, params: readonly unknown[]): unknown {
  switch (method) {
    case "eth_chainId":
      return "0x2105";
    case "eth_blockNumber":
      return toHex(s.head);
    case "eth_call": {
      const { to, data } = params[0] as { to: Address; data: Hex };
      return call(s, seen, to, data);
    }
    case "eth_getLogs": {
      const { address, fromBlock, toBlock, topics } = params[0] as { address?: string; fromBlock: Hex; toBlock: Hex; topics?: (Hex | null)[] };
      const from = BigInt(fromBlock);
      const to = BigInt(toBlock);
      if (to - from + 1n > 50_000n) throw new RpcError(-32600, "exceed maximum block range: 50000");
      seen.logRequests.push({ address: String(address ?? ""), from, to });
      const a = String(address ?? "").toLowerCase();
      const pool = a === s.vault.toLowerCase() ? s.vaultLogs : s.inbox && a === s.inbox.toLowerCase() ? (s.inboxLogs ?? []) : [];
      const topic0 = topics?.[0];
      return pool
        .filter((l) => BigInt(l.blockNumber) >= from && BigInt(l.blockNumber) <= to && (!topic0 || l.topics[0] === topic0))
        .map((l) => rpcLog(getAddressOf(a, s), l));
    }
    case "eth_getTransactionByHash": {
      const hash = String(params[0]).toLowerCase() as Hash;
      const tx = s.txs[hash];
      if (!tx) return null;
      const block = s.receipts[hash]?.block ?? s.head;
      return {
        blockHash: blockHash(block),
        blockNumber: toHex(block),
        chainId: "0x2105",
        from: tx.from,
        gas: "0x493e0",
        gasPrice: "0x1",
        maxFeePerGas: "0x1",
        maxPriorityFeePerGas: "0x1",
        hash,
        input: tx.input,
        nonce: "0x0",
        to: tx.to,
        transactionIndex: "0x0",
        type: "0x2",
        value: "0x0",
        accessList: [],
        v: "0x0",
        yParity: "0x0",
        r: ZERO32,
        s: ZERO32,
      };
    }
    case "eth_getTransactionReceipt": {
      const hash = String(params[0]).toLowerCase();
      s.onReceipt?.(hash);
      const r = s.receipts[hash];
      if (!r) return null;
      return {
        blockHash: blockHash(r.block),
        blockNumber: toHex(r.block),
        contractAddress: null,
        cumulativeGasUsed: "0x5208",
        effectiveGasPrice: "0x1",
        from: zeroAddress,
        gasUsed: "0x5208",
        logs: (r.logs ?? []).map((l) => rpcLog(r.to ?? zeroAddress, l)),
        logsBloom: BLOOM,
        status: r.status ?? "0x1",
        to: r.to ?? null,
        transactionHash: hash,
        transactionIndex: "0x0",
        type: "0x2",
      };
    }
    default:
      throw new RpcError(-32601, `the method ${method} does not exist`);
  }
}

const getAddressOf = (lower: string, s: AskChain): Address => (lower === s.vault.toLowerCase() ? s.vault : (s.inbox ?? (lower as Address)));

/** Answers every JSON-RPC request (single or batched) the page sends to the Base RPCs from `chain`. */
export async function installAskChain(page: Page, chain: AskChain): Promise<AskRpcLog> {
  const seen: AskRpcLog = { methods: [], previews: [], logRequests: [] };
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
  await page.route(
    (url) => RPC_HOSTS.includes(url.host),
    async (route) => {
      const req = route.request();
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      const one = (r: { id: number; method: string; params?: unknown[] }) => {
        seen.methods.push(r.method);
        try {
          return { jsonrpc: "2.0", id: r.id, result: handle(chain, seen, r.method, r.params ?? []) };
        } catch (e) {
          const err = e instanceof RpcError ? { code: e.code, message: e.message } : { code: -32603, message: String(e) };
          return { jsonrpc: "2.0", id: r.id, error: err };
        }
      };
      const body = JSON.parse(req.postData() ?? "null");
      const out = Array.isArray(body) ? body.map(one) : one(body);
      await route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(out) });
    },
  );
  return seen;
}
