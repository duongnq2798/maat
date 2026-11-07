import { expect, it } from "vitest";
import { FACTS } from "@/content/facts";
import { mandateRows } from "@/content/mandate";

it("renders the 12 mandate rows exactly as the comp", () => {
  expect(mandateRows(FACTS.mandate.value)).toEqual([
    { k: "sessionMode", v: "REGULAR" },
    { k: "maxStaleness", v: "3600 s" },
    { k: "maxPremiumBps", v: "100" },
    { k: "maxSlippageBps", v: "100" },
    { k: "twapWindow", v: "1800 s" },
    { k: "multiplierCooldown", v: "24 h" },
    { k: "perTradeCapUsd", v: "$50" },
    { k: "dailyCapUsd", v: "$100" },
    { k: "maxWeightBps (per token)", v: "4000" },
    { k: "minHealthFactor", v: "1.5" },
    { k: "targetHealthFactor", v: "2.0" },
    { k: "deriskWindow", v: "8 h before Fri 20:00 ET" },
  ]);
});
