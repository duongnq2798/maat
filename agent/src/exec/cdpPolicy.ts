import type { CreatePolicyBody } from "@coinbase/cdp-sdk";
import type { Address } from "viem";

/**
 * CDP policy for the executor account. Accept-only rules make each listed operation default-deny.
 * An operation no rule names is accepted, so every signing path the agent does not use gets a reject rule.
 */
export function executorPolicy(vault: Address): CreatePolicyBody {
  return {
    scope: "account",
    description: "Maat executor, MandateVault calls on Base only", // the SDK allows only letters, digits, spaces, commas and periods
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
      // These two require criteria, so each gets the broadest one: any text (RE2, newlines included, anchored or not)
      // and any verifying contract ("not in" an empty list). A request one missed would still be refused, because the
      // operation is named and no accept rule matches it (no_rule_matched).
      { action: "reject", operation: "signEvmMessage", criteria: [{ type: "evmMessage", match: "[\\s\\S]*" }] },
      {
        action: "reject",
        operation: "signEvmTypedData",
        criteria: [{ type: "evmTypedDataVerifyingContract", addresses: [], operator: "not in" }],
      },
    ],
  };
}
