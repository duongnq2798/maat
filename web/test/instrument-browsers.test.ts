// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readRepo } from "./helpers/solidity";

const config = readFileSync(new URL("../playwright.config.ts", import.meta.url), "utf8");
const ci = readRepo(".github/workflows/ci.yml");

describe("cross-browser smoke (spec 2026-11-23 section 11, item 13)", () => {
  it("runs every spec on Chromium, and only smoke.spec.ts on WebKit and Firefox", () => {
    const projects = /\n  projects: \[\n([\s\S]*?)\n  \],\n/.exec(config)?.[1];
    expect(projects?.split("\n").map((line) => line.trim())).toEqual([
      '{ name: "chromium", use: { ...devices["Desktop Chrome"] } },',
      '{ name: "webkit", use: { ...devices["Desktop Safari"], deviceScaleFactor: 1 }, testMatch: /smoke\\.spec\\.ts$/ },',
      '{ name: "firefox", use: { ...devices["Desktop Firefox"] }, testMatch: /smoke\\.spec\\.ts$/ },',
    ]);
  });

  it("matches smoke.spec.ts and no other spec", () => {
    const match = /smoke\.spec\.ts$/;
    expect(match.test("e2e/smoke.spec.ts")).toBe(true);
    for (const other of ["e2e/live.spec.ts", "e2e/weight.spec.ts", "e2e/smoke.spec.tsx", "e2e/smokespec.ts"]) {
      expect(match.test(other), other).toBe(false);
    }
  });

  it("installs WebKit and Firefox in CI right after Chromium, just before the e2e step", () => {
    const lines = ci.split("\n").map((line) => line.trim());
    const chromium = lines.indexOf("run: npx --no-install playwright install --with-deps --only-shell chromium");
    expect(chromium).toBeGreaterThan(0);
    expect(lines.slice(chromium + 1, chromium + 4)).toEqual([
      "- id: cross_browsers",
      "run: npx --no-install playwright install --with-deps webkit firefox",
      "- id: e2e",
    ]);
    expect(lines.filter((line) => line.startsWith("run: npx --no-install playwright install"))).toHaveLength(2);
  });
});
