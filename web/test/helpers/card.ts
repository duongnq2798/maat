import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  getAddress,
  keccak256,
  toBytes,
  toHex,
  zeroAddress,
  type AbiEvent,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { ACTIONS, type ActionName } from "@/content/decisions";
import { REASONS, type ReasonCode } from "@/content/reasons";
import { vaultAbi } from "@/lib/chain/abi";
import type { BriefRead, CardKind, CardRead } from "@/lib/card/model";
import { TRANSFER_TOPIC } from "@/lib/card/model";
import { erc8021Suffix } from "./maat-v1";

// Builders for Weighing card tests. The vault, its owner and the two 24 Nov Decisions are Base mainnet's (recorded in
// test/fixtures/weighing-card-1.json and -2.json); every other transaction here is made up for a test.

export const VAULT: Address = "0x3F956072d18ddD20d5eFb74e9CCabf8Deade699b";
export const OWNER: Address = "0x3c3a66f713DAE7e4A03Bbd81dB79FF65F42C1D6a";
/** A made-up executor that is not the owner, as the agent's wallet will be. */
export const AGENT: Address = "0x00000000000000000000000000000000000a6E17";
export const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const NVDAC: Address = "0xb20000000000000000000078ee7ce2fE4908108C";
/** A made-up payee that is not the owner. */
export const OTHER_PAYEE: Address = "0x00000000000000000000000000000000000Fee01";
export const TEST_TX: Hash = `0x${"ab".repeat(32)}`;
/** Tue 24 Nov 2026 16:59:02 UTC, 11:59 ET: in session. */
export const IN_SESSION_TS = 1_795_539_542;

const DECISION = vaultAbi.find((x) => x.type === "event" && x.name === "Decision") as AbiEvent;
const reasonId = (r: ReasonCode) => (r === "OK" ? 0 : REASONS.indexOf(r) + 1);

/** The vault's Decision log, encoded with its own ABI. */
export function decisionLog(o: { action: ActionName; token: Address; amount: bigint; reason: ReasonCode; rationaleHash: Hash; logIndex?: number }) {
  const args = {
    intentId: keccak256(toBytes(`card-test-${o.action}-${o.amount}`)),
    action: ACTIONS.indexOf(o.action),
    token: o.token,
    amount: o.amount,
    allowed: o.reason === "OK",
    reason: reasonId(o.reason),
    rationaleHash: o.rationaleHash,
  };
  const topics = encodeEventTopics({ abi: [DECISION], eventName: "Decision", args } as never) as Hex[];
  const plain = DECISION.inputs.filter((i) => !i.indexed);
  const data = encodeAbiParameters(plain, plain.map((i) => (args as Record<string, unknown>)[i.name!]));
  return { address: VAULT, topics, data, logIndex: o.logIndex ?? 7 };
}

/** A USDC Transfer log out of the vault. */
export function usdcTransfer(to: Address, amount: bigint, logIndex = 6) {
  const word = (a: Address) => `0x${a.slice(2).toLowerCase().padStart(64, "0")}` as Hex;
  return { address: USDC, topics: [TRANSFER_TOPIC, word(VAULT), word(to)], data: toHex(amount, { size: 32 }), logIndex };
}

/** `execute(intent)` ‖ blob ‖ the 24 Nov Decisions' ERC-8021 suffix. */
export function executeInput(o: { action: ActionName; token: Address; amount: bigint; payee?: Address; rationaleHash: Hash; blob?: string | null }): Hex {
  const call = encodeFunctionData({
    abi: vaultAbi,
    functionName: "execute",
    args: [
      {
        id: keccak256(toBytes(`card-test-${o.action}-${o.amount}`)),
        action: ACTIONS.indexOf(o.action),
        token: o.token,
        amount: o.amount,
        minOut: 0n,
        payee: o.payee ?? zeroAddress,
        rationaleHash: o.rationaleHash,
      },
    ],
  });
  const blob = o.blob ? toHex(o.blob).slice(2) : "";
  return `${call}${blob}${erc8021Suffix(["bc_w7i5vjdv"]).slice(2)}` as Hex;
}

export interface CardCase {
  kind?: CardKind;
  ordinal?: number | null;
  action?: ActionName;
  token?: Address;
  amount?: bigint;
  reason?: ReasonCode;
  from?: Address;
  to?: Address | null;
  owner?: Address | null;
  /** The maat:v1 blob in the calldata; null for none. */
  blob?: string | null;
  /** The Decision's rationaleHash: keccak256 of the blob unless given. */
  rationaleHash?: Hash;
  payee?: Address;
  /** Extra receipt logs, as a paid bill's USDC Transfer. */
  extraLogs?: CardRead["logs"];
  timestamp?: number;
  briefs?: BriefRead[];
}

/** A made-up Decision transaction as the card reads it: a BUY of $5 of NVDAc allowed in session unless told otherwise. */
export function cardCase(c: CardCase = {}): CardRead {
  const action = c.action ?? "BUY";
  const token = c.token ?? (action === "PAY_EXPENSE" ? USDC : NVDAC);
  const amount = c.amount ?? 5_000_000n;
  const blob = c.blob === undefined ? null : c.blob;
  const rationaleHash = c.rationaleHash ?? (blob ? keccak256(toBytes(blob)) : keccak256(toBytes("card test, no blob")));
  const kind = c.kind ?? "mainnet";
  return {
    kind,
    vault: VAULT,
    owner: c.owner === undefined ? OWNER : c.owner,
    usdc: USDC,
    txHash: TEST_TX,
    blockNumber: 62_500_000n,
    timestamp: c.timestamp ?? IN_SESSION_TS,
    logs: [...(c.extraLogs ?? []), decisionLog({ action, token, amount, reason: c.reason ?? "OK", rationaleHash })],
    tx: { from: getAddress(c.from ?? OWNER), to: c.to === undefined ? VAULT : c.to, input: executeInput({ action, token, amount, payee: c.payee, rationaleHash, blob }) },
    ordinal: c.ordinal === undefined ? (kind === "mainnet" ? 3 : null) : c.ordinal,
    decimals: {},
    briefs: c.briefs ?? [],
  };
}

/** A maat:v1 blob in canonical form (keys sorted, no spaces) with made-up b, c, j, r and s, and `fields` on top. */
export function v1Blob(fields: { t: string; m?: string; k?: "probe" | "bill"; q?: number[] }): string {
  const all: Record<string, unknown> = { b: 62_500_000, c: "0123456789abcdef0123456789abcdef01234567", j: `0x${"0".repeat(64)}`, r: "run-card-test", s: [], ...fields };
  return `maat:v1:${JSON.stringify(Object.fromEntries(Object.keys(all).sort().map((k) => [k, all[k]])))}`;
}

/** A recorded fixture file, as JSON. */
export const fixtureJson = (name: string): unknown => JSON.parse(readFileSync(join(process.cwd(), "test/fixtures", name), "utf8"));
