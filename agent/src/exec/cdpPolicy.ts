import type { Address } from "viem";

/** CDP policy for the executor account. Accept-only rules make each listed operation default-deny. */
export function executorPolicy(vault: Address) {
  return {
    scope: "account" as const,
    description: "Maat executor: MandateVault calls on Base only",
    rules: [
      {
        action: "accept",
        operation: "sendEvmTransaction",
        criteria: [
          { type: "evmNetwork", networks: ["base"], operator: "in" },
          { type: "evmAddress", addresses: [vault], operator: "in" },
          { type: "ethValue", ethValue: "0", operator: "<=" },
        ],
      },
      {
        action: "accept",
        operation: "signEvmTransaction",
        criteria: [
          { type: "evmAddress", addresses: [vault], operator: "in" },
          { type: "ethValue", ethValue: "0", operator: "<=" },
        ],
      },
      { action: "reject", operation: "signEvmHash" }, // the SDK type and API accept no criteria on signEvmHash
    ] as unknown[],
  };
}
