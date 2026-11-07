import { pad, toHex, type Address, type Hex } from "viem";
import type { TxRequest, TxSender } from "../../src/exec/sender.js";

export class FakeSender implements TxSender {
  sent: TxRequest[] = [];
  fail: Error | undefined;
  /** Throw after the transaction was broadcast: the caller never learns the hash. */
  failAfterBroadcast: Error | undefined;

  constructor(readonly address: Address = "0x2222222222222222222222222222222222222222") {}

  async send(tx: TxRequest): Promise<Hex> {
    if (this.fail) throw this.fail;
    this.sent.push(tx);
    if (this.failAfterBroadcast) throw this.failAfterBroadcast;
    return pad(toHex(this.sent.length), { size: 32 });
  }
}
