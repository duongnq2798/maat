import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import type { Address, Hex } from "viem";

/** Accepts every payment and records what it was asked to verify and settle. No network, no keys. */
export class FakeFacilitator implements FacilitatorClient {
  verified: PaymentRequirements[] = [];
  settled: { payload: PaymentPayload; requirements: PaymentRequirements }[] = [];
  extensions: string[] = [];

  async getSupported() {
    return { kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:8453" as const }], extensions: this.extensions, signers: {} };
  }

  async verify(_payload: PaymentPayload, requirements: PaymentRequirements) {
    this.verified.push(requirements);
    return { isValid: true, payer: BUYER };
  }

  async settle(payload: PaymentPayload, requirements: PaymentRequirements) {
    this.settled.push({ payload, requirements });
    return { success: true, transaction: `0x${"ab".repeat(32)}`, network: requirements.network, payer: BUYER };
  }
}

export const BUYER: Address = "0x9999999999999999999999999999999999999999";

/** An x402 client whose signer returns a fixed signature: enough for a facilitator that does not check it. */
export function fakeBuyer(): x402Client {
  const client = new x402Client();
  registerExactEvmScheme(client, {
    signer: { address: BUYER, signTypedData: async () => `0x${"11".repeat(65)}` as Hex },
  });
  return client;
}
