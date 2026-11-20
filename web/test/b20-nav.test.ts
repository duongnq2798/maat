import { describe, expect, it } from "vitest";
import { FACTS } from "@/content/facts";
import { NAV_TOKENS } from "@/content/b20-nav";
import addresses from "@/content/generated/base-addresses.json";

const byName = new Map(addresses.map((a) => [a.name, a.value.toLowerCase()]));

describe("the B20 tokens with a NAV", () => {
  it("lists 13 distinct tokens, ANTc included and no COINc", () => {
    expect(NAV_TOKENS).toHaveLength(13);
    expect(new Set(NAV_TOKENS.map((t) => t.symbol)).size).toBe(13);
    expect(NAV_TOKENS.map((t) => t.symbol)).toContain("ANTc");
    expect(NAV_TOKENS.map((t) => t.symbol)).not.toContain("COINc");
  });

  it("names every basket token with the contracts' own token, feed and pool", () => {
    for (const symbol of FACTS.basket.value) {
      const t = NAV_TOKENS.find((x) => x.symbol === symbol);
      const key = symbol.replace(/c$/, "").toUpperCase(); // NVDAc -> NVDA
      expect(t?.token.toLowerCase()).toBe(byName.get(`${key}C`));
      expect(t?.feed.toLowerCase()).toBe(byName.get(`${key}_FEED`));
      expect(t?.pool.toLowerCase()).toBe(byName.get(`${key}C_USDC_POOL`));
    }
  });

  it("uses 0xb2-prefixed B20 addresses and 20-byte hex everywhere", () => {
    for (const t of NAV_TOKENS) {
      expect(t.token.toLowerCase().startsWith("0xb2")).toBe(true);
      for (const a of [t.token, t.feed, t.pool]) expect(a).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
  });
});
