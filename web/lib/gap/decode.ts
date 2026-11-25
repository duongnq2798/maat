export const ANSWER_UPDATED_TOPIC = "0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f";
export const SWAP_TOPIC = "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67";

export interface RawLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  logIndex: string;
  transactionHash: string;
  blockTimestamp?: string;
}
export interface Position {
  block: number;
  logIndex: number;
}
export interface FeedUpdate extends Position {
  ts: number;
  answer: bigint;
  tx: string;
  address: string;
}
export interface Swap extends Position {
  ts: number;
  sqrtPriceX96: bigint;
  tx: string;
}

const TWO_255 = 1n << 255n;
const TWO_256 = 1n << 256n;
const num = (hex: string) => Number(BigInt(hex));

function base(log: RawLog, topic: string, what: string): Position & { ts: number; tx: string } {
  if (log.topics[0]?.toLowerCase() !== topic) throw new Error(`not a ${what} log: topic0 ${log.topics[0]}`);
  if (log.blockTimestamp === undefined) throw new Error(`${what} log without blockTimestamp at ${log.blockNumber}`);
  return { block: num(log.blockNumber), logIndex: num(log.logIndex), ts: num(log.blockTimestamp), tx: log.transactionHash.toLowerCase() };
}

export function decodeAnswerUpdated(log: RawLog): FeedUpdate {
  const b = base(log, ANSWER_UPDATED_TOPIC, "AnswerUpdated");
  const topic = log.topics[1];
  if (topic === undefined) throw new Error(`AnswerUpdated without its answer topic at ${log.blockNumber}`);
  const raw = BigInt(topic);
  return { ...b, answer: raw >= TWO_255 ? raw - TWO_256 : raw, address: log.address.toLowerCase() };
}

/** Swap data: amount0, amount1, sqrtPriceX96, liquidity, tick, one 32-byte word each. */
export function decodeSwap(log: RawLog): Swap {
  const b = base(log, SWAP_TOPIC, "Swap");
  if (log.data.length < 2 + 64 * 5) throw new Error(`short Swap data at ${log.blockNumber}`);
  return { ...b, sqrtPriceX96: BigInt(`0x${log.data.slice(2 + 128, 2 + 192)}`) };
}

export const byPosition = (a: Position, b: Position): number => a.block - b.block || a.logIndex - b.logIndex;
export const before = (a: Position, b: Position): boolean => byPosition(a, b) < 0;
