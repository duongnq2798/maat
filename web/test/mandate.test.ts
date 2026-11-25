// @vitest-environment node
import { expect, it } from "vitest";
import { FACTS } from "@/content/facts";
import { mandateRows } from "@/content/mandate";
import { readRepo } from "./helpers/solidity";

it("renders the 12 mandate rows with a plain-English label, the onchain field and its value", () => {
  expect(mandateRows(FACTS.mandate.value).map((r) => [r.label, r.k, r.v])).toEqual([
    ["Trading session", "sessionMode", "REGULAR"],
    ["Oldest price it will use", "maxStaleness", "90000 s"],
    ["Pool price vs Chainlink", "maxPremiumBps", "100 bps · 1%"],
    ["Slippage per swap", "maxSlippageBps", "150 bps · 1.5%"],
    ["Pool price averaged over", "twapWindow", "1800 s"],
    ["Pause after a split", "multiplierCooldown", "24 h"],
    ["Per-trade cap", "perTradeCapUsd", "$50"],
    ["Daily cap", "dailyCapUsd", "$100"],
    ["Weight per stock", "maxWeightBps", "4000 bps · 40%"],
    ["Health factor floor", "minHealthFactor", "1.5"],
    ["Health factor target", "targetHealthFactor", "2.0"],
    ["De-risk before the weekend", "deriskWindow", "8 h before Fri 20:00 ET"],
  ]);
});

it("names only fields that exist in the Mandate or TokenConfig structs", () => {
  const types = readRepo("contracts/src/Types.sol");
  const fields = (name: string) => {
    const body = new RegExp(`struct ${name}\\s*\\{([^}]*)\\}`).exec(types)?.[1];
    if (body === undefined) throw new Error(`struct ${name} not found in contracts/src/Types.sol`);
    // Drop line comments first: "// WAD; ..." would otherwise read as a field.
    return [...body.replace(/\/\/[^\n]*/g, "").matchAll(/\b(\w+)\s*;/g)].map((m) => m[1]);
  };
  const known = [...fields("Mandate"), ...fields("TokenConfig")];
  for (const r of mandateRows(FACTS.mandate.value)) expect(known, r.k).toContain(r.k);
});
