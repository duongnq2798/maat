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
import type { ProofClient } from "@/app/(site)/proof/load";

// A Base chain as /proof and scripts/recount.mjs read it: the head, one block's time, the inbox's Brief logs, the
// inbox's deploy receipt, the Coinbase indexer's and EAS's answers, and what the team trace reads: the vault's owner(),
// executor() and payees(), each wallet's transactions (by hash, by receipt, as its nonce and in its block), its code,
// and the logs of the vault and of tokens. Each brief is a transaction its sender sent to the inbox, as on Base, unless
// the fixture gives that transaction itself. `answer` serves the vitest server below and the e2e page.route alike, so
// the page, the script and the browser all read the same fixture.

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

/** A log of a transaction's receipt, or of `tokenLogs`. */
export interface FakeLog {
  address: Address;
  topics: Hex[];
  data?: Hex;
}

/** A transaction: eth_getTransactionByHash, its receipt, its sender's nonce and its block all come from it. */
export interface FakeTx {
  hash: Hash;
  from: Address;
  nonce: number;
  to: Address | null;
  value?: bigint;
  block: bigint;
  /** Defaults to 1, a success. */
  status?: 0 | 1;
  logs?: FakeLog[];
  /** A contract creation's new address. */
  contractAddress?: Address;
  /** The calldata eth_getTransactionByHash gives; defaults to "0x". */
  input?: Hex;
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
  /** The vault's answers to owner(), executor() and payees(); any other contract reverts. */
  vault?: { address: Address; owner: Address; executor: Address; payees: readonly Address[] };
  /** Every transaction of the fixture. The inbox's deploy tx, when it is not here, is sent by the zero address. */
  txs?: readonly FakeTx[];
  /** Lowercased address → its code; any other address has none. */
  code?: Record<string, Hex>;
  /** Token logs of transactions not in `txs` (a spender's transferFrom), served by eth_getLogs with their address. */
  tokenLogs?: readonly (FakeLog & { block: bigint; txHash: Hash; logIndex?: number })[];
  /** The widest eth_getLogs range answered (default 50,000, base-rpc.publicnode.com's). */
  maxLogRange?: bigint;
  /** eth_getLogs fails, as a non-range error, for any range that touches one of these (of `address` alone, if given). */
  failLogs?: readonly { from: bigint; to: bigint; address?: Address }[];
  /** Answer this many requests with HTTP 429 first, as mainnet.base.org does when it rate-limits. */
  rateLimitFirst?: number;
  /** serveProofChain holds each answer to an eth_getLogs this many milliseconds, so reads overlap as they would on Base. */
  logDelayMs?: number;
}

export interface ProofRpcLog {
  methods: string[];
  /** Each eth_getLogs answered: its range, and its lowercased address (comma-separated when it asked for several). */
  logRanges: { from: bigint; to: bigint; address: string }[];
  calls: { to: string; functionName: string; block: string }[];
  /** serveProofChain: lowercased address → the most eth_getLogs requests of it the server held at once. */
  logsInFlight: Record<string, number>;
}

const ZERO32: Hex = `0x${"0".repeat(64)}`;
const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";
const blockHash = (n: bigint) => toHex(n, { size: 32 });
const briefHash = (b: FakeBrief) => b.txHash ?? (`0x${(9000 + b.id).toString(16).padStart(64, "0")}` as Hash);
const lower = (s: string) => s.toLowerCase();

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
const TOKEN_ABI = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
]);
const VAULT_ABI = parseAbi(["function owner() view returns (address)", "function executor() view returns (address)", "function payees() view returns (address[])"]);
// Four events of contracts/src/IMandateVaultEvents.sol, with Action and Reason as the uint8 the ABI gives them.
const VAULT_EVENTS = parseAbi([
  "event Decision(bytes32 indexed intentId, uint8 action, address indexed token, uint256 amount, bool allowed, uint8 reason, bytes32 rationaleHash)",
  "event ExecutorSet(address indexed executor)",
  "event RevenueReceived(uint256 amount)",
  "event MultiplierChangeDetected(address indexed token, uint256 oldMultiplier, uint256 newMultiplier)",
]);

/**
 * The vault's Decision log for intent `id`, as execute() emits it: a BUY of 1 unit of `token`, allowed with reason 0
 * (OK) and a zero rationaleHash unless `opts` says otherwise. `reason` is the uint8 of enum Reason (0 is OK).
 */
export function decisionLog(
  vault: Address,
  id: number,
  token: Address = ZERO_ADDRESS,
  opts: { allowed?: boolean; reason?: number; rationaleHash?: Hex } = {},
): FakeLog {
  return {
    address: vault,
    topics: encodeEventTopics({ abi: VAULT_EVENTS, eventName: "Decision", args: { intentId: toHex(id, { size: 32 }), token } }) as Hex[],
    data: encodeAbiParameters(
      [{ type: "uint8" }, { type: "uint256" }, { type: "bool" }, { type: "uint8" }, { type: "bytes32" }],
      [0, 1n, opts.allowed ?? true, opts.reason ?? 0, opts.rationaleHash ?? ZERO32],
    ),
  };
}

/** The vault's ExecutorSet log, as setExecutor emits it. */
export function executorSetLog(vault: Address, executor: Address): FakeLog {
  return { address: vault, topics: encodeEventTopics({ abi: VAULT_EVENTS, eventName: "ExecutorSet", args: { executor } }) as Hex[] };
}

/** The vault's RevenueReceived log, as notifyRevenue emits it; anyone may call notifyRevenue. */
export function revenueLog(vault: Address, amount = 1n): FakeLog {
  return {
    address: vault,
    topics: encodeEventTopics({ abi: VAULT_EVENTS, eventName: "RevenueReceived" }) as Hex[],
    data: encodeAbiParameters([{ type: "uint256" }], [amount]),
  };
}

/** The vault's MultiplierChangeDetected log, as syncMultiplier emits it when `token`'s multiplier changed. */
export function multiplierLog(vault: Address, token: Address): FakeLog {
  return {
    address: vault,
    topics: encodeEventTopics({ abi: VAULT_EVENTS, eventName: "MultiplierChangeDetected", args: { token } }) as Hex[],
    data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [10n ** 18n, 2n * 10n ** 18n]),
  };
}

/** How many transactions and receipts were read: the reads a send costs. */
export const txReads = (seen: ProofRpcLog) => seen.methods.filter((m) => m === "eth_getTransactionByHash" || m === "eth_getTransactionReceipt").length;

/** An ERC-20 Transfer log of `token` from `from` to `to`. */
export function transferLog(token: Address, from: Address, to: Address, amount = 1n): FakeLog {
  return {
    address: token,
    topics: encodeEventTopics({ abi: TOKEN_ABI, eventName: "Transfer", args: { from, to } }) as Hex[],
    data: encodeAbiParameters([{ type: "uint256" }], [amount]),
  };
}

/** An ERC-20 Approval log of `token`: `owner` lets `spender` move its tokens. */
export function approvalLog(token: Address, owner: Address, spender: Address, amount = 1n): FakeLog {
  return {
    address: token,
    topics: encodeEventTopics({ abi: TOKEN_ABI, eventName: "Approval", args: { owner, spender } }) as Hex[],
    data: encodeAbiParameters([{ type: "uint256" }], [amount]),
  };
}

/** A transaction hash for fixtures: `n` as 32 bytes. */
export const txHash = (n: number): Hash => toHex(n, { size: 32 });

/**
 * `sends` as the only transactions of their wallets: each one sent by its wallet at its nonce, with no value and no
 * log, one block apart and ending before `before`. A fixture for committed lists that are complete.
 */
export function plainSends(sends: readonly { wallet: string; txs: readonly string[] }[], before: bigint): FakeTx[] {
  return sends.flatMap((s) =>
    s.txs.map((hash, i) => ({ hash: hash as Hash, from: s.wallet as Address, nonce: i, to: null, block: before - BigInt(s.txs.length - i) })),
  );
}

/** The Brief log of `b`, encoded as eth_getLogs returns it. */
export function briefRpcLog(inbox: Address, b: FakeBrief) {
  const topics = encodeEventTopics({ abi: BRIEF_ABI, eventName: "Brief", args: { id: BigInt(b.id), from: b.from } }) as Hex[];
  return {
    address: lower(inbox),
    blockHash: blockHash(b.block),
    blockNumber: toHex(b.block),
    data: encodeAbiParameters([{ type: "string" }], [b.text]),
    logIndex: toHex(b.logIndex ?? 0),
    removed: false,
    // A node gives topics in lower case, the sender's address among them.
    topics: topics.map(lower),
    transactionHash: briefHash(b),
    transactionIndex: "0x0",
  };
}

function rpcLog(log: FakeLog, block: bigint, hash: Hash, logIndex: number) {
  return {
    address: lower(log.address),
    blockHash: blockHash(block),
    blockNumber: toHex(block),
    data: log.data ?? "0x",
    logIndex: toHex(logIndex),
    removed: false,
    topics: log.topics.map(lower),
    transactionHash: lower(hash),
    transactionIndex: "0x0",
  };
}

/**
 * Every transaction of the chain: the fixture's; the inbox's deploy tx when the fixture does not give it, sent by the
 * zero address, which no trace follows; and, for each brief whose transaction the fixture does not give, a transaction
 * its sender sent to the inbox, holding that brief's logs, at the next nonce of that sender in block order.
 */
function txsOf(c: ProofChain): FakeTx[] {
  const txs = [...(c.txs ?? [])];
  const has = (hash: string) => txs.some((t) => lower(t.hash) === lower(hash));
  if (!has(c.deployTx)) {
    txs.push({ hash: c.deployTx, from: ZERO_ADDRESS, nonce: 0, to: null, block: c.deployBlock, contractAddress: c.inbox });
  }
  const sent = new Map<string, FakeBrief[]>();
  for (const b of [...c.briefs].sort((x, y) => (x.block < y.block ? -1 : x.block > y.block ? 1 : 0))) {
    const hash = lower(briefHash(b));
    if (has(hash)) continue;
    const same = sent.get(hash) ?? [];
    // The RPC may give one log twice; the transaction holds it once.
    if (!same.some((s) => s.logIndex === b.logIndex && s.id === b.id)) same.push(b);
    sent.set(hash, same);
  }
  for (const [hash, bs] of sent) {
    const first = bs[0]!;
    const nonce = txs.filter((t) => lower(t.from) === lower(first.from) && t.block <= first.block).length;
    txs.push({ hash: hash as Hash, from: first.from, nonce, to: c.inbox, block: first.block, logs: bs.map((b) => briefLog(c.inbox, b)) });
  }
  return txs;
}

/**
 * The committed snapshot `npm run snapshot` would write for `c` at block `n` (web/lib/chain/snapshot.ts): every log of
 * `vault` in [floor, n] in block and log order, RevenueReceived included, with the hash the chain gives block n.
 */
export function vaultSnapshot(c: ProofChain, vault: Address, floor: bigint, n: bigint) {
  const logs = txsOf(c)
    .filter((t) => t.status !== 0 && t.block >= floor && t.block <= n)
    .sort((a, b) => (a.block < b.block ? -1 : a.block > b.block ? 1 : 0))
    .flatMap((t) =>
      (t.logs ?? []).flatMap((l, i) =>
        lower(l.address) === lower(vault) ? [{ blockNumber: t.block.toString(), logIndex: i, transactionHash: lower(t.hash) as Hash, topics: l.topics.map(lower) as Hex[], data: l.data ?? "0x" }] : [],
      ),
    );
  return { v: 1 as const, chainId: 8453 as const, vault, floor: floor.toString(), block: n.toString(), blockHash: blockHash(n), logs };
}

/** The Brief log of `b`, as a log of its transaction's receipt. */
function briefLog(inbox: Address, b: FakeBrief): FakeLog {
  return {
    address: inbox,
    topics: encodeEventTopics({ abi: BRIEF_ABI, eventName: "Brief", args: { id: BigInt(b.id), from: b.from } }) as Hex[],
    data: encodeAbiParameters([{ type: "string" }], [b.text]),
  };
}

const tagBlock = (c: ProofChain, tag: unknown) => (tag === undefined || tag === "latest" ? c.head : BigInt(String(tag)));

function rpcTx(t: FakeTx) {
  return {
    blockHash: blockHash(t.block),
    blockNumber: toHex(t.block),
    from: lower(t.from),
    gas: "0x5208",
    gasPrice: "0x1",
    maxFeePerGas: "0x1",
    maxPriorityFeePerGas: "0x1",
    hash: lower(t.hash),
    input: t.input ?? "0x",
    nonce: toHex(t.nonce),
    to: t.to === null ? null : lower(t.to),
    transactionIndex: "0x0",
    value: toHex(t.value ?? 0n),
    type: "0x2",
    chainId: "0x2105",
    accessList: [],
    v: "0x0",
    r: "0x1",
    s: "0x1",
    yParity: "0x0",
  };
}

function rpcReceipt(t: FakeTx) {
  return {
    blockHash: blockHash(t.block),
    blockNumber: toHex(t.block),
    contractAddress: t.contractAddress ? lower(t.contractAddress) : null,
    cumulativeGasUsed: "0x5208",
    effectiveGasPrice: "0x1",
    from: lower(t.from),
    gasUsed: "0x5208",
    logs: (t.logs ?? []).map((l, i) => rpcLog(l, t.block, t.hash, i)),
    logsBloom: `0x${"0".repeat(512)}`,
    status: t.status === 0 ? "0x0" : "0x1",
    to: t.to === null ? null : lower(t.to),
    transactionHash: lower(t.hash),
    transactionIndex: "0x0",
    type: "0x2",
  };
}

function block(c: ProofChain, n: bigint, full: boolean) {
  if (n > c.head) return null;
  const txs = txsOf(c).filter((t) => t.block === n);
  return {
    number: toHex(n),
    hash: blockHash(n),
    parentHash: blockHash(n - 1n),
    // Two seconds a block, as on Base.
    timestamp: toHex(c.headTime - (c.head - n) * 2n),
    transactions: full ? txs.map(rpcTx) : txs.map((t) => lower(t.hash)),
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
  const target = lower(to);
  if (target === "0x2c7ee1e5f416dff40054c27a62f7b357c4e8619c") {
    const d = decodeFunctionData({ abi: indexerAbi, data });
    seen.calls.push({ to: target, functionName: d.functionName, block: tag });
    const wallet = lower(String(d.args[0]));
    return encodeFunctionResult({ abi: indexerAbi, functionName: "getAttestationUid", result: c.uids[wallet] ?? ZERO32 });
  }
  if (target === "0x4200000000000000000000000000000000000021") {
    const d = decodeFunctionData({ abi: easAbi, data });
    seen.calls.push({ to: target, functionName: d.functionName, block: tag });
    return encodeFunctionResult({ abi: easAbi, functionName: "getAttestation", result: c.attestations[String(d.args[0])] ?? EMPTY });
  }
  if (c.vault && target === lower(c.vault.address)) {
    const d = decodeFunctionData({ abi: VAULT_ABI, data });
    seen.calls.push({ to: target, functionName: d.functionName, block: tag });
    if (d.functionName === "payees") return encodeFunctionResult({ abi: VAULT_ABI, functionName: "payees", result: [...c.vault.payees] });
    return encodeFunctionResult({ abi: VAULT_ABI, functionName: d.functionName, result: c.vault[d.functionName] });
  }
  throw new RpcError(3, "execution reverted");
}

/** Token logs for an eth_getLogs filter with an address other than the inbox's: the receipts' logs and `tokenLogs`. */
function tokenLogs(c: ProofChain, filter: { address?: string | string[]; topics?: (string | string[] | null)[] }, from: bigint, to: bigint) {
  const addresses = new Set((Array.isArray(filter.address) ? filter.address : [filter.address ?? ""]).map(lower));
  const topics = (filter.topics ?? []).map((t) => (t === null ? null : new Set((Array.isArray(t) ? t : [t]).map(lower))));
  const all = [
    ...txsOf(c).flatMap((t) => (t.status === 0 ? [] : (t.logs ?? []).map((l, i) => ({ log: l, block: t.block, hash: t.hash, index: i })))),
    ...(c.tokenLogs ?? []).map((l) => ({ log: l, block: l.block, hash: l.txHash, index: l.logIndex ?? 0 })),
  ];
  return all
    .filter(({ log, block: b }) => b >= from && b <= to && addresses.has(lower(log.address)))
    .filter(({ log }) => topics.every((set, i) => set === null || set.has(lower(log.topics[i] ?? ""))))
    .map(({ log, block: b, hash, index }) => rpcLog(log, b, hash, index));
}

/** The result of one JSON-RPC request, or a thrown RpcError. */
export function answer(c: ProofChain, seen: ProofRpcLog, method: string, params: readonly unknown[]): unknown {
  seen.methods.push(method);
  switch (method) {
    case "eth_chainId":
      return toHex(c.chainId);
    case "eth_blockNumber":
      return toHex(c.head);
    case "eth_getBlockByNumber":
      return block(c, tagBlock(c, params[0]), params[1] === true);
    case "eth_call": {
      const { to, data, input } = params[0] as { to: string; data?: Hex; input?: Hex };
      return call(c, seen, to, (data ?? input)!, String(params[1] ?? "latest"));
    }
    case "eth_getLogs": {
      const filter = params[0] as { address?: string | string[]; topics?: (string | string[] | null)[]; fromBlock: Hex; toBlock: Hex };
      const from = BigInt(filter.fromBlock);
      const to = BigInt(filter.toBlock);
      const max = c.maxLogRange ?? 50_000n;
      if (to - from + 1n > max) throw new RpcError(-32600, `exceed maximum block range: ${max}`);
      const asked = new Set((Array.isArray(filter.address) ? filter.address : [filter.address ?? ""]).map(lower));
      const fails = (c.failLogs ?? []).filter((r) => r.address === undefined || asked.has(lower(r.address)));
      if (fails.some((r) => from <= r.to && to >= r.from)) throw new RpcError(-32000, "upstream request timed out");
      seen.logRanges.push({ from, to, address: [...asked].join(",") });
      if (!Array.isArray(filter.address) && lower(String(filter.address ?? "")) === lower(c.inbox)) {
        return c.briefs.filter((b) => b.block >= from && b.block <= to).map((b) => briefRpcLog(c.inbox, b));
      }
      return tokenLogs(c, filter, from, to);
    }
    case "eth_getTransactionByHash": {
      const t = txsOf(c).find((x) => lower(x.hash) === lower(String(params[0])));
      return t ? rpcTx(t) : null;
    }
    case "eth_getTransactionReceipt": {
      const t = txsOf(c).find((x) => lower(x.hash) === lower(String(params[0])));
      return t ? rpcReceipt(t) : null;
    }
    case "eth_getTransactionCount": {
      const wallet = lower(String(params[0]));
      const at = tagBlock(c, params[1]);
      return toHex(txsOf(c).filter((t) => lower(t.from) === wallet && t.block <= at).length);
    }
    case "eth_getCode":
      return c.code?.[lower(String(params[0]))] ?? "0x";
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

export const newRpcLog = (): ProofRpcLog => ({ methods: [], logRanges: [], calls: [], logsInFlight: {} });

/** One JSON-RPC call over `c`, answered in memory, as the team trace takes it. */
export function proofChainRpc(c: ProofChain, seen: ProofRpcLog = newRpcLog()) {
  return async (method: string, params: unknown[]) => answer(c, seen, method, params);
}

/**
 * A viem client of Base over `c`, answered in memory: the page's code path without fetch, which unit tests block
 * (test/setup.ts). `fail` makes every request fail, as an RPC that is down.
 */
export function proofChainClient(c: ProofChain, opts: { fail?: boolean } = {}): ProofClient & { seen: ProofRpcLog } {
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
  }) as unknown as ProofClient;
  return Object.assign(client, { seen });
}

/** A JSON-RPC server on 127.0.0.1 over `c`. */
export async function serveProofChain(c: ProofChain): Promise<{ url: string; seen: ProofRpcLog; close: () => Promise<void> }> {
  const seen = newRpcLog();
  let limited = c.rateLimitFirst ?? 0;
  const now = new Map<string, number>();
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => (raw += chunk.toString("utf8")));
    req.on("end", () => {
      if (limited > 0) {
        limited -= 1;
        res.writeHead(429, { "content-type": "text/plain" }).end("Too Many Requests");
        return;
      }
      const body = JSON.parse(raw) as { method?: string; params?: { address?: string }[] } | { method?: string; params?: { address?: string }[] }[];
      const logs = (Array.isArray(body) ? body : [body]).filter((r) => r.method === "eth_getLogs").map((r) => lower(String(r.params?.[0]?.address)));
      for (const a of logs) {
        now.set(a, (now.get(a) ?? 0) + 1);
        seen.logsInFlight[a] = Math.max(seen.logsInFlight[a] ?? 0, now.get(a)!);
      }
      setTimeout(
        () => {
          for (const a of logs) now.set(a, now.get(a)! - 1);
          const out = answerBody(c, seen, body);
          res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
        },
        logs.length > 0 ? (c.logDelayMs ?? 0) : 0,
      );
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
