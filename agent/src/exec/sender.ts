import { decodeFunctionData, getAddress, type Address, type Hex, type WalletClient } from "viem";
import { mandateVaultAbi } from "../abi/index.js";
import { withSuffix } from "./builderCode.js";

export interface TxRequest {
  to: Address;
  data: Hex;
  idempotencyKey: string;
}

export interface TxSender {
  readonly address: Address;
  send(tx: TxRequest): Promise<Hex>;
}

export class SendRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SendRefused";
  }
}

export const ALLOWED_FUNCTIONS = ["execute", "syncMultiplier", "notifyRevenue"] as const;

/** The only path to a sender: vault-only, allowlisted functions, Builder Code on every transaction. */
export class GuardedSender implements TxSender {
  constructor(
    private readonly inner: TxSender,
    private readonly opts: { vault: Address; suffix: Hex },
  ) {}

  get address(): Address {
    return this.inner.address;
  }

  async send(tx: TxRequest): Promise<Hex> {
    if (getAddress(tx.to) !== getAddress(this.opts.vault)) throw new SendRefused(`target ${tx.to} is not the vault`);
    let fn: string;
    try {
      fn = decodeFunctionData({ abi: mandateVaultAbi, data: tx.data }).functionName;
    } catch {
      throw new SendRefused("calldata does not decode against the MandateVault ABI");
    }
    if (!(ALLOWED_FUNCTIONS as readonly string[]).includes(fn)) throw new SendRefused(`function ${fn} is not allowed`);
    return this.inner.send({ ...tx, data: withSuffix(tx.data, this.opts.suffix) });
  }
}

/** eth_sendTransaction from an account the node unlocks (anvil dev accounts). Local fork tests only. */
export class RpcSender implements TxSender {
  constructor(
    private readonly wallet: WalletClient,
    readonly address: Address,
  ) {}

  async send(tx: TxRequest): Promise<Hex> {
    return this.wallet.sendTransaction({ account: this.address, chain: this.wallet.chain ?? null, to: tx.to, data: tx.data, value: 0n });
  }
}
