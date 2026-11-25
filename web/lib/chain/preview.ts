import { getAddress, keccak256, parseUnits, toBytes, zeroAddress, zeroHash, type Address, type Hash } from "viem";
import addresses from "@/content/generated/base-addresses.json";
import { ACTIONS, type ActionName } from "@/content/decisions";
import { FACTS } from "@/content/facts";
import { REASONS, type ReasonCode } from "@/content/reasons";
import { b20Abi, vaultAbi } from "./abi";
import type { LedgerClient } from "./load";

// A free previewIntent of one concrete intent against the live vault: an eth_call, so nothing is signed or sent.

/** The intent id every preview uses. previewIntent does not check usedIntent, so any id previews the same. */
export const PREVIEW_ID: Hash = keccak256(toBytes("maat:ask:preview"));

const USDC = getAddress(addresses.find((a) => a.name === "USDC")!.value);

export interface PreviewToken {
  symbol: string;
  address: Address;
}

/** The basket in listing order, then USDC: the site writes NVDAC as NVDAc (lib/chain/tokens.ts). */
export function previewTokens(): PreviewToken[] {
  const basket = FACTS.basket.value.map((symbol) => {
    const row = addresses.find((a) => a.name === symbol.toUpperCase());
    if (!row) throw new Error(`content/generated/base-addresses.json has no ${symbol.toUpperCase()}`);
    return { symbol, address: getAddress(row.value) };
  });
  return [...basket, { symbol: "USDC", address: USDC }];
}

/** BUY, BORROW, REPAY and PAY_EXPENSE carry USDC; the rest carry raw stock units (contracts/src/Types.sol, Intent). */
const USDC_ACTIONS: ReadonlySet<ActionName> = new Set(["BUY", "BORROW", "REPAY", "PAY_EXPENSE"]);

export function amountUnit(action: ActionName): "usdc" | "token" {
  return USDC_ACTIONS.has(action) ? "usdc" : "token";
}

const DECIMAL = /^\d+(?:\.\d+)?$/;

/** "12.5" as units of a token with `decimals`, or null for anything that is not a plain decimal that fits. */
export function parseAmount(text: string, decimals: number): bigint | null {
  const t = text.trim();
  if (!DECIMAL.test(t)) return null;
  if ((t.split(".")[1] ?? "").length > decimals) return null;
  return parseUnits(t, decimals);
}

export interface PreviewRequest {
  action: ActionName;
  token: Address;
  amount: bigint;
}

/** The Intent struct previewIntent takes, with no minOut, no payee and a zero rationale hash. */
export function previewIntentArgs(req: PreviewRequest) {
  return { id: PREVIEW_ID, action: ACTIONS.indexOf(req.action), token: req.token, amount: req.amount, minOut: 0n, payee: zeroAddress, rationaleHash: zeroHash };
}

export interface PreviewResult {
  reason: ReasonCode;
  /** The block the vault answered at. */
  blockNumber: bigint;
}

/** Asks the vault, at the head block, what it would answer to `req`. RPC errors propagate as they are. */
export async function previewIntent(client: LedgerClient, vault: Address, req: PreviewRequest): Promise<PreviewResult> {
  const blockNumber = await client.getBlockNumber();
  const raw = await client.readContract({ address: vault, abi: vaultAbi, functionName: "previewIntent", args: [previewIntentArgs(req)], blockNumber });
  const n = Number(raw);
  const reason: ReasonCode | undefined = n === 0 ? "OK" : REASONS[n - 1];
  if (!Number.isInteger(n) || reason === undefined) throw new Error(`The vault answered ${String(raw)}, and ${String(raw)} is not a Reason in contracts/src/Types.sol.`);
  return { reason, blockNumber };
}

/** USDC has 6 decimals; any other token is asked for its decimals(). */
export async function tokenDecimals(client: LedgerClient, token: Address): Promise<number> {
  if (token.toLowerCase() === USDC.toLowerCase()) return 6;
  return Number(await client.readContract({ address: token, abi: b20Abi, functionName: "decimals" }));
}
