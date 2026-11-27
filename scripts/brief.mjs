#!/usr/bin/env node
// Prepares a brief to Maat's agent for your own wallet to sign, and reads one back once it is sent. It never asks
// for, reads or holds a key: it prints the transaction (to, value 0, data) and a `cast send` line that signs with
// your own Foundry keystore or hardware wallet. The data is brief(text) for MaatInbox on Base mainnet, then the
// ERC-8021 suffix of the Builder Code on the vault's first Decision, the code /ask adds, read from the chain each
// run (web/lib/wallet/builder-code.ts reads it the same way). A brief is public and stays onchain for good.
//
//   node scripts/brief.mjs "<text>" [--from <your address>] [--rpc <url>] [--no-code]
//   node scripts/brief.mjs --status <tx hash> [--rpc <url>]
//
// No dependency: Node's built-ins and fetch only, so this one file can be copied out of the repository and run with
// Node.js 18 or later. web/test/brief-script.test.ts checks its addresses against deployments/README.md and its
// calldata against the site's own encoder.

import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

/** The keyless RPC the script reads with (scripts/recount.mjs reads the same), and the one the cast line sends to. */
export const DEFAULT_RPC = "https://base-rpc.publicnode.com";
export const SEND_RPC = "https://mainnet.base.org";
export const BASE_CHAIN_ID = 8453;
/** MaatInbox and MandateVault on Base mainnet, and the vault's deploy block, as deployments/README.md records them. */
export const INBOX = "0x6a3D27f2d8a5BC991Bf4511aAA698A5B2DCDf12a";
export const VAULT = "0x3F956072d18ddD20d5eFb74e9CCabf8Deade699b";
export const VAULT_DEPLOY_BLOCK = 61_698_517n;
/** MaatInbox.MAX_BYTES. */
export const MAX_BYTES = 280;
// Node has no keccak, so the selector and topics are written here; the test recomputes each with viem.
/** The selector of brief(string). */
export const BRIEF_SELECTOR = "0x96a440f9";
/** keccak256("Brief(uint256,address,string)"). */
export const BRIEF_TOPIC = "0x6990c09d9f6bf654815df468a70bea4545776ea2b7316f7340b23b30e1d45936";
/** keccak256("Decision(bytes32,uint8,address,uint256,bool,uint8,bytes32)"). */
export const DECISION_TOPIC = "0x31e6f801fe8c4e61fff662a75a05831c8f1341359c56a18463b2a33bfa2df322";
/** The selector of owner(). */
const OWNER_SELECTOR = "0x8da5cb5b";
/** Blocks per eth_getLogs while looking for the vault's first Decision. */
const LOG_WINDOW = 10_000n;
/** The 16 bytes that end an ERC-8021 suffix, and the Builder Codes registry's rule for a code. */
const MARKER = "8021".repeat(8);
export const BUILDER_CODE_RE = /^[a-z0-9_]{1,32}$/;
/** The code points the agent's prompt and /ask show as U+FFFD (web/lib/chain/inbox.ts UNSAFE). */
const UNSAFE = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;

const USAGE = `Prepares a brief to Maat's agent for your own wallet to sign. It never asks for a key.

  node scripts/brief.mjs "<text>" [--from <your address>] [--rpc <url>] [--no-code]
  node scripts/brief.mjs --status <tx hash> [--rpc <url>]

  "<text>"        the brief: 1 to ${MAX_BYTES} bytes of UTF-8, public and onchain for good
  --from <addr>   the address you will send from: the brief is simulated from it first
  --rpc <url>     a Base mainnet JSON-RPC (default ${DEFAULT_RPC})
  --no-code       leave out the Builder Code suffix
  --status <tx>   read a sent brief back: its id, sender and text`;

const hex = (bytes) => Buffer.from(bytes).toString("hex");
const pad32 = (h) => h.padEnd(Math.ceil(h.length / 64) * 64, "0");
const word = (n) => n.toString(16).padStart(64, "0");

/** The UTF-8 bytes of a brief, the bytes the contract counts. */
export const briefBytes = (text) => new TextEncoder().encode(text);

/** The ERC-8021 schema-0 suffix of one code: its bytes, their count, schema id 0x00, the marker. */
export function erc8021Suffix(code) {
  if (!BUILDER_CODE_RE.test(code)) throw new Error(`"${code}" is not a Builder Code: 1 to 32 of a-z, 0-9 and _`);
  const bytes = hex(new TextEncoder().encode(code));
  return `${bytes}${(bytes.length / 2).toString(16).padStart(2, "0")}00${MARKER}`;
}

/** The first code of the ERC-8021 schema-0 suffix that ends `input`, or null (web/lib/chain/rationale.ts reads it so). */
export function suffixCode(input) {
  const d = input.replace(/^0x/, "").toLowerCase();
  if (d.length < 36 + 8 || !d.endsWith(MARKER) || d.slice(-34, -32) !== "00") return null;
  const n = parseInt(d.slice(-36, -34), 16);
  const start = d.length - 36 - n * 2;
  if (n === 0 || start < 8) return null;
  return Buffer.from(d.slice(start, d.length - 36), "hex").toString("latin1").split(",")[0] ?? null;
}

/** The transaction data of brief(text), then the suffix when there is one. Throws on a text the contract refuses. */
export function briefData(text, suffix = null) {
  const b = briefBytes(text);
  if (b.length === 0 || b.length > MAX_BYTES) throw new Error(`a brief is 1 to ${MAX_BYTES} bytes; this one is ${b.length}`);
  return `${BRIEF_SELECTOR}${word(32)}${word(b.length)}${pad32(hex(b))}${suffix ?? ""}`;
}

/** The Brief event in a receipt's logs, decoded, or null. */
export function briefFromLogs(logs) {
  const log = logs.find((l) => l.address.toLowerCase() === INBOX.toLowerCase() && l.topics[0]?.toLowerCase() === BRIEF_TOPIC);
  if (!log) return null;
  const d = log.data.slice(2);
  const len = Number(BigInt(`0x${d.slice(64, 128)}`));
  return {
    id: BigInt(log.topics[1]),
    from: `0x${log.topics[2].slice(26)}`,
    text: Buffer.from(d.slice(128, 128 + len * 2), "hex").toString("utf8"),
  };
}

/** One JSON-RPC call; a rate-limited one waits as Retry-After says (2 s by default) and tries again, 3 times at most. */
async function rpc(url, method, params) {
  let res;
  for (let tries = 0; ; tries++) {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    if (res.status !== 429 || tries === 3) break;
    const wait = Math.min(Number(res.headers.get("retry-after")) || 2, 30);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw Object.assign(new Error(`${method}: ${body.error.message}`), { data: body.error.data });
  return body.result;
}

/**
 * The Builder Code on the vault's first Decision, when the vault's owner sent it as a direct call: { code } or
 * { why }, where `why` finishes "No Builder Code: ...".
 */
export async function readBuilderCode(url) {
  try {
    const owner = `0x${(await rpc(url, "eth_call", [{ to: VAULT, data: OWNER_SELECTOR }, "latest"])).slice(26)}`.toLowerCase();
    const head = BigInt(await rpc(url, "eth_blockNumber", []));
    for (let lo = VAULT_DEPLOY_BLOCK; lo <= head; lo += LOG_WINDOW) {
      const hi = lo + LOG_WINDOW - 1n < head ? lo + LOG_WINDOW - 1n : head;
      const logs = await rpc(url, "eth_getLogs", [{ address: VAULT, topics: [DECISION_TOPIC], fromBlock: `0x${lo.toString(16)}`, toBlock: `0x${hi.toString(16)}` }]);
      if (logs.length === 0) continue;
      const tx = await rpc(url, "eth_getTransactionByHash", [logs[0].transactionHash]);
      if (tx.from.toLowerCase() !== owner) return { why: "the vault's first Decision was not sent by its owner" };
      if (tx.to?.toLowerCase() !== VAULT.toLowerCase()) return { why: "the vault's first Decision was not a direct call" };
      const code = suffixCode(tx.input);
      if (code === null) return { why: "the vault's first Decision carries no Builder Code" };
      if (!BUILDER_CODE_RE.test(code)) return { why: "the code on the vault's first Decision is not a valid Builder Code" };
      return { code };
    }
    return { why: "the vault has no Decision yet" };
  } catch (e) {
    return { why: `the chain could not be read (${e.message})` };
  }
}

async function checkChain(url) {
  const id = Number(BigInt(await rpc(url, "eth_chainId", [])));
  if (id !== BASE_CHAIN_ID) throw new Error(`${url} is chain ${id}, not Base mainnet (${BASE_CHAIN_ID})`);
}

async function prepare(text, opts) {
  const bytes = briefBytes(text).length;
  if (bytes === 0 || bytes > MAX_BYTES) {
    console.error(`A brief is 1 to ${MAX_BYTES} bytes of UTF-8; this one is ${bytes}.`);
    return 2;
  }
  await checkChain(opts.rpc);
  const unsafe = text.match(UNSAFE)?.length ?? 0;
  console.log(`Brief: ${bytes} of ${MAX_BYTES} bytes.`);
  if (unsafe > 0) console.log(`Note: ${unsafe} code point(s), such as line breaks or invisible marks, will show as U+FFFD to the agent and on /ask.`);

  let suffix = null;
  if (opts.noCode) console.log("Builder Code: left out (--no-code).");
  else {
    const r = await readBuilderCode(opts.rpc);
    if (r.code) {
      suffix = erc8021Suffix(r.code);
      console.log(`Builder Code: ${r.code}, read from the vault's first Decision; MaatInbox ignores it.`);
    } else console.log(`No Builder Code: ${r.why}. The brief goes without one.`);
  }
  const data = briefData(text, suffix);

  if (opts.from) {
    try {
      const id = BigInt(await rpc(opts.rpc, "eth_call", [{ from: opts.from, to: INBOX, data }, "latest"]));
      const gas = BigInt(await rpc(opts.rpc, "eth_estimateGas", [{ from: opts.from, to: INBOX, data }]));
      console.log(`Simulated from ${opts.from}: it would be brief #${id} now, about ${gas} gas.`);
    } catch (e) {
      console.error(`The simulation from ${opts.from} failed: ${e.message}. Nothing was sent.`);
      return 1;
    }
  }

  console.log(`
Send it from your own wallet on Base mainnet (chain ${BASE_CHAIN_ID}). It carries no ETH; you pay only gas.

  to     ${INBOX}  (MaatInbox)
  value  0
  data   0x${data.slice(2)}

With Foundry, signed by your own keystore (or --ledger):

  cast send ${INBOX} 0x${data.slice(2)} --rpc-url ${SEND_RPC} --account <your keystore>

Then read it back:

  node scripts/brief.mjs --status <tx hash>`);
  return 0;
}

async function status(txHash, opts) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    console.error(`"${txHash}" is not a transaction hash.`);
    return 2;
  }
  await checkChain(opts.rpc);
  const receipt = await rpc(opts.rpc, "eth_getTransactionReceipt", [txHash]);
  if (!receipt) {
    console.log(`${txHash} has no receipt yet: it is pending or unknown to ${opts.rpc}.`);
    return 1;
  }
  if (receipt.status !== "0x1") {
    console.log(`${txHash} reverted in block ${BigInt(receipt.blockNumber)}: no brief was recorded.`);
    return 1;
  }
  const b = briefFromLogs(receipt.logs);
  if (!b) {
    console.log(`${txHash} holds no Brief log of MaatInbox ${INBOX}.`);
    return 1;
  }
  console.log(`Brief #${b.id} from ${b.from}, block ${BigInt(receipt.blockNumber)}:\n\n  ${b.text.replace(UNSAFE, "�")}\n
https://basescan.org/tx/${txHash}`);
  return 0;
}

export async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { from: { type: "string" }, rpc: { type: "string" }, "no-code": { type: "boolean" }, status: { type: "string" }, help: { type: "boolean", short: "h" } },
    });
  } catch (e) {
    console.error(`${e.message}\n\n${USAGE}`);
    return 2;
  }
  const { values: v, positionals } = parsed;
  if (v.help) {
    console.log(USAGE);
    return 0;
  }
  if (v.from !== undefined && !/^0x[0-9a-fA-F]{40}$/.test(v.from)) {
    console.error(`--from "${v.from}" is not an address.`);
    return 2;
  }
  const opts = { rpc: v.rpc ?? DEFAULT_RPC, from: v.from, noCode: v["no-code"] === true };
  try {
    if (v.status !== undefined) return positionals.length === 0 ? await status(v.status, opts) : (console.error(USAGE), 2);
    if (positionals.length !== 1) {
      console.error(USAGE);
      return 2;
    }
    return await prepare(positionals[0], opts);
  } catch (e) {
    console.error(e.message);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = await main(process.argv.slice(2));
