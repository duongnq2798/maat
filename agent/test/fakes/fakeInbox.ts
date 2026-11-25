import {
  encodeAbiParameters,
  encodeEventTopics,
  InvalidInputRpcError,
  keccak256,
  RpcRequestError,
  TransactionNotFoundError,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { BRIEF_EVENT, type BriefClient } from "../../src/briefs/inbox.js";

export const INBOX: Address = "0x00000000000000000000000000000000000B0001";
export const INBOX_DEPLOY_TX: Hex = `0x${"de".repeat(32)}`;
/** The block the fake inbox was deployed in. */
export const INBOX_DEPLOY_BLOCK = 50n;
export const SENDERS: readonly Address[] = [
  "0x000000000000000000000000000000000000a11c",
  "0x000000000000000000000000000000000000b0b0",
  "0x000000000000000000000000000000000000cafE",
  "0x000000000000000000000000000000000000dEaD",
  "0x000000000000000000000000000000000000F00D",
];

interface FakeLog {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: bigint;
  transactionHash: Hex;
  logIndex: number;
}

/** A MaatInbox on a fake chain: its Brief logs, the safe block and the deploy tx, as a BriefClient answers them. */
export class FakeInbox {
  logs: FakeLog[] = [];
  /** What getBlock({ blockTag: "safe" }) returns. */
  safe = 90n;
  /** What getBlock({ blockTag: "latest" }) returns, when a test reads it. */
  latest = 100n;
  blockTags: unknown[] = [];
  queries: { address: unknown; fromBlock: bigint; toBlock: bigint }[] = [];
  /** The widest getLogs range the RPC accepts; a wider one is refused with mainnet.base.org's message. */
  rangeCap: bigint | null = null;
  /** Thrown by every getLogs call when set. */
  fail: Error | null = null;
  deployTxReads = 0;

  /** The tx hash of brief `id`'s log: distinct per id, and per `salt` for a brief a reorg re-mined. */
  static txOf(id: number, salt = 0): Hex {
    return keccak256(toHex(`brief-${id}-${salt}`));
  }

  /** Adds a Brief log; returns its tx hash. */
  brief(id: number, from: Address, text: string, block: bigint, logIndex = 0, salt = 0): Hex {
    return this.rawBrief(id, from, toHex(text), block, logIndex, salt);
  }

  /** A Brief log whose text is the raw `bytes`, which need not be UTF-8: ABI-encoded as bytes, the layout of a string. */
  rawBrief(id: number, from: Address, bytes: Hex, block: bigint, logIndex = 0, salt = 0): Hex {
    const topics = encodeEventTopics({ abi: [BRIEF_EVENT], eventName: "Brief", args: { id: BigInt(id), from } }) as Hex[];
    const transactionHash = FakeInbox.txOf(id, salt);
    this.logs.push({ address: INBOX, topics, data: encodeAbiParameters([{ type: "bytes" }], [bytes]), blockNumber: block, transactionHash, logIndex });
    return transactionHash;
  }

  /** A log of the inbox address that is not a Brief. */
  junk(block: bigint): void {
    this.logs.push({ address: INBOX, topics: [keccak256(toHex("Other()"))], data: "0x", blockNumber: block, transactionHash: keccak256(toHex(`junk-${block}`)), logIndex: 9 });
  }

  /** Removes brief `id`'s log, as a reorg would. */
  drop(id: number): void {
    this.logs = this.logs.filter((l) => BigInt(l.topics[1]!) !== BigInt(id));
  }

  client(): BriefClient {
    return {
      getBlock: (async ({ blockTag }: { blockTag?: string } = {}) => {
        this.blockTags.push(blockTag);
        const number = blockTag === "safe" ? this.safe : this.latest;
        return { number, timestamp: 1_794_000_000n };
      }) as never,
      getLogs: (async ({ address, fromBlock, toBlock }: { address: Address; fromBlock: bigint; toBlock: bigint }) => {
        this.queries.push({ address, fromBlock, toBlock });
        if (this.fail) throw this.fail;
        if (this.rangeCap !== null && toBlock - fromBlock + 1n > this.rangeCap) {
          throw new InvalidInputRpcError(
            new RpcRequestError({ body: { method: "eth_getLogs" }, error: { code: -32000, message: `eth_getLogs is limited to a ${this.rangeCap} range` }, url: "http://127.0.0.1:1" }),
          );
        }
        return this.logs.filter((l) => l.address === address && l.blockNumber >= fromBlock && l.blockNumber <= toBlock).map((l) => ({ ...l, removed: false }));
      }) as never,
      getTransaction: (async ({ hash }: { hash: Hex }) => {
        this.deployTxReads++;
        if (hash !== INBOX_DEPLOY_TX) throw new TransactionNotFoundError({ hash });
        return { hash, blockNumber: INBOX_DEPLOY_BLOCK };
      }) as never,
    } as BriefClient;
  }
}
