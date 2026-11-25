import { encodeAbiParameters, encodeEventTopics, toHex, type AbiEvent, type Address, type Hash, type Hex } from "viem";
import { REASONS } from "@/content/reasons";
import { vaultAbi } from "@/lib/chain/abi";
import type { CachedLog } from "@/lib/chain/cache";
import type { LedgerClient } from "@/lib/chain/load";

export const FAKE_VAULT: Address = "0x00000000000000000000000000000000000Aa001";
export const FAKE_USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const NVDAC: Address = "0xb20000000000000000000078ee7ce2fE4908108C";
export const hash32 = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hash;

const ACTION = { BUY: 0, SELL: 1, SUPPLY: 2, WITHDRAW_COLLATERAL: 3, BORROW: 4, REPAY: 5, PAY_EXPENSE: 6 } as const;

/** A Decision log at `block`, encoded with the vault's own ABI. */
export function decisionLog(
  n: number,
  block: bigint,
  opts: { action?: keyof typeof ACTION; token?: Address; amount?: bigint; reason?: string; rationaleHash?: Hex } = {},
): CachedLog {
  const ev = vaultAbi.find((x) => x.type === "event" && x.name === "Decision") as AbiEvent;
  const reason = opts.reason ?? "OK";
  const args = {
    intentId: hash32(1000 + n),
    action: ACTION[opts.action ?? "BUY"],
    token: opts.token ?? NVDAC,
    amount: opts.amount ?? 20_000_000n,
    allowed: reason === "OK",
    reason: reason === "OK" ? 0 : REASONS.indexOf(reason as (typeof REASONS)[number]) + 1,
    rationaleHash: opts.rationaleHash ?? hash32(5000 + n),
  };
  const topics = encodeEventTopics({ abi: [ev], eventName: "Decision", args } as never) as Hex[];
  const plain = ev.inputs.filter((i) => !i.indexed);
  const data = encodeAbiParameters(plain, plain.map((i) => (args as Record<string, unknown>)[i.name!]));
  return { blockNumber: block.toString(), logIndex: 0, transactionHash: hash32(n), topics, data };
}

export interface FakeChain {
  head: bigint;
  logs: CachedLog[];
  /** Block → unix seconds. */
  times?: Record<string, number>;
  /** Tx → gas used. */
  gas?: Record<string, bigint>;
  /** Tx → its sender, target and input; a tx not listed is not found. */
  txs?: Record<string, { from: Address; to: Address | null; input: Hex }>;
  /** The vault's owner() as the treasury multicall reads it. */
  owner?: Address;
  deployTx?: { hash: Hash; block: bigint };
  bytecode?: Hex;
  timelock?: bigint;
  maxLogRange?: bigint;
  failLogs?: boolean;
  failTreasury?: boolean;
  /** eth_getBlockByNumber fails for these blocks, as an RPC that is down does. */
  failBlocks?: readonly bigint[];
  /** eth_getTransactionReceipt fails for these transactions, as an RPC that is down does. */
  failReceipts?: readonly Hash[];
}

/** The hash the fake chains give block `n`: e2e/fake-rpc.ts gives the same one. */
export const fakeBlockHash = (n: bigint) => toHex(n, { size: 32 }) as Hash;

export type FakeLedgerClient = LedgerClient & { logCalls: { from: bigint; to: bigint }[]; blockCalls: bigint[]; receiptCalls: Hash[] };

/**
 * A LedgerClient over an in-memory chain with one vault (FAKE_VAULT) holding only USDC; records each eth_getLogs range,
 * block read and receipt read. A receipt holds the chain's logs of its transaction, as the vault emitted them.
 */
export function fakeLedgerClient(chain: FakeChain): FakeLedgerClient {
  const logCalls: { from: bigint; to: bigint }[] = [];
  const blockCalls: bigint[] = [];
  const receiptCalls: Hash[] = [];
  const mandate = {
    sessionMode: 0,
    maxPremiumBps: 100,
    maxSlippageBps: 100,
    maxStaleness: 3600,
    multiplierCooldown: 86_400,
    twapWindow: 1800,
    perTradeCapUsd: 50_000_000n,
    dailyCapUsd: 100_000_000n,
    calendar: "0x0000000000000000000000000000000000000c01",
    swapAdapter: "0x0000000000000000000000000000000000000c02",
    creditAdapter: "0x0000000000000000000000000000000000000000",
    minHealthFactor: 1_500_000_000_000_000_000n,
    targetHealthFactor: 2_000_000_000_000_000_000n,
    deriskWindow: 28_800,
  };
  const answers: Record<string, unknown> = {
    owner: chain.owner ?? "0x0000000000000000000000000000000000000001",
    executor: "0x0000000000000000000000000000000000000002",
    paused: false,
    mandate,
    mandateHash: hash32(77),
    tokens: [],
    usdc: FAKE_USDC,
    balanceOf: 30_000_000n,
  };
  const client = {
    logCalls,
    blockCalls,
    receiptCalls,
    getBlockNumber: async () => chain.head,
    getBytecode: async () => chain.bytecode ?? "0x6080",
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "TIMELOCK") return chain.timelock ?? 86_400n;
      throw new Error(`unexpected readContract ${functionName}`);
    },
    getBlock: async ({ blockNumber }: { blockNumber?: bigint } = {}) => {
      if (blockNumber === undefined) return { number: chain.head, hash: fakeBlockHash(chain.head), timestamp: BigInt(chain.times?.[chain.head.toString()] ?? 1_764_000_000) };
      blockCalls.push(blockNumber);
      if (chain.failBlocks?.includes(blockNumber)) throw new TypeError("Failed to fetch");
      const t = chain.times?.[blockNumber.toString()];
      if (t === undefined || blockNumber > chain.head) throw new Error(`no block ${blockNumber}`);
      return { number: blockNumber, hash: fakeBlockHash(blockNumber), timestamp: BigInt(t) };
    },
    multicall: async ({ contracts }: { contracts: readonly { functionName: string }[] }) => {
      if (chain.failTreasury) throw new Error("multicall failed");
      return contracts.map((c) => (c.functionName in answers ? { status: "success", result: answers[c.functionName] } : { status: "failure", error: new Error(c.functionName) }));
    },
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      logCalls.push({ from: fromBlock, to: toBlock });
      if (chain.failLogs) throw new TypeError("Failed to fetch");
      if (toBlock - fromBlock + 1n > (chain.maxLogRange ?? 50_000n)) throw new Error(`exceed maximum block range: ${chain.maxLogRange ?? 50_000n}`);
      return chain.logs
        .filter((l) => BigInt(l.blockNumber) >= fromBlock && BigInt(l.blockNumber) <= toBlock)
        .map((l) => ({ ...l, blockNumber: BigInt(l.blockNumber) }));
    },
    getTransactionReceipt: async ({ hash }: { hash: Hash }) => {
      receiptCalls.push(hash);
      if (chain.failReceipts?.some((h) => h.toLowerCase() === hash.toLowerCase())) throw new TypeError("Failed to fetch");
      const own = chain.logs.filter((l) => l.transactionHash.toLowerCase() === hash.toLowerCase());
      const logs = own.map((l) => ({ ...l, address: FAKE_VAULT, blockNumber: BigInt(l.blockNumber), blockHash: fakeBlockHash(BigInt(l.blockNumber)) }));
      if (chain.deployTx && hash === chain.deployTx.hash) {
        return { blockNumber: chain.deployTx.block, blockHash: fakeBlockHash(chain.deployTx.block), gasUsed: 4_000_000n, logs };
      }
      const g = chain.gas?.[hash];
      if (g === undefined) throw new Error(`no receipt ${hash}`);
      const block = own[0] ? BigInt(own[0].blockNumber) : 0n;
      return { blockNumber: block, blockHash: fakeBlockHash(block), gasUsed: g, logs };
    },
    getTransaction: async ({ hash }: { hash: Hash }) => {
      const tx = Object.entries(chain.txs ?? {}).find(([h]) => h.toLowerCase() === hash.toLowerCase())?.[1];
      if (!tx) throw new Error(`no transaction ${hash}`);
      return { hash, ...tx };
    },
  };
  return client as unknown as FakeLedgerClient;
}

export { memoryStorage } from "@/lib/chain/cache";
