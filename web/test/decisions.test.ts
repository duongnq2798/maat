// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ACTIONS, decisionLabel, gasLabel, getDecisions, intentLabel } from "@/content/decisions";
import { FACTS } from "@/content/facts";
import { enumMembers, readRepo } from "./helpers/solidity";

describe("decision rows", () => {
  it("ACTIONS mirror enum Action", () => {
    expect(enumMembers(readRepo("contracts/src/Types.sol"), "Action")).toEqual([...ACTIONS]);
  });

  it("W1 rows are the labeled fork run at the fork block", () => {
    const rows = getDecisions();
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.source).toBe("base-fork");
      expect(r.block).toBe(FACTS.forkBlock.value);
      expect(r.txHash).toBeUndefined();
    }
  });

  it("every row is an intent the fork test actually sends", () => {
    const src = readRepo("agent/test/integration/agent.fork.test.ts");
    const sent = [...src.matchAll(/action: "(\w+)", symbol: "(\w+)", amountUsd: (\d+)/g)].map(
      (m) => `${m[1]} ${m[2]} ${m[3]}`,
    );
    for (const r of getDecisions()) expect(sent).toContain(`${r.action} ${r.symbol} ${r.amountUsd}`);
  });

  it("formats like the comp", () => {
    const rows = getDecisions();
    expect(rows.map((r) => [r.timeLabel, intentLabel(r), decisionLabel(r), gasLabel(r)])).toEqual([
      ["Thu 5 Nov 10:30", "BUY NVDAc · $20", "ALLOWED · OK", "758,192"],
      ["Thu 5 Nov 10:30", "SUPPLY NVDAc · $15", "ALLOWED · OK", "286,707"],
      ["Thu 5 Nov 10:30", "BORROW USDC · $5", "ALLOWED · OK", "484,173"],
      ["Sat 7 Nov", "BUY GOOGLc · $10", "REFUSED · MARKET_CLOSED", "111,116"],
    ]);
    expect(rows.map((r) => r.note)).toEqual([
      "NVDAc under its 33% target weight.",
      "Posted as collateral on Aave V4.",
      "Compute runway, health factor above 2.0.",
      "Weekend. Refused and logged once.",
    ]);
  });

  it("hands out copies", () => {
    const a = getDecisions();
    a[0]!.amountUsd = 999;
    expect(getDecisions()[0]!.amountUsd).toBe(20);
  });
});
