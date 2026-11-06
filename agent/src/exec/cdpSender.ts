import { getAddress, keccak256, toBytes, type Address, type Hex } from "viem";
import type { TxRequest, TxSender } from "./sender.js";

/** The slice of CdpClient the runtime uses. Tests pass a fake. */
export interface CdpLike {
  evm: {
    getAccount(o: { name: string }): Promise<{ address: Address }>;
    sendTransaction(o: {
      address: Address;
      network: "base";
      transaction: { to: Address; data: Hex; value: bigint; gas: bigint };
      idempotencyKey?: string;
    }): Promise<{ transactionHash: Hex }>;
  };
}

/** Deterministic, v4-shaped UUID from any string key, so a retried send reuses its CDP idempotency key. */
export function uuidFromKey(key: string): string {
  const h = keccak256(toBytes(key)).slice(2, 34).split("");
  h[12] = "4";
  h[16] = "89ab"[parseInt(h[16]!, 16) & 3]!;
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

async function defaultCdp(): Promise<CdpLike> {
  const { CdpClient } = await import("@coinbase/cdp-sdk");
  return new CdpClient() as unknown as CdpLike; // reads CDP_API_KEY_ID / CDP_API_KEY_SECRET / CDP_WALLET_SECRET
}

export class CdpSender implements TxSender {
  private constructor(
    private readonly cdp: CdpLike,
    readonly address: Address,
  ) {}

  /** Looks the account up by name. Never creates one: that is scripts/cdp-setup.ts, run by the owner. */
  static async connect(opts: { accountName: string; expectedAddress: Address; cdp?: CdpLike }): Promise<CdpSender> {
    const cdp = opts.cdp ?? (await defaultCdp());
    const account = await cdp.evm.getAccount({ name: opts.accountName });
    if (getAddress(account.address) !== getAddress(opts.expectedAddress)) {
      throw new Error(`CDP account "${opts.accountName}" is ${account.address}, which does not match MAAT_EXECUTOR ${opts.expectedAddress}`);
    }
    return new CdpSender(cdp, getAddress(account.address));
  }

  async send(tx: TxRequest): Promise<Hex> {
    const { transactionHash } = await this.cdp.evm.sendTransaction({
      address: this.address,
      network: "base",
      transaction: { to: tx.to, data: tx.data, value: 0n, gas: tx.gas },
      idempotencyKey: uuidFromKey(tx.idempotencyKey),
    });
    return transactionHash;
  }
}
