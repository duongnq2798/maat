// The team set of the /proof counting rule (inbox spec §5), traced from Base at the block the briefs are counted to,
// and the notes the page and the recount print next to the brief lines. It has no import and only erasable types, so
// the page runs it in the browser and `node scripts/recount.mjs` runs this same file with Node's own type stripping:
// both build one team set from one RPC's answers.

/** One JSON-RPC call: its result, or a thrown error. */
export type Rpc = (method: string, params: unknown[]) => Promise<unknown>;

export interface TeamInputs {
  /** web/content/proof-team.ts. */
  team: readonly { address: string; role: string }[];
  /** web/content/proof-sends.ts: sends that left no log the trace reads, each wallet's in nonce order. */
  sends: readonly { wallet: string; txs: readonly string[] }[];
  /** web/content/proof-stops.ts. */
  stops: readonly { address: string; name: string; source: string }[];
  /** The Base mainnet rows of deployments/README.md. */
  deployments: readonly { contract: string; address: string; tx: string }[];
  /**
   * The inbox's Brief logs to the block traced to, as the caller reads them (the page with the /ask reader, the recount
   * with its own scan); none before the inbox is recorded. It may still be reading: the trace reads the vault's logs
   * first and waits for it only then. A brief is a send of the wallet it names when that wallet sent its transaction.
   */
  briefScan?: BriefScan | PromiseLike<BriefScan>;
}

export interface BriefScan {
  briefs: readonly { from: string; txHash: string }[];
  /** False when some blocks of the Brief logs could not be read. */
  complete: boolean;
}

export interface TeamMember {
  /** Lowercased. */
  address: string;
  /** 0 for a wallet the rule names, 1 or 2 for a wallet a team wallet funded. */
  hop: number;
  /** Every reason found at that hop, in the order found. */
  why: string[];
}

export interface HopStop {
  address: string;
  name: string;
  source: string;
}

export interface TeamTrace {
  block: bigint;
  /** In the order found: the rule's wallets, then hop 1, then hop 2. */
  members: TeamMember[];
  stops: HopStop[];
  /** What keeps the set from being complete at `block`. Any gap leaves the brief lines without a number. */
  gaps: string[];
  /** What the rule's sources cannot show for a wallet. */
  notes: string[];
}

/** owner(), executor() and payees() of MandateVault. */
export const OWNER_SELECTOR = "0x8da5cb5b";
export const EXECUTOR_SELECTOR = "0xc34c08e5";
export const PAYEES_SELECTOR = "0x4e8086aa";
/** Transfer(address,address,uint256), the same topic for ERC-20 and ERC-721. */
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
/** Approval(address,address,uint256) and ApprovalForAll(address,address,bool): a spender may move the owner's tokens. */
export const APPROVAL_TOPIC = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";
export const APPROVAL_FOR_ALL_TOPIC = "0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31";
/**
 * The vault logs the trace reads: every event of contracts/src/IMandateVaultEvents.sol but RevenueReceived. These come
 * only from the vault's deploy, an onlyOwner call, the executor's execute(), or syncMultiplier when a token's
 * multiplier really changed. notifyRevenue() emits RevenueReceived for anyone who sent the vault some USDC, so reading
 * those transactions would let anyone add reads to every count; a team send whose only vault log is RevenueReceived
 * goes in web/content/proof-sends.ts, and the nonce check asks for it.
 */
export const VAULT_TOPICS = [
  "0x31e6f801fe8c4e61fff662a75a05831c8f1341359c56a18463b2a33bfa2df322", // Decision
  "0x3e3c5e6d5b512eaa5d5a80669846cfbaf8bde70fc6f7a3be9828cffc9ba5f1db", // ExecutorSet
  "0x40db37ff5c0bdc2c427fbb2078c8f24afea940abac0e3c23bb4ea3bf2da2b212", // PausedSet
  "0x7fa3c0bb17162e829120b28266b7550061c3b40db9435802b3b81b4be2f1d4b1", // MandateChangeQueued
  "0x52c7e79abff67f340ea03b262ee706f9f7b59fd984c52ae45155eaef031057d9", // TokenConfigChangeQueued
  "0x423f006fc8dc13dda4a71fe928443739e83a14faa2810b7fcb4a8bd4706eb9c5", // PayeeChangeQueued
  "0xef2393afd41f32c607a123de95d703349edd33ea1d86af21535ea8040ec7d984", // ChangeCancelled
  "0x48a58304e6581974b55d2169e131804a3984e0168c1086504cd7a1d19185d994", // PolicyHashUpdated
  "0xc4c14883ae9fd8e26d5d59e3485ed29fd126d781d7e498a4ca5c54c8268e4936", // Funded
  "0xaea77b7649e3343e5d89ceb4132fd66a08e73f20f496e5d7161eadd9ec790065", // MandateApplied
  "0xa2c02b8677f11c939af7c4a0d31d7f0d60a5e8bf8596a909d6948b9205189cd1", // TokenConfigApplied
  "0x88e8dfde3169975f3002ffc3ae3d6f4f98cd78b415c780b4102860a39de5189c", // PayeeApplied
  "0x7084f5476618d8e60b11ef0d7d3f06914655adb8793e28ff7f018d4c76d505d5", // Withdrawn
  "0xd2e626325a6f2abbc5f3e654cf4b4bb4221fd1ceb5bdb212fc4d136398943ac9", // MultiplierChangeDetected
] as const;
/** Hop 1 and hop 2. */
export const MAX_HOPS = 2;

/** Printed next to the Outside lines, on /proof and by the recount. */
export const TEAM_SET_NOTE =
  "The team set is traced from Base at the block counted to: the wallets in web/content/proof-team.ts, the vault's owner(), executor() and payees(), the deployer of every contract in deployments/README.md, and every wallet those funded within 2 hops. ETH funding comes from each wallet's sent transactions, checked against its nonce: those that left a log of the vault other than RevenueReceived, which anyone can make it emit, or a Brief of MaatInbox that names the wallet, are read from those logs, and the rest are committed in web/content/proof-sends.ts. Token funding comes from the Transfer logs of those transactions and of each token they approved. A token moved by a signature alone, and ETH a wallet with code sends inside another wallet's transaction, are not seen.";
/** Printed next to the brief lines, on /proof and by the recount, until the Decision lines are counted. */
export const DECISION_NOTE =
  "The Decision lines of the rule (owner by hand, agent, probe, brief-driven) are not counted on /proof or by scripts/recount.mjs yet; the ledger labels each Decision with them.";

const VAULT_CONTRACT = "MandateVault";
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;
/**
 * EIP-7702: an account delegated to code. That code can send ETH inside the account's own transactions, which neither a
 * log nor the transaction shows, and its nonce counts authorizations as well as sends.
 */
const DELEGATION_PREFIX = "0xef0100";
/** The recount's --sends, with an RPC that answers for past blocks and one that serves eth_getLogs 50,000 blocks at a time. */
const sendsCommand = (wallet: string) => `node scripts/recount.mjs --sends ${wallet} --rpc https://mainnet.base.org --logs-rpc https://base-rpc.publicnode.com`;
const FULL_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const FULL_HASH = /^0x[0-9a-fA-F]{64}$/;
/** The widest eth_getLogs range tried first: base-rpc.publicnode.com's limit (web/lib/chain/scan.ts LOG_CHUNK). */
const MAX_SPAN = 50_000n;
const LOG_WORKERS = 4;
/** Transaction and wallet reads in flight at once; the page's client batches them into one HTTP request. */
const READ_WORKERS = 8;
/** An RPC's answer to a range that is too wide (web/lib/chain/scan.ts). */
const RANGE_ERROR = /block range|ranges? over|limited to (?:a )?[\d,\s-]+(?:blocks? )?range|max(?:imum)? (?:block )?range/i;

interface RawTx {
  from: string;
  nonce: string;
  to: string | null;
  value: string;
  blockNumber: string | null;
}
interface RawLog {
  address: string;
  topics: string[];
  blockNumber: string;
  logIndex: string;
  transactionHash: string;
}
interface RawReceipt {
  from: string;
  status: string;
  contractAddress: string | null;
  logs: RawLog[];
}
/** A transaction hash, lowercased, with what the RPC gave for it. */
interface Read {
  hash: string;
  tx: RawTx | null;
  receipt: RawReceipt | null;
}
/** A send of a wallet by `block`: its transaction is known, and its receipt is read when the send is processed. */
interface Send extends Read {
  tx: RawTx & { blockNumber: string };
}

const hex = (n: bigint) => `0x${n.toString(16)}`;
const fmt = (n: bigint) => n.toLocaleString("en-US");
const topicOf = (address: string) => `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
const addressOf = (word: string) => `0x${word.slice(-40)}`.toLowerCase();

function checked(address: string, file: string): string {
  if (typeof address !== "string" || !FULL_ADDRESS.test(address)) throw new Error(`${file} has "${String(address)}", not 0x and 40 hex digits`);
  return address.toLowerCase();
}

function isRangeError(e: unknown, depth = 0): boolean {
  if (depth > 5 || typeof e !== "object" || e === null) return false;
  const o = e as { message?: unknown; details?: unknown; cause?: unknown };
  const text = `${typeof o.message === "string" ? o.message : ""} ${typeof o.details === "string" ? o.details : ""}`;
  return RANGE_ERROR.test(text) || isRangeError(o.cause, depth + 1);
}

function abortIf(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("The team trace was aborted.", "AbortError");
}

/** `fn` over `items`, at most `limit` at a time, with the results in the order of `items`. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** The addresses of an ABI-encoded address[] return value. */
function addressList(data: string): string[] {
  const words = (data.slice(2).match(/.{64}/g) ?? []).map((w) => `0x${w}`);
  const at = Number(BigInt(words[0] ?? "0x0") / 32n);
  const n = Number(BigInt(words[at] ?? "0x0"));
  return words.slice(at + 1, at + 1 + n).map(addressOf);
}

/**
 * Every log of `filter` in [from, to], in block and log order. A range error halves that window and tries again, and
 * the windows still to come start at that width; any other error is thrown, since a team set with a gap in it is not
 * the rule's.
 */
async function logsIn(rpc: Rpc, filter: { address: string; topics?: (string | string[])[] }, from: bigint, to: bigint, signal?: AbortSignal): Promise<RawLog[]> {
  let span = MAX_SPAN;
  let next = from;
  const split: { lo: bigint; hi: bigint }[] = [];
  const take = () => {
    const job = split.shift();
    if (job || next > to) return job;
    const lo = next;
    const hi = lo + span - 1n < to ? lo + span - 1n : to;
    next = hi + 1n;
    return { lo, hi };
  };
  const out: RawLog[] = [];
  const worker = async () => {
    for (let job = take(); job; job = take()) {
      abortIf(signal);
      try {
        out.push(...((await rpc("eth_getLogs", [{ ...filter, fromBlock: hex(job.lo), toBlock: hex(job.hi) }])) as RawLog[]));
      } catch (e) {
        if (!isRangeError(e) || job.hi === job.lo) throw e;
        const half = (job.hi - job.lo + 1n) / 2n;
        if (half < span) span = half;
        split.unshift({ lo: job.lo, hi: job.lo + half - 1n }, { lo: job.lo + half, hi: job.hi });
      }
    }
  };
  await Promise.all(Array.from({ length: LOG_WORKERS }, worker));
  const key = (l: RawLog) => [BigInt(l.blockNumber), BigInt(l.logIndex)] as const;
  return out.sort((a, b) => {
    const [ab, ai] = key(a);
    const [bb, bi] = key(b);
    return ab === bb ? (ai < bi ? -1 : ai > bi ? 1 : 0) : ab < bb ? -1 : 1;
  });
}

const byNonce = (a: Send, b: Send) => {
  const [x, y] = [BigInt(a.tx.nonce), BigInt(b.tx.nonce)];
  return x < y ? -1 : x > y ? 1 : 0;
};

/** Each transaction and each receipt read once per trace, however many sources name its hash. */
function reader(rpc: Rpc) {
  const once = <T>(method: string) => {
    const seen = new Map<string, Promise<T>>();
    return (hash: string) => {
      let p = seen.get(hash);
      if (!p) {
        p = rpc(method, [hash]) as Promise<T>;
        seen.set(hash, p);
      }
      return p;
    };
  };
  const txOf = once<RawTx | null>("eth_getTransactionByHash");
  const receiptOf = once<RawReceipt | null>("eth_getTransactionReceipt");
  const read = async (hash: string): Promise<Read> => {
    const [tx, receipt] = await Promise.all([txOf(hash), receiptOf(hash)]);
    return { hash, tx, receipt };
  };
  return { txOf, read };
}

/**
 * The vault of deployments/README.md and the block of its deploy transaction, where its logs start; null when the table
 * gives no vault or no deploy transaction for it, which leaves the trace a gap of its own.
 */
async function vaultOf(rows: TeamInputs["deployments"], txOf: (hash: string) => Promise<RawTx | null>) {
  const row = rows.find((r) => r.contract === VAULT_CONTRACT && r.address.trim() !== "");
  const hash = row?.tx.trim().toLowerCase() ?? "";
  if (!row || hash === "") return null;
  const tx = await txOf(hash);
  if (!tx) throw new Error(`the RPC has no transaction ${hash}, the deploy of ${VAULT_CONTRACT} in deployments/README.md`);
  return tx.blockNumber === null ? null : { address: checked(row.address.trim(), "deployments/README.md"), from: BigInt(tx.blockNumber) };
}

/**
 * The sends the logs give, wallet by wallet: every transaction with a vault log of VAULT_TOPICS from its deploy block to
 * `block`, by its sender, whoever that is (anyone may call syncMultiplier); and each brief's transaction, for the wallet
 * the Brief names, only when that wallet sent it. All vault transactions are read here, at most READ_WORKERS at a time,
 * before the Brief scan is waited for; a wallet's briefs are read when its sends are. A send counts only toward the
 * wallet that sent it, so a log never covers another wallet's send.
 */
async function logSends(
  rpc: Rpc,
  read: (hash: string) => Promise<Read>,
  vault: { address: string; from: bigint } | null,
  briefScan: TeamInputs["briefScan"],
  block: bigint,
  signal?: AbortSignal,
): Promise<{ of: (wallet: string) => Promise<Send[]>; briefsComplete: boolean }> {
  const sent = (r: Read, source: string): Send => {
    const { tx, receipt } = r;
    if (!tx || !receipt) throw new Error(`the RPC has no transaction or no receipt for ${r.hash}, ${source}`);
    if (tx.from.toLowerCase() !== receipt.from.toLowerCase()) throw new Error(`the RPC gives ${r.hash} two senders, ${tx.from} and ${receipt.from}`);
    if (tx.blockNumber === null || BigInt(tx.blockNumber) > block) throw new Error(`the RPC gives ${r.hash}, ${source}, no block by ${fmt(block)}`);
    return { ...r, tx: { ...tx, blockNumber: tx.blockNumber } };
  };
  const byVault = new Map<string, Send[]>();
  if (vault && vault.from <= block) {
    const logs = await logsIn(rpc, { address: vault.address, topics: [[...VAULT_TOPICS]] }, vault.from, block, signal);
    const hashes = [...new Set(logs.map((l) => l.transactionHash.toLowerCase()))];
    for (const r of await mapLimit(hashes, READ_WORKERS, read)) {
      const s = sent(r, `which left a log of ${VAULT_CONTRACT}`);
      const from = s.tx.from.toLowerCase();
      byVault.set(from, [...(byVault.get(from) ?? []), s]);
    }
  }
  const { briefs, complete } = (await briefScan) ?? { briefs: [], complete: true };
  const briefsOf = new Map<string, Set<string>>();
  for (const b of briefs) {
    const from = checked(b.from, "a Brief log");
    briefsOf.set(from, (briefsOf.get(from) ?? new Set()).add(String(b.txHash).toLowerCase()));
  }
  const of = async (wallet: string) => {
    const out = new Map((byVault.get(wallet) ?? []).map((s) => [s.hash, s]));
    for (const r of await mapLimit([...(briefsOf.get(wallet) ?? [])], READ_WORKERS, read)) {
      const s = sent(r, `the transaction of a Brief from ${wallet}`);
      if (s.tx.from.toLowerCase() === wallet) out.set(s.hash, s);
    }
    return [...out.values()].sort(byNonce);
  };
  return { of, briefsComplete: complete };
}

/**
 * The sends of `wallet` by `block` that the trace reads from logs, in nonce order: those that left a vault log of
 * VAULT_TOPICS, and its briefs. `node scripts/recount.mjs --sends` prints the wallet's other sends, the ones
 * web/content/proof-sends.ts must hold. Same reads as traceTeam.
 */
export async function loggedSends(
  rpc: Rpc,
  inputs: Pick<TeamInputs, "deployments" | "briefScan">,
  wallet: string,
  block: bigint,
  signal?: AbortSignal,
): Promise<{ hash: string; nonce: bigint; block: bigint }[]> {
  const w = checked(wallet, "the wallet asked for");
  const { txOf, read } = reader(rpc);
  const vault = await vaultOf(inputs.deployments, txOf);
  const sends = await (await logSends(rpc, read, vault, inputs.briefScan, block, signal)).of(w);
  return sends.map((s) => ({ hash: s.hash, nonce: BigInt(s.tx.nonce), block: BigInt(s.tx.blockNumber) }));
}

/**
 * The team set at `block`, by the rule: the committed team list, the vault's owner(), executor() and payees(), the
 * deployer of every recorded contract, and every wallet one of those funded (hop 1) or a hop-1 wallet funded (hop 2).
 * A wallet funded means: it received ETH in a successful transaction the funder sent, or a token in a Transfer log from
 * the funder, in such a transaction or in any transaction that moved a token the funder had approved in one. The
 * funder's sends are those the logs give (logSends) and those of its committed list, each counted once and checked
 * against its nonce. Hops stop at the zero address, the vault and the committed stops.
 */
export async function traceTeam(rpc: Rpc, inputs: TeamInputs, block: bigint, signal?: AbortSignal): Promise<TeamTrace> {
  const tag = hex(block);
  const gaps: string[] = [];
  const notes: string[] = [];

  const stops = new Map<string, HopStop>();
  const stop = (address: string, name: string, source: string) => {
    if (!stops.has(address)) stops.set(address, { address, name, source });
  };
  stop(ZERO_ADDRESS, "the zero address", "a mint or a burn, not a wallet");
  const rows = inputs.deployments.filter((r) => r.address.trim() !== "");
  const vault = rows.find((r) => r.contract === VAULT_CONTRACT);
  const vaultAddress = vault ? checked(vault.address.trim(), "deployments/README.md") : null;
  if (vaultAddress) stop(vaultAddress, VAULT_CONTRACT, "deployments/README.md");
  for (const s of inputs.stops) stop(checked(s.address, "web/content/proof-stops.ts"), String(s.name), String(s.source));

  const sendsOf = new Map<string, string[]>();
  for (const s of inputs.sends) {
    const wallet = checked(s.wallet, "web/content/proof-sends.ts");
    if (sendsOf.has(wallet)) throw new Error(`web/content/proof-sends.ts lists ${wallet} twice`);
    const txs = s.txs.map((h) => {
      if (typeof h !== "string" || !FULL_HASH.test(h)) throw new Error(`web/content/proof-sends.ts has "${String(h)}" for ${wallet}, not 0x and 64 hex digits`);
      return h.toLowerCase();
    });
    sendsOf.set(wallet, txs);
  }

  const members = new Map<string, TeamMember>();
  const add = (address: string, hop: number, why: string) => {
    const a = address.toLowerCase();
    if (stops.has(a)) return;
    const m = members.get(a);
    if (!m) members.set(a, { address: a, hop, why: [why] });
    else if (m.hop === hop && !m.why.includes(why)) m.why.push(why);
  };

  for (const t of inputs.team) add(checked(t.address, "web/content/proof-team.ts"), 0, `web/content/proof-team.ts (${t.role})`);
  if (vaultAddress) {
    const read = async (data: string) => String(await rpc("eth_call", [{ to: vaultAddress, data }, tag]));
    const [owner, executor, payees] = await Promise.all([read(OWNER_SELECTOR), read(EXECUTOR_SELECTOR), read(PAYEES_SELECTOR)]);
    add(addressOf(owner), 0, "the vault's owner()");
    add(addressOf(executor), 0, "the vault's executor()");
    for (const p of addressList(payees)) add(p, 0, "on the vault's payees()");
  }
  const { txOf, read } = reader(rpc);
  const deploys = await mapLimit(rows, READ_WORKERS, async (row) => {
    const hash = row.tx.trim().toLowerCase();
    if (hash === "") return null;
    const tx = await txOf(hash);
    if (!tx) throw new Error(`the RPC has no transaction ${hash}, the deploy of ${row.contract} in deployments/README.md`);
    return tx.from;
  });
  for (const [i, row] of rows.entries()) {
    const from = deploys[i];
    if (from) add(from, 0, `deployer of ${row.contract}`);
    else gaps.push(`deployments/README.md gives no transaction for ${row.contract}, so its deployer is not known.`);
  }
  const logged = await logSends(rpc, read, await vaultOf(rows, txOf), inputs.briefScan, block, signal);

  /** What one wallet's own transactions show: whom it funded, which tokens it approved, and what is missing. */
  const fundingOf = async (w: string) => {
    abortIf(signal);
    const out = { funded: [] as { to: string; why: string }[], approvals: [] as { token: string; at: bigint }[], notes: [] as string[], gaps: [] as string[] };
    const [code, nonce] = await Promise.all([rpc("eth_getCode", [w, tag]), rpc("eth_getTransactionCount", [w, tag])]);
    const bytecode = String(code).toLowerCase();
    const delegated = bytecode.startsWith(DELEGATION_PREFIX);
    // A contract's nonce counts the contracts it created, not transactions it sent: it sends none of its own.
    if (bytecode !== "0x" && !delegated) {
      out.notes.push(`${w} has code at block ${fmt(block)}, so ETH it sends inside a transaction another wallet sent is not seen.`);
      return out;
    }
    // A delegated wallet's sends are still read for whom they funded, but they cannot make it complete.
    if (delegated) {
      out.gaps.push(
        `${w} is delegated to code by EIP-7702 at block ${fmt(block)}: that code can send ETH inside the wallet's own transactions, which no log shows, and its nonce counts authorizations as well as sends, so its sends cannot be checked.`,
      );
    }
    const n = BigInt(String(nonce));
    // The committed list, in nonce order; a send after `block` is past the count. Then the sends the logs give. A hash
    // in both is one send.
    const known = new Map<string, Send>();
    let last = -1n;
    for (const r of await mapLimit(sendsOf.get(w) ?? [], READ_WORKERS, read)) {
      if (!r.tx || r.tx.from.toLowerCase() !== w) throw new Error(`web/content/proof-sends.ts: ${r.hash} is not a transaction ${w} sent`);
      const at = BigInt(r.tx.nonce);
      if (at <= last) throw new Error(`web/content/proof-sends.ts lists the transactions of ${w} out of nonce order: ${r.hash} has nonce ${at}, after nonce ${last}.`);
      last = at;
      if (r.tx.blockNumber !== null && BigInt(r.tx.blockNumber) <= block) known.set(r.hash, { ...r, tx: { ...r.tx, blockNumber: r.tx.blockNumber } });
    }
    for (const s of await logged.of(w)) known.set(s.hash, s);
    const sends = [...known.values()].sort(byNonce);
    // Each of them takes one nonce below the wallet's nonce at `block`, so they are all its sends when they are as many.
    for (const [i, s] of sends.entries()) {
      const at = BigInt(s.tx.nonce);
      const before = sends[i - 1];
      if (at >= n) throw new Error(`the RPC gives ${s.hash} the nonce ${at} of ${w}, past its nonce ${n} at block ${fmt(block)}`);
      if (before && at === BigInt(before.tx.nonce)) throw new Error(`the RPC gives ${before.hash} and ${s.hash} the same nonce of ${w}, ${at}`);
    }
    const missing = Number(n) - sends.length;
    if (missing > 0 && !delegated) {
      const one = missing === 1;
      const sent = `${w} sent ${n} ${n === 1n ? "transaction" : "transactions"} by block ${fmt(block)}, and ${missing} ${one ? "is" : "are"} missing:`;
      out.gaps.push(
        logged.briefsComplete
          ? `${sent} in no vault or MaatInbox log the trace reads, and not in web/content/proof-sends.ts. ${sendsCommand(w)} prints ${one ? "it" : "them"}.`
          : `${sent} in no vault log the trace reads, in no Brief log that could be read, and not in web/content/proof-sends.ts. ${one ? "It may be a brief" : "They may be briefs"} in the blocks that could not be read; ${sendsCommand(w)} reads every Brief log and prints any send the list needs.`,
      );
    }
    for (const { hash, tx, receipt } of sends) {
      if (!receipt) throw new Error(`the RPC has no receipt for ${hash}`);
      // A reverted transaction moved no value and its logs are gone.
      if (receipt.status !== "0x1") continue;
      const to = tx.to ?? receipt.contractAddress;
      if (BigInt(tx.value) > 0n && to) out.funded.push({ to, why: `ETH from ${w} in ${hash}` });
      for (const log of receipt.logs) {
        const [t0 = "", t1 = "", t2 = ""] = log.topics.map((t) => t.toLowerCase());
        if (t1 !== topicOf(w)) continue;
        const token = log.address.toLowerCase();
        if (t0 === TRANSFER_TOPIC && t2 !== "") out.funded.push({ to: addressOf(t2), why: `${token} from ${w} in ${hash}` });
        if (t0 === APPROVAL_TOPIC || t0 === APPROVAL_FOR_ALL_TOPIC) out.approvals.push({ token, at: BigInt(tx.blockNumber) });
      }
    }
    return out;
  };

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const wallets = [...members.values()].filter((m) => m.hop === hop).map((m) => m.address);
    const results = await mapLimit(wallets, READ_WORKERS, fundingOf);
    const funded: { to: string; why: string }[] = [];
    /** Token → the first block one of this hop's wallets approved it in, and those wallets. */
    const approved = new Map<string, { from: bigint; wallets: Set<string> }>();
    for (const [i, w] of wallets.entries()) {
      const r = results[i]!;
      notes.push(...r.notes);
      gaps.push(...r.gaps);
      funded.push(...r.funded);
      for (const { token, at } of r.approvals) {
        const a = approved.get(token);
        if (!a) approved.set(token, { from: at, wallets: new Set([w]) });
        else {
          a.wallets.add(w);
          if (at < a.from) a.from = at;
        }
      }
    }
    // A token a wallet approved can leave it in a transaction a spender sent; its Transfer log still names the wallet.
    for (const [token, a] of approved) {
      for (const log of await logsIn(rpc, { address: token, topics: [TRANSFER_TOPIC, [...a.wallets].map(topicOf)] }, a.from, block, signal)) {
        const [, t1 = "", t2 = ""] = log.topics.map((t) => t.toLowerCase());
        if (t2 !== "") funded.push({ to: addressOf(t2), why: `${token} from ${addressOf(t1)} in ${log.transactionHash.toLowerCase()}` });
      }
    }
    for (const f of funded) add(f.to, hop + 1, f.why);
  }

  return { block, members: [...members.values()], stops: [...stops.values()], gaps, notes };
}

/** The trace as text, one line each: the team set, the hop stops, what is not seen, and what is missing. */
export function teamLines(t: TeamTrace): string[] {
  return [
    ...t.members.map((m) => `Team set ${m.address}: hop ${m.hop}, ${m.why.join("; ")}`),
    ...t.stops.map((s) => `Hop stop ${s.address}: ${s.name} (${s.source})`),
    ...t.notes.map((n) => `Not seen: ${n}`),
    ...t.gaps.map((g) => `Incomplete: ${g}`),
  ];
}
