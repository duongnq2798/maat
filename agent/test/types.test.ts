import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTIONS, REASONS, SESSION_MODES, actionId, reasonName } from "../src/types.js";

const typesSol = readFileSync(join(import.meta.dirname, "..", "..", "contracts", "src", "Types.sol"), "utf8");

function solEnum(name: string): string[] {
  const m = typesSol.match(new RegExp(`enum ${name} \\{([\\s\\S]*?)\\}`));
  if (!m?.[1]) throw new Error(`enum ${name} not found`);
  return m[1]
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, "").trim().replace(/,$/, ""))
    .filter((l) => l.length > 0);
}

describe("enum parity with Types.sol", () => {
  it("Action", () => expect([...ACTIONS]).toEqual(solEnum("Action")));
  it("Reason", () => expect([...REASONS]).toEqual(solEnum("Reason")));
  it("SessionMode", () => expect([...SESSION_MODES]).toEqual(solEnum("SessionMode")));
});

describe("enum helpers", () => {
  it("maps names to ids and back", () => {
    expect(actionId("BUY")).toBe(0);
    expect(actionId("PAY_EXPENSE")).toBe(6);
    expect(reasonName(6)).toBe("MARKET_CLOSED");
    expect(reasonName(19)).toBe("DERISK_WINDOW");
  });
  it("rejects an unknown reason id", () => {
    expect(() => reasonName(20)).toThrow(/unknown reason/);
  });
});
