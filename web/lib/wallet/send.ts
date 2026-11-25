import { BaseError, createWalletClient, custom, getAddress, numberToHex, type Address, type Hash, type Hex } from "viem";
import { base } from "viem/chains";
import { BASE_CHAIN_ID } from "@/lib/chain/config";
import { checkBrief, inboxAbi } from "@/lib/chain/inbox";
import type { Eip1193Provider } from "./eip6963";

const BASE_HEX = numberToHex(BASE_CHAIN_ID);

/** A failure with a sentence the page shows as it is. */
export class WalletError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletError";
  }
}

const codeOf = (e: unknown): number | undefined => {
  for (let x: unknown = e, i = 0; x && typeof x === "object" && i < 5; x = (x as { cause?: unknown }).cause, i++) {
    const code = (x as { code?: unknown }).code;
    if (typeof code === "number") return code;
  }
  return undefined;
};

/** A short sentence for a wallet or viem error. */
export function walletErrorText(e: unknown): string {
  if (codeOf(e) === 4001) return "You declined the request in your wallet.";
  if (e instanceof BaseError) return e.shortMessage;
  return e instanceof Error ? e.message : String(e);
}

/** Asks the wallet to connect and returns its first account. */
export async function requestAccount(provider: Eip1193Provider): Promise<Address> {
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as unknown;
  const first = Array.isArray(accounts) ? accounts[0] : undefined;
  if (typeof first !== "string") throw new WalletError("The wallet gave no account.");
  return getAddress(first);
}

const isBase = async (provider: Eip1193Provider) => Number(await provider.request({ method: "eth_chainId" })) === BASE_CHAIN_ID;

/** Switches the wallet to Base mainnet, adding the chain first when the wallet does not know it (error 4902). */
export async function ensureBase(provider: Eip1193Provider): Promise<void> {
  if (await isBase(provider)) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BASE_HEX }] });
  } catch (e) {
    if (codeOf(e) !== 4902) throw e;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: BASE_HEX,
          chainName: base.name,
          nativeCurrency: base.nativeCurrency,
          rpcUrls: [...base.rpcUrls.default.http],
          blockExplorerUrls: [base.blockExplorers.default.url],
        },
      ],
    });
  }
  if (!(await isBase(provider))) throw new WalletError(`Your wallet is not on Base (chain id ${BASE_CHAIN_ID}). Switch it to Base and send again.`);
}

export interface BriefSend {
  provider: Eip1193Provider;
  account: Address;
  inbox: Address;
  text: string;
  /** The ERC-8021 suffix of the Builder Code, or null when it could not be read. */
  suffix: Hex | null;
}

function checked(text: string): void {
  const check = checkBrief(text);
  if (!check.ok) throw new WalletError(check.problem);
}

/**
 * An injected wallet: viem writeContract of brief(text), with the suffix as `dataSuffix`, so the transaction input is
 * brief(text) calldata followed by the suffix. The wallet must already be on Base (ensureBase); viem checks it again.
 */
export async function sendBriefInjected({ provider, account, inbox, text, suffix }: BriefSend): Promise<Hash> {
  checked(text);
  const wallet = createWalletClient({ chain: base, transport: custom(provider) });
  return wallet.writeContract({
    account,
    chain: base,
    address: inbox,
    abi: inboxAbi,
    functionName: "brief",
    args: [text],
    ...(suffix ? { dataSuffix: suffix } : {}),
  });
}

/**
 * A Base Account: wallet_sendCalls (EIP-5792) of brief(text) with the suffix as the `dataSuffix` capability, which is
 * how docs.base.org's Builder Codes pages attribute a smart wallet's calls. The capability is optional, as those pages
 * give it, so a wallet without it still sends the brief.
 */
export async function sendBriefBaseAccount({ provider, account, inbox, text, suffix }: BriefSend): Promise<{ id: string }> {
  checked(text);
  const wallet = createWalletClient({ chain: base, transport: custom(provider) });
  const { id } = await wallet.sendCalls({
    account,
    chain: base,
    calls: [{ to: inbox, abi: inboxAbi, functionName: "brief", args: [text] }],
    ...(suffix ? { capabilities: { dataSuffix: { value: suffix, optional: true } } } : {}),
  });
  return { id };
}

/**
 * The transaction hash of a wallet_sendCalls bundle once the wallet reports it included and successful, or null when
 * it reports success with no transaction. Throws a WalletError when the wallet reports the call as failed or its
 * transaction as reverted: a smart wallet's outer transaction can succeed while the brief's call inside it fails.
 */
export async function bundleTxHash(provider: Eip1193Provider, id: string, timeoutMs = 120_000): Promise<Hash | null> {
  const wallet = createWalletClient({ chain: base, transport: custom(provider) });
  const status = await wallet.waitForCallsStatus({ id, timeout: timeoutMs });
  if (status.status !== "success") throw new WalletError(`Base Account reported the brief's call as failed (status ${status.statusCode}), so the brief is not in the inbox.`);
  const receipt = status.receipts?.[0];
  if (!receipt) return null;
  if (receipt.status !== "success") throw new WalletError("Base Account reported that the brief's transaction reverted, so the brief is not in the inbox.");
  return receipt.transactionHash;
}
