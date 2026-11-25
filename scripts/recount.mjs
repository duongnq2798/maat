#!/usr/bin/env node
// Rebuilds the brief lines of the site's /proof page from Base mainnet alone, by the counting rule of
// docs/superpowers/specs/2026-11-25-maat-inbox-design.md, section 5. It reads the deployments table from
// deployments/README.md and the five lists from web/content/ (the team list, the team sends that no vault or inbox log
// the trace reads gives, the hop stops, the hide-list and the bounty claimants), then every Brief log of the inbox, the
// team set traced at the block counted to, and the Coinbase Verified Account of each outside wallet, over a keyless
// JSON-RPC. The Decision lines of the rule are not rebuilt yet, and it says so.
//
//   node scripts/recount.mjs [--rpc <url>] [--logs-rpc <url>] [--to-block <n>] [--root <dir>] [--snapshot]
//   node scripts/recount.mjs --sends <wallet> --rpc <archive url> [--logs-rpc <url>] [--to-block <n>] [--root <dir>]
//
// No dependency: Node's built-ins and fetch only. It reads the TypeScript lists, and the team trace
// web/app/(site)/proof/team.ts that the page runs too, with Node's own type stripping, which Node.js 24 has on by
// default. web/app/(site)/proof/count.ts is the page's copy of the counting steps, and web/test/proof-recount.test.ts
// runs the page and this script on one fixture and wants the same lines.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const DEFAULT_RPC = "https://base-rpc.publicnode.com";
export const BASE_CHAIN_ID = 8453;
/** web/lib/chain/config.ts SCAN_FLOOR_BLOCK: where the scan starts when the inbox's deploy tx is not recorded. */
export const SCAN_FLOOR_BLOCK = 59_735_280n;
/** keccak256("Brief(uint256,address,string)"), the inbox's only event. Node has no keccak, so it is written here. */
export const BRIEF_TOPIC = "0x6990c09d9f6bf654815df468a70bea4545776ea2b7316f7340b23b30e1d45936";

// Coinbase Verifications on Base, from the official repository, https://github.com/coinbase/verifications: the Base
// mainnet table of its README gives the Coinbase Indexer, the EAS predeploy and the "Verified Account" schema, and
// src/interfaces/IAttestationIndexer.sol gives getAttestationUid(address recipient, bytes32 schemaUid). The page
// reads the same three (web/app/(site)/proof/verified.ts).
export const COINBASE_INDEXER = "0x2c7ee1e5f416dff40054c27a62f7b357c4e8619c";
export const EAS = "0x4200000000000000000000000000000000000021";
export const VERIFIED_ACCOUNT_SCHEMA = "0xf8b05c79f090979bf4a80270aba232dff11a10d9ca55c4f88de95317970f0de9";
/** The selector of getAttestationUid(address,bytes32). */
export const GET_ATTESTATION_UID = "0xab2717dd";
/** The selector of getAttestation(bytes32). */
export const GET_ATTESTATION = "0xa3112a64";

const RATE_LIMIT = /rate.?limit|too many requests/i;
const RETRIES = 5;
const ZERO32 = `0x${"0".repeat(64)}`;
const RULE = "docs/superpowers/specs/2026-11-25-maat-inbox-design.md, section 5";
/** The committed snapshot of the vault's logs (web/lib/chain/snapshot.ts), which --snapshot reads. */
const SNAPSHOT_FILE = "web/content/generated/decisions-snapshot.json";

const USAGE = `Rebuilds the /proof brief lines from Base mainnet alone.

  node scripts/recount.mjs [--rpc <url>] [--logs-rpc <url>] [--to-block <n>] [--root <dir>] [--snapshot]
  node scripts/recount.mjs --sends <wallet> --rpc <archive url> [--logs-rpc <url>] [--to-block <n>] [--root <dir>]

  --rpc <url>        a Base mainnet JSON-RPC (default ${DEFAULT_RPC})
  --logs-rpc <url>   read eth_getLogs from this Base mainnet RPC instead of --rpc (default: --rpc)
  --to-block <n>     count to block n, the block /proof says it counted to, as it prints it or as digits (default: the head)
  --root <dir>       read deployments/README.md and web/content/ from this checkout (default: this script's)
  --snapshot         take the vault's logs below the committed snapshot's reorg window from
                     ${SNAPSHOT_FILE}, as /proof does, once the RPC gives the file's block the hash it
                     records and each log's transaction receipt holds it, and read only the other blocks. Without it,
                     every log is read from the RPC, from the vault's deploy block on, and the recount depends on no
                     file but the deployments table and the five lists.
  --sends <wallet>   print the entry of web/content/proof-sends.ts the wallet needs at block n: the transactions it
                     sent that left no vault log the team trace reads (it skips RevenueReceived, which anyone can
                     make the vault emit) and no Brief of MaatInbox, in nonce order. It reads the wallet's nonce at
                     past blocks, which takes an archive RPC such as https://mainnet.base.org, and the vault's logs,
                     which that RPC serves 200 blocks at a time: --logs-rpc ${DEFAULT_RPC} reads them 50,000
                     at a time.
`;

/** The team trace the page runs, from this script's own checkout. */
const TEAM_MODULE = new URL("../web/app/(site)/proof/team.ts", import.meta.url);

// ---------------------------------------------------------------------------------------------------------------
// deployments/README.md, read as web/lib/docs/docs-data.ts parseDeployments reads it.

const DEPLOYMENTS_FILE = "deployments/README.md";
const DEPLOYMENT_HEAD = ["Network", "Contract", "Address", "Tx", "Date"];
const DEPLOYMENT_NETWORK = "Base mainnet";
const FULL_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const FULL_HASH = /^0x[0-9a-fA-F]{64}$/;

const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** The rows of the first table in deployments/README.md, with the checks of parseDeployments. */
export function parseDeployments(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const isRow = (line) => line.trimStart().startsWith("|");
  const cells = (line) =>
    line
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) =>
        c
          .trim()
          .replace(/^\[([^\]]*)\]\([^)]*\)$/, "$1")
          .replace(/^`([^`]*)`$/, "$1"),
      );
  const start = lines.findIndex(isRow);
  if (start < 0) throw new Error(`${DEPLOYMENTS_FILE} has no table`);
  const head = cells(lines[start] ?? "");
  if (head.join(" | ") !== DEPLOYMENT_HEAD.join(" | ")) {
    throw new Error(`${DEPLOYMENTS_FILE}: the table's columns are ${head.join(" | ")}, not ${DEPLOYMENT_HEAD.join(" | ")}`);
  }
  const out = [];
  for (const line of lines.slice(start + 2)) {
    if (!isRow(line)) break;
    const row = cells(line);
    if (row.length !== DEPLOYMENT_HEAD.length) throw new Error(`${DEPLOYMENTS_FILE}: the row ${line.trim()} has ${row.length} cells, not ${DEPLOYMENT_HEAD.length}`);
    const [network = "", contract = "", address = "", tx = "", date = ""] = row;
    if (address !== "" && !FULL_ADDRESS.test(address)) throw new Error(`${DEPLOYMENTS_FILE}: the row ${line.trim()} has the address ${address}, not an empty cell or 0x and 40 hex digits`);
    if (network !== DEPLOYMENT_NETWORK) throw new Error(`${DEPLOYMENTS_FILE}: the row ${line.trim()} is on the network ${network}, not ${DEPLOYMENT_NETWORK}`);
    if (tx !== "" && !FULL_HASH.test(tx)) throw new Error(`${DEPLOYMENTS_FILE}: the row ${line.trim()} has the transaction ${tx}, not an empty cell or 0x and 64 hex digits`);
    if (date !== "" && !isDay(date)) throw new Error(`${DEPLOYMENTS_FILE}: the row ${line.trim()} has the date ${date}, not an empty cell or a calendar day as YYYY-MM-DD`);
    out.push({ network, contract, address, tx, date });
  }
  return out;
}

/** The Base mainnet MaatInbox of the table, lowercased, or null while it has no such row or its address is empty. */
export function inboxRecord(rows) {
  const row = rows.find((r) => r.network === DEPLOYMENT_NETWORK && r.contract === "MaatInbox");
  const address = row?.address.trim() ?? "";
  if (!row || address === "") return null;
  const tx = row.tx.trim();
  return { inbox: address.toLowerCase(), deployTx: tx === "" ? null : tx.toLowerCase() };
}

// ---------------------------------------------------------------------------------------------------------------
// The counting rule: the same steps as web/app/(site)/proof/count.ts.

function addresses(list, name) {
  if (!Array.isArray(list)) throw new Error(`the ${name} list is not an array`);
  return list.map((entry) => {
    const address = entry?.address;
    if (typeof address !== "string" || !FULL_ADDRESS.test(address)) throw new Error(`the ${name} list has "${address}", not 0x and 40 hex digits`);
    return address.toLowerCase();
  });
}

function wallets(briefs) {
  const by = new Map();
  for (const b of briefs) by.set(b.from, (by.get(b.from) ?? 0) + 1);
  return [...by.entries()].map(([address, n]) => ({ address, briefs: n }));
}

/**
 * Team briefs apart; every other brief is an outside brief, hidden or not; bounty claimants from their list alone.
 * `lists.team` is the whole team set: the members of the team trace.
 */
export function countBriefs(briefs, lists) {
  const team = new Set(addresses(lists.team, "team"));
  const claimants = addresses(lists.bounty, "bounty");
  if (!Array.isArray(lists.hidden) || !lists.hidden.every((id) => Number.isSafeInteger(id))) throw new Error("the hide-list is not a list of brief ids");
  const hidden = new Set(lists.hidden);
  const sorted = briefs.map((b) => ({ id: b.id, from: b.from.toLowerCase() })).sort((a, b) => a.id - b.id);
  const outside = sorted.filter((b) => !team.has(b.from));
  const inside = sorted.filter((b) => team.has(b.from));
  const seen = new Set();
  const bounty = lists.bounty.flatMap((c, i) => {
    const address = claimants[i];
    if (seen.has(address)) return [];
    seen.add(address);
    return [{ address, evidence: String(c.evidence) }];
  });
  return {
    outsideBriefs: outside.length,
    outsideWallets: wallets(outside),
    teamBriefs: inside.length,
    teamWallets: wallets(inside),
    hidden: outside.filter((b) => hidden.has(b.id)),
    bounty,
  };
}

const formatCount = (n) => n.toLocaleString("en-US");
const briefsText = (n) => `${formatCount(n)} ${n === 1 ? "brief" : "briefs"}`;

/** What a brief line says in place of a number when the count is incomplete or the inbox is not recorded. */
const STATE_TEXT = { incomplete: "incomplete", "not-deployed": "not deployed" };

/**
 * The lines /proof shows, in its words: the six lines; when `state` is "counted", the rows behind them; the bounty
 * claimants; then `teamText`, the trace's lines. Otherwise each brief line gives the state's word in place of a number.
 */
export function reportLines(count, verified, state = "counted", teamText = []) {
  const counted = state === "counted";
  const brief = (n) => (counted ? formatCount(n) : STATE_TEXT[state]);
  const holders = count.outsideWallets.filter((w) => verified.get(w.address)).length;
  return [
    `Outside briefs: ${brief(count.outsideBriefs)}`,
    `Outside wallets: ${brief(count.outsideWallets.length)}`,
    `Outside wallets with a Verified Account: ${brief(holders)}`,
    `Team briefs: ${brief(count.teamBriefs)}`,
    `Hidden briefs: ${brief(count.hidden.length)}`,
    `Bounty claimants: ${formatCount(count.bounty.length)}`,
    ...(counted ? count.outsideWallets : []).map((w) => {
      const uid = verified.get(w.address);
      return `Outside wallet ${w.address}: ${briefsText(w.briefs)}, ${uid ? `Verified Account ${uid}` : "no Verified Account"}`;
    }),
    ...(counted ? count.teamWallets : []).map((w) => `Team wallet ${w.address}: ${briefsText(w.briefs)}`),
    ...(counted ? count.hidden : []).map((h) => `Hidden brief #${h.id} from ${h.from}`),
    ...count.bounty.map((c) => `Bounty claimant ${c.address}: ${c.evidence}`),
    ...teamText,
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// JSON-RPC over fetch.

class RpcError extends Error {
  constructor(method, code, message) {
    super(`${method}: ${message}`);
    this.code = code;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex = (n) => `0x${n.toString(16)}`;

/** One RPC. A rate limit, an HTTP 5xx or a network error is retried with backoff; any other error is thrown. */
export function rpcClient(url) {
  let id = 0;
  return async function call(method, params) {
    for (let attempt = 0; ; attempt++) {
      const retry = async (why) => {
        if (attempt >= RETRIES) throw new Error(`${method}: ${why}, ${RETRIES + 1} times`);
        await sleep(300 * 2 ** attempt);
      };
      let res;
      try {
        res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
      } catch (e) {
        await retry(e instanceof Error ? e.message : String(e));
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        await retry(`HTTP ${res.status}`);
        continue;
      }
      if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
      const body = await res.json();
      if (body.error) {
        const message = String(body.error.message ?? body.error.code);
        if (RATE_LIMIT.test(message) || body.error.code === -32005 || body.error.code === -32016) {
          await retry(message);
          continue;
        }
        throw new RpcError(method, body.error.code, message);
      }
      return body.result;
    }
  };
}

const word = (data, i) => `0x${data.slice(2 + 64 * i, 2 + 64 * (i + 1))}`;

/** A Brief log as the page's reader keeps it (web/lib/chain/inbox.ts), or null for a log it would drop. */
export function decodeBrief(log, inbox) {
  if (log.blockNumber == null || log.transactionHash == null || log.logIndex == null) return null;
  if (String(log.address).toLowerCase() !== inbox) return null;
  const topics = log.topics ?? [];
  if (topics.length !== 3 || String(topics[0]).toLowerCase() !== BRIEF_TOPIC) return null;
  // The text: one ABI-encoded string, its offset, its length and its bytes padded to 32.
  const data = String(log.data);
  const size = (data.length - 2) / 2;
  if (!/^0x([0-9a-fA-F]{2})*$/.test(data) || size < 64 || BigInt(word(data, 0)) !== 32n) return null;
  const length = BigInt(word(data, 1));
  if (64n + ((length + 31n) / 32n) * 32n > BigInt(size)) return null;
  const id = BigInt(topics[1]);
  if (id > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return {
    id: Number(id),
    from: `0x${String(topics[2]).slice(-40)}`.toLowerCase(),
    txHash: String(log.transactionHash).toLowerCase(),
    logIndex: Number(log.logIndex),
  };
}

/** The rule's test for one UID, as web/app/(site)/proof/verified.ts countsAsVerified. */
export function countsAsVerified(att, uid, wallet, now) {
  if (uid === ZERO32) return false;
  if (att.uid !== uid || att.schema !== VERIFIED_ACCOUNT_SCHEMA || att.recipient !== wallet.toLowerCase()) return false;
  if (att.revocationTime !== 0n) return false;
  return att.expirationTime === 0n || att.expirationTime > now;
}

/** EAS's getAttestation answer: an offset, then the Attestation struct, whose fields are read by position. */
function decodeAttestation(data) {
  const at = Number(BigInt(word(data, 0)) / 32n);
  const field = (i) => word(data, at + i).toLowerCase();
  return {
    uid: field(0),
    schema: field(1),
    expirationTime: BigInt(field(3)),
    revocationTime: BigInt(field(4)),
    recipient: `0x${field(6).slice(-40)}`,
  };
}

/**
 * Each wallet's counting Verified Account UID, or null; every read is at `blockTag`, judged at `now`. The wallets are
 * read READ_WORKERS at a time (team.ts), as the page reads them all at once.
 */
export async function verifiedAccounts(call, list, blockTag, now) {
  const { mapLimit, READ_WORKERS } = await import(TEAM_MODULE.href);
  const uids = await mapLimit(list, READ_WORKERS, async (w) => {
    const data = `${GET_ATTESTATION_UID}${w.slice(2).padStart(64, "0")}${VERIFIED_ACCOUNT_SCHEMA.slice(2)}`;
    return word(await call("eth_call", [{ to: COINBASE_INDEXER, data }, blockTag]), 0).toLowerCase();
  });
  const held = await mapLimit([...list.entries()], READ_WORKERS, async ([i, w]) => {
    const uid = uids[i];
    if (uid === ZERO32) return null;
    const att = decodeAttestation(await call("eth_call", [{ to: EAS, data: `${GET_ATTESTATION}${uid.slice(2)}` }, blockTag]));
    return countsAsVerified(att, uid, w, now) ? uid : null;
  });
  return new Map(list.map((w, i) => [w, held[i]]));
}

/**
 * The transactions `wallet` sent by `head` that `known` does not give, in nonce order, and how many it sent. `known`
 * holds sends already found, each with its nonce and block (team.ts loggedSends). For every other nonce, the first
 * block whose nonce is past it is found by bisection between the known sends around it, then the wallet's transaction
 * in that block. Every read but the last block's needs an RPC that answers for past blocks.
 */
export async function sentTransactions(call, wallet, head, known = []) {
  const nonceAt = async (block) => BigInt(await call("eth_getTransactionCount", [wallet, hex(block)]));
  const n = await nonceAt(head);
  const at = new Map(known.map((k) => [k.nonce, k.block]));
  const out = [];
  let lo = 0n;
  for (let k = 0n; k < n; k++) {
    // Nonce k is sent in or after the block of nonce k - 1, and before the block of any later nonce found.
    if (at.has(k)) {
      lo = at.get(k);
      continue;
    }
    let hi = head;
    for (let j = k + 1n; j < n; j++) {
      if (at.has(j)) {
        hi = at.get(j);
        break;
      }
    }
    while (lo < hi) {
      const mid = (lo + hi) / 2n;
      if ((await nonceAt(mid)) > k) hi = mid;
      else lo = mid + 1n;
    }
    const block = await call("eth_getBlockByNumber", [hex(lo), true]);
    const tx = (block?.transactions ?? []).find((t) => typeof t === "object" && String(t.from).toLowerCase() === wallet && BigInt(t.nonce) === k);
    if (!tx) throw new Error(`block ${lo} has no transaction ${k} of ${wallet}`);
    out.push(String(tx.hash).toLowerCase());
  }
  return { sent: n, txs: out };
}

/**
 * Every Brief of the recorded inbox to `head`, in id order, each read once, from the inbox's deploy block on, with the
 * team trace's own scan (team.ts logsIn: windows of 50,000 blocks, halved on a range error, LOG_WORKERS at a time). Any
 * window that cannot be read stops the recount, so the scan it gives the team trace is complete.
 */
async function inboxBriefs(call, record, head) {
  let from = SCAN_FLOOR_BLOCK;
  if (record.deployTx) {
    const receipt = await call("eth_getTransactionReceipt", [record.deployTx]);
    if (receipt?.blockNumber) from = BigInt(receipt.blockNumber);
  }
  const { logsIn } = await import(TEAM_MODULE.href);
  const byKey = new Map();
  for (const log of await logsIn(call, { address: record.inbox, topics: [BRIEF_TOPIC] }, from, head)) {
    const b = decodeBrief(log, record.inbox);
    if (b) byKey.set(`${b.txHash}:${b.logIndex}`, b);
  }
  return { from, briefs: [...byKey.values()].sort((a, b) => a.id - b.id), complete: true };
}

// ---------------------------------------------------------------------------------------------------------------

async function list(root, file, name) {
  const mod = await import(pathToFileURL(join(root, file)).href);
  if (!(name in mod)) throw new Error(`${file} exports no ${name}`);
  return mod[name];
}

const plural = (n, one, many) => `${formatCount(n)} ${n === 1 ? one : many}`;

/** Runs the recount and returns the exit code: 0 printed, 1 failed, 2 a usage error. */
export async function main(argv, out = process.stdout, err = process.stderr) {
  let args;
  try {
    args = parseArgs({
      args: argv,
      options: {
        rpc: { type: "string" },
        "logs-rpc": { type: "string" },
        "to-block": { type: "string" },
        root: { type: "string" },
        sends: { type: "string" },
        snapshot: { type: "boolean" },
        help: { type: "boolean" },
      },
      strict: true,
    }).values;
  } catch (e) {
    err.write(`${e instanceof Error ? e.message : String(e)}\n\n${USAGE}`);
    return 2;
  }
  if (args.help) {
    out.write(USAGE);
    return 0;
  }
  const say = (line) => out.write(`${line}\n`);
  try {
    if (!process.features.typescript) throw new Error("this Node.js cannot read the TypeScript lists in web/content/: run it with Node.js 24");
    // The page prints the block with thousands separators; digits with commas or underscores are taken as it prints it.
    const toBlock = args["to-block"]?.replace(/[,_]/g, "");
    if (toBlock !== undefined && !/^\d+$/.test(toBlock)) throw new Error(`--to-block ${args["to-block"]} is not a block number`);
    const url = args.rpc ?? DEFAULT_RPC;
    const state = rpcClient(url);
    const chainId = Number(BigInt(await state("eth_chainId", [])));
    if (chainId !== BASE_CHAIN_ID) throw new Error(`the RPC ${url} is on chain id ${chainId}, not Base mainnet (${BASE_CHAIN_ID})`);
    const latest = BigInt(await state("eth_blockNumber", []));
    const head = toBlock === undefined ? latest : BigInt(toBlock);
    if (head > latest) throw new Error(`--to-block ${toBlock} is past the head block, ${latest}`);
    // eth_getLogs goes to --logs-rpc when it is given, as the page reads logs from one RPC and may read the rest from
    // another; it must be on Base and have reached the block counted to, or logs near it would be missing.
    const logsUrl = args["logs-rpc"] ?? url;
    let call = state;
    if (logsUrl !== url) {
      const logs = rpcClient(logsUrl);
      const logsChain = Number(BigInt(await logs("eth_chainId", [])));
      if (logsChain !== BASE_CHAIN_ID) throw new Error(`the RPC ${logsUrl} is on chain id ${logsChain}, not Base mainnet (${BASE_CHAIN_ID})`);
      const logsHead = BigInt(await logs("eth_blockNumber", []));
      if (logsHead < head) throw new Error(`the RPC ${logsUrl} is at block ${logsHead}, before block ${head}, the block counted to`);
      call = (method, params) => (method === "eth_getLogs" ? logs : state)(method, params);
    }
    const source = logsUrl === url ? url : `${url}, with eth_getLogs from ${logsUrl}`;

    const root = args.root ? resolve(args.root) : resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const rows = parseDeployments(readFileSync(join(root, DEPLOYMENTS_FILE), "utf8"));
    const record = inboxRecord(rows);
    const deployments = rows.filter((r) => r.network === "Base mainnet").map(({ contract, address, tx }) => ({ contract, address, tx }));

    if (args.sends !== undefined) {
      if (!FULL_ADDRESS.test(args.sends)) throw new Error(`--sends ${args.sends} is not 0x and 40 hex digits`);
      const wallet = args.sends.toLowerCase();
      // The sends the trace reads from the vault's logs and the wallet's briefs, by the same code as the trace.
      const { loggedSends } = await import(TEAM_MODULE.href);
      const briefScan = record ? await inboxBriefs(call, record, head) : undefined;
      const known = await loggedSends(call, { deployments, briefScan }, wallet, head);
      const { sent, txs } = await sentTransactions(call, wallet, head, known);
      say(`// ${plural(Number(sent), "transaction", "transactions")} sent by block ${head.toLocaleString("en-US")}, read from ${source}.`);
      if (txs.length === 0) {
        say(`// ${formatCount(known.length)} left a vault or MaatInbox log the team trace reads, so the wallet needs no entry in web/content/proof-sends.ts.`);
      } else {
        say(`// ${formatCount(known.length)} left a vault or MaatInbox log the team trace reads; the other ${formatCount(txs.length)} go in web/content/proof-sends.ts, in nonce order:`);
        say(`  { wallet: "${wallet}", txs: [${txs.map((h) => `"${h}"`).join(", ")}] },`);
      }
      return 0;
    }

    const lists = {
      team: await list(root, "web/content/proof-team.ts", "PROOF_TEAM"),
      sends: await list(root, "web/content/proof-sends.ts", "PROOF_SENDS"),
      stops: await list(root, "web/content/proof-stops.ts", "PROOF_STOPS"),
      hidden: await list(root, "web/content/ask-hidden.ts", "HIDDEN_BRIEFS"),
      bounty: await list(root, "web/content/proof-bounty.ts", "PROOF_BOUNTY"),
    };
    countBriefs([], lists);
    const { DECISION_NOTE, TEAM_SET_NOTE, snapshotSeed, teamLines, traceTeam } = await import(TEAM_MODULE.href);
    // --snapshot: the committed file as a seed of the vault's logs, which the trace checks log by log against Base.
    const vaultRow = deployments.find((r) => r.contract === "MandateVault" && r.address.trim() !== "");
    let vaultSeed = null;
    let unread = null;
    if (args.snapshot && vaultRow) {
      let raw;
      try {
        raw = JSON.parse(readFileSync(join(root, SNAPSHOT_FILE), "utf8"));
      } catch {
        unread = "it could not be read as JSON";
      }
      if (unread === null) {
        vaultSeed = snapshotSeed(raw, vaultRow.address.trim());
        if (!vaultSeed) unread = `it is not a decisions snapshot of MandateVault ${vaultRow.address.trim().toLowerCase()} on Base mainnet`;
      }
    }

    say(`Maat /proof recount, from Base mainnet alone, by the counting rule of ${RULE}.`);
    say(`RPC ${source}: chain id ${chainId}, head block ${latest.toLocaleString("en-US")}.`);
    say(
      `Lists: ${plural(lists.team.length, "team wallet", "team wallets")} (web/content/proof-team.ts), ${plural(lists.sends.length, "wallet's sent transactions", "wallets' sent transactions")} (web/content/proof-sends.ts), ${plural(lists.stops.length, "hop stop", "hop stops")} (web/content/proof-stops.ts), ${plural(lists.hidden.length, "hidden id", "hidden ids")} (web/content/ask-hidden.ts), ${plural(lists.bounty.length, "bounty claimant", "bounty claimants")} (web/content/proof-bounty.ts).`,
    );
    if (!record) {
      say("MaatInbox is not recorded in deployments/README.md yet, so there is no brief to count. Counting starts when the inbox is recorded.");
      say(TEAM_SET_NOTE);
      say(DECISION_NOTE);
      for (const line of reportLines(countBriefs([], lists), new Map(), "not-deployed")) say(line);
      return 0;
    }

    // As on the page, the trace reads the vault's logs while the Brief logs are read, and takes a team wallet's briefs
    // as its sends from them.
    const scan = inboxBriefs(call, record, head);
    const [{ from, briefs }, trace] = await Promise.all([
      scan,
      traceTeam(call, { team: lists.team, sends: lists.sends, stops: lists.stops, deployments, briefScan: scan, vaultSeed }, head),
    ]);
    const count = countBriefs(briefs, { ...lists, team: trace.members });
    const complete = trace.gaps.length === 0;
    let verified = new Map();
    if (complete && count.outsideWallets.length > 0) {
      const block = await call("eth_getBlockByNumber", [hex(head), false]);
      if (!block?.timestamp) throw new Error(`block ${head} has no timestamp`);
      verified = await verifiedAccounts(
        call,
        count.outsideWallets.map((w) => w.address),
        hex(head),
        BigInt(block.timestamp),
      );
    }
    say(
      `MaatInbox ${record.inbox}: Brief logs from block ${from.toLocaleString("en-US")} to block ${head.toLocaleString("en-US")}, team set and Verified Accounts read at block ${head.toLocaleString("en-US")}.`,
    );
    if (args.snapshot && trace.seed) {
      say(
        `Vault logs to block ${trace.seed.to.toLocaleString("en-US")} from ${SNAPSHOT_FILE}, the snapshot of block ${trace.seed.anchor.toLocaleString("en-US")}: the RPC gives that block the same hash, and each log's transaction receipt holds it. The vault's other blocks, to block ${head.toLocaleString("en-US")}, are read from the RPC.`,
      );
    } else if (args.snapshot && vaultRow) {
      say(`${SNAPSHOT_FILE} was not used (${unread ?? trace.seedRejected}), so the vault's logs are read from its deploy block.`);
    }
    say(TEAM_SET_NOTE);
    say(DECISION_NOTE);
    for (const line of reportLines(count, verified, complete ? "counted" : "incomplete", teamLines(trace))) say(line);
    if (!complete) {
      err.write(`recount: the count is incomplete: ${trace.gaps.join(" ")}\n`);
      return 1;
    }
    return 0;
  } catch (e) {
    err.write(`recount: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}

const invoked = process.argv[1] ? resolve(process.argv[1]) : "";
const self = fileURLToPath(import.meta.url);
if (process.platform === "win32" ? invoked.toLowerCase() === self.toLowerCase() : invoked === self) {
  process.exitCode = await main(process.argv.slice(2));
}
