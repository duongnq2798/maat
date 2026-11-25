// The team set of the /proof counting rule (inbox spec §5), traced from Base at the block the briefs are counted to,
// and the notes the page and the recount print next to the brief lines. It has no import and only erasable types, so
// the page runs it in the browser and `node scripts/recount.mjs` runs this same file with Node's own type stripping:
// both build one team set from one RPC's answers.

/** One JSON-RPC call: its result, or a thrown error. */
export type Rpc = (method: string, params: unknown[]) => Promise<unknown>;

export interface TeamInputs {
  /** web/content/proof-team.ts. */
  team: readonly { address: string; role: string }[];
  /** web/content/proof-sends.ts: each wallet's sent transactions, in nonce order. */
  sends: readonly { wallet: string; txs: readonly string[] }[];
  /** web/content/proof-stops.ts. */
  stops: readonly { address: string; name: string; source: string }[];
  /** The Base mainnet rows of deployments/README.md. */
  deployments: readonly { contract: string; address: string; tx: string }[];
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
/** Hop 1 and hop 2. */
export const MAX_HOPS = 2;

/** Printed next to the Outside lines, on /proof and by the recount. */
export const TEAM_SET_NOTE =
  "The team set is traced from Base at the block counted to: the wallets in web/content/proof-team.ts, the vault's owner(), executor() and payees(), the deployer of every contract in deployments/README.md, and every wallet those funded within 2 hops. ETH funding comes from each wallet's sent transactions, committed in web/content/proof-sends.ts and checked against its nonce; token funding comes from the Transfer logs of those transactions and of each token they approved. A token moved by a signature alone, and ETH a wallet with code sends inside another wallet's transaction, are not seen.";
/** Printed next to the brief lines, on /proof and by the recount, until the Decision lines are counted. */
export const DECISION_NOTE =
  "The Decision lines of the rule (owner by hand, agent, probe, brief-driven) are not counted on /proof or by scripts/recount.mjs yet; the ledger labels each Decision with them.";

const VAULT_CONTRACT = "MandateVault";
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;
/** EIP-7702: an account delegated to code keeps its own nonce, so its committed list is still checked. */
const DELEGATION_PREFIX = "0xef0100";
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
  status: string;
  contractAddress: string | null;
  logs: RawLog[];
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
 * Every log of `filter` in [from, to], in block and log order. A range error halves that window and tries again; any
 * other error is thrown, since a team set with a gap in it is not the rule's.
 */
async function logsIn(rpc: Rpc, filter: { address: string; topics: (string | string[])[] }, from: bigint, to: bigint, signal?: AbortSignal): Promise<RawLog[]> {
  const queue: { lo: bigint; hi: bigint }[] = [];
  for (let lo = from; lo <= to; lo += MAX_SPAN) queue.push({ lo, hi: lo + MAX_SPAN - 1n < to ? lo + MAX_SPAN - 1n : to });
  const out: RawLog[] = [];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      abortIf(signal);
      try {
        out.push(...((await rpc("eth_getLogs", [{ ...filter, fromBlock: hex(job.lo), toBlock: hex(job.hi) }])) as RawLog[]));
      } catch (e) {
        if (!isRangeError(e) || job.hi === job.lo) throw e;
        const mid = job.lo + (job.hi - job.lo + 1n) / 2n - 1n;
        queue.unshift({ lo: job.lo, hi: mid }, { lo: mid + 1n, hi: job.hi });
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

/**
 * The team set at `block`, by the rule: the committed team list, the vault's owner(), executor() and payees(), the
 * deployer of every recorded contract, and every wallet one of those funded (hop 1) or a hop-1 wallet funded (hop 2).
 * A wallet funded means: it received ETH in a successful transaction the funder sent, from the funder's committed list
 * checked against its nonce, or a token in a Transfer log from the funder, in such a transaction or in any transaction
 * that moved a token the funder had approved in one. Hops stop at the zero address, the vault and the committed stops.
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
  const deploys = await mapLimit(rows, READ_WORKERS, async (row) => {
    const hash = row.tx.trim();
    if (hash === "") return null;
    const tx = (await rpc("eth_getTransactionByHash", [hash])) as RawTx | null;
    if (!tx) throw new Error(`the RPC has no transaction ${hash}, the deploy of ${row.contract} in deployments/README.md`);
    return tx.from;
  });
  for (const [i, row] of rows.entries()) {
    const from = deploys[i];
    if (from) add(from, 0, `deployer of ${row.contract}`);
    else gaps.push(`deployments/README.md gives no transaction for ${row.contract}, so its deployer is not known.`);
  }

  /** What one wallet's own transactions show: whom it funded, which tokens it approved, and what is missing. */
  const fundingOf = async (w: string) => {
    abortIf(signal);
    const out = { funded: [] as { to: string; why: string }[], approvals: [] as { token: string; at: bigint }[], notes: [] as string[], gaps: [] as string[] };
    const [code, nonce] = await Promise.all([rpc("eth_getCode", [w, tag]), rpc("eth_getTransactionCount", [w, tag])]);
    const bytecode = String(code).toLowerCase();
    if (bytecode !== "0x") out.notes.push(`${w} has code at block ${fmt(block)}, so ETH it sends inside a transaction another wallet sent is not seen.`);
    // A contract's nonce counts the contracts it created, not transactions it sent: it sends none of its own.
    if (bytecode !== "0x" && !bytecode.startsWith(DELEGATION_PREFIX)) return out;
    const n = Number(BigInt(String(nonce)));
    const listed = sendsOf.get(w) ?? [];
    if (listed.length < n) {
      out.gaps.push(`web/content/proof-sends.ts lists ${listed.length} of the ${n} transactions ${w} sent by block ${fmt(block)}; node scripts/recount.mjs --sends ${w} prints them.`);
    }
    const counted = listed.slice(0, n);
    const read = await mapLimit(counted, READ_WORKERS, async (hash) => {
      const [tx, receipt] = await Promise.all([rpc("eth_getTransactionByHash", [hash]), rpc("eth_getTransactionReceipt", [hash])]);
      return { tx: tx as RawTx | null, receipt: receipt as RawReceipt | null };
    });
    for (const [i, hash] of counted.entries()) {
      const { tx, receipt } = read[i]!;
      if (!tx || tx.from.toLowerCase() !== w || BigInt(tx.nonce) !== BigInt(i) || tx.blockNumber === null || BigInt(tx.blockNumber) > block) {
        throw new Error(`web/content/proof-sends.ts: ${hash} is not transaction ${i} of ${w}, sent by block ${fmt(block)}`);
      }
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
