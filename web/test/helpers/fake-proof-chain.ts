import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  parseAbi,
  toHex,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { base } from "viem/chains";
import { easAbi, indexerAbi, type Attestation } from "@/app/(site)/proof/verified";
import type { LedgerClient } from "@/lib/chain/load";

// A Base chain as /proof and scripts/recount.mjs read it: the head, one block's time, the inbox's Brief logs, the
// inbox's deploy receipt, and the Coinbase indexer's and EAS's answers. `answer` serves the vitest server below and
// the e2e page.route alike, so the page, the script and the browser all read the same fixture.

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

export interface FakeBrief {
  id: number;
  from: Address;
  text: string;
  block: bigint;
  /** Defaults to a hash of the id. */
  txHash?: Hash;
  logIndex?: number;
}

export interface ProofChain {
  chainId: number;
  head: bigint;
  headTime: bigint;
  inbox: Address;
  deployTx: Hash;
  deployBlock: bigint;
  briefs: readonly FakeBrief[];
  /** Lowercased wallet → the uid the indexer gives; any other wallet gets the zero uid. */
  uids: Record<string, Hex>;
  /** uid → the attestation EAS gives; any other uid gets EAS's empty attestation. */
  attestations: Record<string, Attestation>;
  /** The widest eth_getLogs range answered (default 50,000, base-rpc.publicnode.com's). */
  maxLogRange?: bigint;
  /** Answer this many requests with HTTP 429 first, as mainnet.base.org does when it rate-limits. */
  rateLimitFirst?: number;
}

export interface ProofRpcLog {
  methods: string[];
  logRanges: { from: bigint; to: bigint }[];
  calls: { to: string; functionName: string; block: string }[];
}

const ZERO32: Hex = `0x${"0".repeat(64)}`;
const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";
const blockHash = (n: bigint) => toHex(n, { size: 32 });
const briefHash = (b: FakeBrief) => b.txHash ?? (`0x${(9000 + b.id).toString(16).padStart(64, "0")}` as Hash);

const EMPTY: Attestation = {
  uid: ZERO32,
  schema: ZERO32,
  time: 0n,
  expirationTime: 0n,
  revocationTime: 0n,
  refUID: ZERO32,
  recipient: ZERO_ADDRESS,
  attester: ZERO_ADDRESS,
  revocable: false,
  data: "0x",
};

// MaatInbox's Brief event as contracts/src/MaatInbox.sol declares it, written out rather than imported from
// lib/chain/inbox.ts: e2e/proof.spec.ts loads this file, and that module's imports read JSON without an import attribute.
// A log encoded any other way would not decode on the page, which reads it with the inbox's own ABI.
const BRIEF_ABI = parseAbi(["event Brief(uint256 indexed id, address indexed from, string text)"]);

/** The Brief log of `b`, encoded as eth_getLogs returns it. */
export function briefRpcLog(inbox: Address, b: FakeBrief) {
  const topics = encodeEventTopics({ abi: BRIEF_ABI, eventName: "Brief", args: { id: BigInt(b.id), from: b.from } }) as Hex[];
  return {
    address: inbox.toLowerCase(),
    blockHash: blockHash(b.block),
    blockNumber: toHex(b.block),
    data: encodeAbiParameters([{ type: "string" }], [b.text]),
    logIndex: toHex(b.logIndex ?? 0),
    removed: false,
    // A node gives topics in lower case, the sender's address among them.
    topics: topics.map((t) => t.toLowerCase()),
    transactionHash: briefHash(b),
    transactionIndex: "0x0",
  };
}

function block(c: ProofChain, n: bigint) {
  if (n > c.head) return null;
  return {
    number: toHex(n),
    hash: blockHash(n),
    parentHash: blockHash(n - 1n),
    // Two seconds a block, as on Base.
    timestamp: toHex(c.headTime - (c.head - n) * 2n),
    transactions: [],
    uncles: [],
    gasLimit: "0x1c9c380",
    gasUsed: "0x0",
    baseFeePerGas: "0x1",
    difficulty: "0x0",
    totalDifficulty: "0x0",
    extraData: "0x",
    logsBloom: `0x${"0".repeat(512)}`,
    miner: ZERO_ADDRESS,
    mixHash: ZERO32,
    nonce: "0x0000000000000000",
    receiptsRoot: ZERO32,
    sha3Uncles: ZERO32,
    size: "0x0",
    stateRoot: ZERO32,
    transactionsRoot: ZERO32,
  };
}

function call(c: ProofChain, seen: ProofRpcLog, to: string, data: Hex, tag: string): Hex {
  const target = to.toLowerCase();
  if (target === "0x2c7ee1e5f416dff40054c27a62f7b357c4e8619c") {
    const d = decodeFunctionData({ abi: indexerAbi, data });
    seen.calls.push({ to: target, functionName: d.functionName, block: tag });
    const wallet = String(d.args[0]).toLowerCase();
    return encodeFunctionResult({ abi: indexerAbi, functionName: "getAttestationUid", result: c.uids[wallet] ?? ZERO32 });
  }
  if (target === "0x4200000000000000000000000000000000000021") {
    const d = decodeFunctionData({ abi: easAbi, data });
    seen.calls.push({ to: target, functionName: d.functionName, block: tag });
    return encodeFunctionResult({ abi: easAbi, functionName: "getAttestation", result: c.attestations[String(d.args[0])] ?? EMPTY });
  }
  throw new RpcError(3, "execution reverted");
}

/** The result of one JSON-RPC request, or a thrown RpcError. */
export function answer(c: ProofChain, seen: ProofRpcLog, method: string, params: readonly unknown[]): unknown {
  seen.methods.push(method);
  switch (method) {
    case "eth_chainId":
      return toHex(c.chainId);
    case "eth_blockNumber":
      return toHex(c.head);
    case "eth_getBlockByNumber": {
      const tag = String(params[0]);
      return block(c, tag === "latest" ? c.head : BigInt(tag));
    }
    case "eth_call": {
      const { to, data, input } = params[0] as { to: string; data?: Hex; input?: Hex };
      return call(c, seen, to, (data ?? input)!, String(params[1] ?? "latest"));
    }
    case "eth_getLogs": {
      const { address, fromBlock, toBlock } = params[0] as { address?: string; fromBlock: Hex; toBlock: Hex };
      const from = BigInt(fromBlock);
      const to = BigInt(toBlock);
      const max = c.maxLogRange ?? 50_000n;
      if (to - from + 1n > max) throw new RpcError(-32600, `exceed maximum block range: ${max}`);
      seen.logRanges.push({ from, to });
      if (String(address ?? "").toLowerCase() !== c.inbox.toLowerCase()) return [];
      return c.briefs.filter((b) => b.block >= from && b.block <= to).map((b) => briefRpcLog(c.inbox, b));
    }
    case "eth_getTransactionReceipt": {
      const hash = String(params[0]).toLowerCase();
      if (hash !== c.deployTx.toLowerCase()) return null;
      return {
        blockHash: blockHash(c.deployBlock),
        blockNumber: toHex(c.deployBlock),
        contractAddress: c.inbox,
        cumulativeGasUsed: "0x5208",
        effectiveGasPrice: "0x1",
        from: ZERO_ADDRESS,
        gasUsed: "0x5208",
        logs: [],
        logsBloom: `0x${"0".repeat(512)}`,
        status: "0x1",
        to: null,
        transactionHash: hash,
        transactionIndex: "0x0",
        type: "0x2",
      };
    }
    default:
      throw new RpcError(-32601, `the method ${method} does not exist`);
  }
}

/** Answers one JSON-RPC body, single or batched. */
export function answerBody(c: ProofChain, seen: ProofRpcLog, body: unknown): unknown {
  const one = (r: { id: number; method: string; params?: unknown[] }) => {
    try {
      return { jsonrpc: "2.0", id: r.id, result: answer(c, seen, r.method, r.params ?? []) };
    } catch (e) {
      const error = e instanceof RpcError ? { code: e.code, message: e.message } : { code: -32603, message: String(e) };
      return { jsonrpc: "2.0", id: r.id, error };
    }
  };
  return Array.isArray(body) ? body.map(one) : one(body as never);
}

export const newRpcLog = (): ProofRpcLog => ({ methods: [], logRanges: [], calls: [] });

/**
 * A viem client of Base over `c`, answered in memory: the page's code path without fetch, which unit tests block
 * (test/setup.ts). `fail` makes every request fail, as an RPC that is down.
 */
export function proofChainClient(c: ProofChain, opts: { fail?: boolean } = {}): LedgerClient & { seen: ProofRpcLog } {
  const seen = newRpcLog();
  const client = createPublicClient({
    chain: base,
    transport: custom({
      request: async ({ method, params }: { method: string; params?: unknown }) => {
        if (opts.fail) throw new Error("the RPC is down");
        try {
          return answer(c, seen, method, (params as unknown[] | undefined) ?? []);
        } catch (e) {
          if (e instanceof RpcError) throw Object.assign(new Error(e.message), { code: e.code });
          throw e;
        }
      },
    }),
  }) as unknown as LedgerClient;
  return Object.assign(client, { seen });
}

/** A JSON-RPC server on 127.0.0.1 over `c`. */
export async function serveProofChain(c: ProofChain): Promise<{ url: string; seen: ProofRpcLog; close: () => Promise<void> }> {
  const seen = newRpcLog();
  let limited = c.rateLimitFirst ?? 0;
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => (raw += chunk.toString("utf8")));
    req.on("end", () => {
      if (limited > 0) {
        limited -= 1;
        res.writeHead(429, { "content-type": "text/plain" }).end("Too Many Requests");
        return;
      }
      const out = answerBody(c, seen, JSON.parse(raw));
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
