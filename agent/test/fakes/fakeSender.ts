import { pad, toHex, type Address, type Hex } from "viem";
import type { TxRequest, TxSender } from "../../src/exec/sender.js";

export class FakeSender implements TxSender {
  sent: TxRequest[] = [];
  fail: Error | undefined;

  constructor(readonly address: Address = "0x2222222222222222222222222222222222222222") {}

  async send(tx: TxRequest): Promise<Hex> {
    if (this.fail) throw this.fail;
    this.sent.push(tx);
    return pad(toHex(this.sent.length), { size: 32 });
  }
}
