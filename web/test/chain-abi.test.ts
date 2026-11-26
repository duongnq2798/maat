// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AbiEvent, AbiFunction } from "viem";
import { describe, expect, it } from "vitest";
import { b20Abi, creditAdapterAbi, erc20Abi, feedAbi, vaultAbi } from "@/lib/chain/abi";
import { REPO_ROOT } from "./helpers/solidity";

/** The array behind `export const <name> = [...] as const;` in agent/src/abi/generated.ts (gen:abi writes JSON). */
function agentAbi(name: string): readonly (AbiFunction | AbiEvent)[] {
  const text = readFileSync(join(REPO_ROOT, "agent/src/abi/generated.ts"), "utf8").replace(/\r\n/g, "\n");
  const head = `export const ${name} = `;
  const start = text.indexOf(head);
  if (start < 0) throw new Error(`${name} not in agent/src/abi/generated.ts`);
  return JSON.parse(text.slice(start + head.length, text.indexOf(" as const;", start)));
}

describe("browser ABIs", () => {
  it.each([
    ["b20AssetAbi", b20Abi],
    ["aggregatorV3Abi", feedAbi],
    ["erc20Abi", erc20Abi],
  ] as const)("every item of the %s subset matches the agent's ABI", (name, subset) => {
    const full = agentAbi(name);
    for (const item of subset) {
      const twin = full.find((f) => f.type === item.type && f.name === item.name);
      expect(twin, `${name}.${item.name}`).toBeDefined();
      expect(twin).toEqual(expect.objectContaining({ inputs: item.inputs, outputs: item.outputs, stateMutability: item.stateMutability }));
    }
  });

  it("reads balanceOfUI, which the dashboard shows as the quantity", () => {
    expect(b20Abi.map((f) => f.name)).toEqual(["balanceOf", "balanceOfUI", "decimals", "uiMultiplier"]);
  });

  it("takes the vault and credit adapter ABIs from the published ABI file", () => {
    const decision = vaultAbi.find((x) => x.type === "event" && x.name === "Decision") as AbiEvent;
    expect(decision.inputs.map((i) => `${i.type} ${i.name}`)).toEqual([
      "bytes32 intentId",
      "uint8 action",
      "address token",
      "uint256 amount",
      "bool allowed",
      "uint8 reason",
      "bytes32 rationaleHash",
    ]);
    expect(creditAdapterAbi.some((x) => x.type === "function" && x.name === "healthFactor")).toBe(true);
  });
});
