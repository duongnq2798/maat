import { concat, decodeFunctionData, encodeFunctionData, getAddress, keccak256, toBytes, toHex, type Address, type Hex, type WalletClient } from "viem";
import { mandateVaultAbi } from "../abi/index.js";
import { BLOB_PREFIX, MAX_BLOB_BYTES, validateBlob } from "../rationale/blob.js";
import type { OnchainIntent } from "../types.js";
import { MAX_GAS } from "./calls.js";

export interface TxRequest {
  to: Address;
  /** The ABI-encoded call alone: nothing after it. */
  data: Hex;
  /** The maat:v1 rationale blob an execute carries between the call and the Builder Code; required for execute only. */
  blob?: string;
  idempotencyKey: string;
  /** Explicit gas limit; see calls.ts for why an estimate alone is unsafe. */
  gas: bigint;
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

/**
 * The only path to a sender: vault-only, allowlisted functions, explicit bounded gas, Builder Code on every
 * transaction, and on every execute the maat:v1 blob its rationaleHash commits to. An execute goes out as
 * `encodeExecute(intent) ‖ blob ‖ suffix` (docs/superpowers/specs/2026-11-25-maat-v1-rationale-blob-design.md §1).
 */
export class GuardedSender implements TxSender {
  constructor(
    private readonly inner: TxSender,
    private readonly opts: { vault: Address; suffix: Hex },
  ) {}

  get address(): Address {
    return this.inner.address;
  }

  /** The exact bytes send() would broadcast for `tx`, after every check but the gas limit: what gas is estimated on. */
  calldata(tx: Pick<TxRequest, "to" | "data" | "blob">): Hex {
    if (getAddress(tx.to) !== getAddress(this.opts.vault)) throw new SendRefused(`target ${tx.to} is not the vault`);
    let call: ReturnType<typeof decodeFunctionData<typeof mandateVaultAbi>>;
    try {
      call = decodeFunctionData({ abi: mandateVaultAbi, data: tx.data });
    } catch {
      throw new SendRefused("calldata does not decode against the MandateVault ABI");
    }
    const fn = call.functionName;
    if (!(ALLOWED_FUNCTIONS as readonly string[]).includes(fn)) throw new SendRefused(`function ${fn} is not allowed`);
    // decodeFunctionData ignores trailing bytes; anything after the call goes through the blob checks below or not at all.
    const exact = encodeFunctionData({ abi: mandateVaultAbi, functionName: fn, args: call.args } as never);
    if (exact.toLowerCase() !== tx.data.toLowerCase()) throw new SendRefused(`calldata for ${fn} carries bytes after the call`);
    if (fn !== "execute") {
      if (tx.blob !== undefined) throw new SendRefused(`only execute carries a blob, not ${fn}`);
      return concat([tx.data, this.opts.suffix]);
    }
    const blob = tx.blob;
    if (blob === undefined) throw new SendRefused("execute needs a maat:v1 blob");
    if (!blob.startsWith(BLOB_PREFIX)) throw new SendRefused(`the blob does not start with ${BLOB_PREFIX}`);
    const bytes = toBytes(blob);
    if (bytes.length > MAX_BLOB_BYTES) throw new SendRefused(`the blob is ${bytes.length} bytes, more than ${MAX_BLOB_BYTES} bytes`);
    if (!/^[\x20-\x7e]*$/.test(blob)) throw new SendRefused("the blob is not printable ASCII");
    const intent = call.args[0] as OnchainIntent;
    if (keccak256(bytes) !== intent.rationaleHash.toLowerCase()) throw new SendRefused("keccak256 of the blob is not the intent's rationaleHash");
    const check = validateBlob(bytes);
    if (check.status !== "v1") throw new SendRefused(`the blob is not a valid maat:v1 blob: ${check.problem}`);
    return concat([tx.data, toHex(bytes), this.opts.suffix]);
  }

  async send(tx: TxRequest): Promise<Hex> {
    const data = this.calldata(tx);
    if (typeof tx.gas !== "bigint") throw new SendRefused("gas limit is missing");
    if (tx.gas <= 0n) throw new SendRefused(`gas limit ${tx.gas} is not positive`);
    if (tx.gas > MAX_GAS) throw new SendRefused(`gas limit ${tx.gas} is above the cap ${MAX_GAS}`);
    return this.inner.send({ to: tx.to, data, idempotencyKey: tx.idempotencyKey, gas: tx.gas });
  }
}

/** eth_sendTransaction from an account the node unlocks (anvil dev accounts). Local fork tests only. */
export class RpcSender implements TxSender {
  constructor(
    private readonly wallet: WalletClient,
    readonly address: Address,
  ) {}

  async send(tx: TxRequest): Promise<Hex> {
    return this.wallet.sendTransaction({ account: this.address, chain: this.wallet.chain ?? null, to: tx.to, data: tx.data, value: 0n, gas: tx.gas });
  }
}
