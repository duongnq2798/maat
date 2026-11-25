// Re-derives what a vault Decision commits to from its transaction input, and checks the agent's journal chain.
//   npm run verify -- --input test/fixtures/calldata-v1.hex --journal test/fixtures/journal-v1.jsonl   (from agent/)
//   npm run verify -- --input 0x4ad3993f... [--tx 0xHash] [--journal journal.jsonl ...] [--rationale "text"]
//   npm run verify -- --tx 0xHash --rpc https://mainnet.base.org [--journal ...]
// --input is the tx input (`cast tx <hash> input`) as hex, or a file holding it. With --rpc, --tx reads the input,
// the receipt's Decision for the intent and the vault's owner() over that RPC; without it, --tx only finds the
// journal's sent or reconcile row for the tx. --journal takes the published day files in order, or the agent's local
// journal.jsonl, and may be given more than once. --rationale is the text a Decision with no blob commits to.
// It prints one line per check (calldata, blob, hash, decision, journal, anchor; docs/superpowers/specs/
// 2026-11-25-maat-v1-rationale-blob-design.md §1 to §3.6) and the verdict. Exit code 0: PASS. 1: FAIL. 2: PENDING (the
// journal has no row for the tx yet). 3: bad arguments, an unreadable file or a failed RPC read. It sends nothing,
// holds no key and reads no settings file; the RPC URL is never printed.
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createPublicClient, decodeFunctionData, getAddress, http, isHex, parseEventLogs, slice, type Address, type Hex, type Log } from "viem";
import { base } from "viem/chains";
import { mandateVaultAbi } from "../src/abi/index.js";
import { EXECUTE_BYTES } from "../src/rationale/calldata.js";
import { verifyDecision, type VerifyRequest } from "../src/rationale/verify.js";
import { oneLine } from "../src/redact.js";
import type { OnchainIntent } from "../src/types.js";

/** The three reads --rpc makes. */
export interface VerifyClient {
  getTransaction(a: { hash: Hex }): Promise<{ input: Hex; from: Address; to: Address | null }>;
  getTransactionReceipt(a: { hash: Hex }): Promise<{ logs: readonly Pick<Log, "address" | "topics" | "data">[] }>;
  readContract(a: { address: Address; abi: typeof mandateVaultAbi; functionName: "owner" }): Promise<unknown>;
}

const USAGE = "give --input <hex or file>, or --tx <hash> with --rpc <url>";

class Usage extends Error {}

const rpcClient = (url: string): VerifyClient => createPublicClient({ chain: base, transport: http(url) }) as unknown as VerifyClient;

async function readInput(arg: string): Promise<Hex> {
  let text = arg;
  if (!arg.startsWith("0x")) {
    try {
      text = (await readFile(arg, "utf8")).trim();
    } catch (e) {
      throw new Usage(`cannot read --input ${arg}: ${oneLine(e)}`);
    }
  }
  if (!isHex(text, { strict: true }) || text.length % 2 !== 0) throw new Usage(`--input is not hex bytes`);
  return text;
}

/** The Decision rationaleHash the receipt holds for `id`, from the vault the tx called; null when it has none. */
function decisionHashIn(logs: readonly Pick<Log, "address" | "topics" | "data">[], vault: Address, id: Hex): Hex | null {
  const parsed = parseEventLogs({ abi: mandateVaultAbi, eventName: "Decision", logs: logs as Log[], strict: true });
  const l = parsed.find((x) => getAddress(x.address) === getAddress(vault) && x.args.intentId.toLowerCase() === id.toLowerCase());
  return l ? l.args.rationaleHash : null;
}

export async function main(
  argv: readonly string[],
  o: { out?: (s: string) => void; err?: (s: string) => void; client?: (url: string) => VerifyClient } = {},
): Promise<number> {
  const out = o.out ?? console.log;
  const err = o.err ?? console.error;
  try {
    let values: { input?: string; tx?: string; rpc?: string; journal?: string[]; rationale?: string };
    try {
      ({ values } = parseArgs({
        args: [...argv],
        options: { input: { type: "string" }, tx: { type: "string" }, rpc: { type: "string" }, journal: { type: "string", multiple: true }, rationale: { type: "string" } },
      }));
    } catch (e) {
      throw new Usage(oneLine(e));
    }
    if (values.tx !== undefined && !isHex(values.tx, { strict: true })) throw new Usage("--tx is not a hash");
    if (values.tx !== undefined && values.tx.length !== 66) throw new Usage("--tx is not a 32-byte hash");
    const txHash = values.tx as Hex | undefined;
    const req: Partial<VerifyRequest> = {};
    if (values.rpc !== undefined) {
      if (txHash === undefined || values.input !== undefined) throw new Usage(USAGE);
      const client = (o.client ?? rpcClient)(values.rpc);
      try {
        const tx = await client.getTransaction({ hash: txHash });
        if (tx.to === null) throw new Usage(`tx ${txHash} creates a contract; it calls no vault`);
        req.input = tx.input;
        req.from = tx.from;
        const receipt = await client.getTransactionReceipt({ hash: txHash });
        if (req.input.length >= 2 + 2 * EXECUTE_BYTES) {
          try {
            const id = (decodeFunctionData({ abi: mandateVaultAbi, data: slice(req.input, 0, EXECUTE_BYTES) }).args![0] as OnchainIntent).id;
            req.decisionHash = decisionHashIn(receipt.logs, tx.to, id);
          } catch {
            // Not an execute call: verifyDecision says so from the input.
          }
        }
        req.owner = getAddress((await client.readContract({ address: tx.to, abi: mandateVaultAbi, functionName: "owner" })) as string);
      } catch (e) {
        if (e instanceof Usage) throw e;
        throw new Usage(`the RPC read failed: ${oneLine(e)}`);
      }
    } else {
      if (values.input === undefined) throw new Usage(USAGE);
      req.input = await readInput(values.input);
    }
    if (values.journal !== undefined) {
      req.journal = await Promise.all(
        values.journal.map(async (path) => {
          try {
            return { name: basename(path), text: await readFile(path, "utf8") };
          } catch (e) {
            throw new Usage(`cannot read --journal ${path}: ${oneLine(e)}`);
          }
        }),
      );
    }
    const r = verifyDecision({
      ...req,
      input: req.input,
      ...(txHash ? { txHash } : {}),
      ...(values.rationale !== undefined ? { rationale: values.rationale } : {}),
    });
    out(r.intentId === null ? "not an execute call" : `intent ${r.intentId}, rationaleHash ${r.rationaleHash}`);
    if (r.label) out(`sender: ${r.label}`);
    for (const c of r.checks) out(`${c.status.toUpperCase()} ${c.name.padEnd(10)}${c.detail}`);
    out(r.verdict);
    return r.verdict === "PASS" ? 0 : r.verdict === "PENDING" ? 2 : 1;
  } catch (e) {
    if (!(e instanceof Usage)) throw e;
    err(`verify-decision: ${e.message}`);
    return 3;
  }
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) process.exitCode = await main(process.argv.slice(2));
