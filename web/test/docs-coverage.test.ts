// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { docsData } from "@/lib/docs/generated";
import { REPO_ROOT } from "./helpers/solidity";

const page = (slug: string) => readFileSync(join(REPO_ROOT, "web/content/docs", `${slug}.mdx`), "utf8");

/** Each documented contract and the reference page that must describe every function it exposes. */
const FUNCTION_PAGES: Readonly<Record<string, string>> = {
  MandateVault: "reference/mandate-vault",
  MarketCalendar: "reference/market-calendar",
  ISwapAdapter: "reference/adapters",
  AerodromeSwapAdapter: "reference/adapters",
  ICreditAdapter: "reference/adapters",
  AaveV4CreditAdapter: "reference/adapters",
};

const entry = (tag: string, attrs: Record<string, string>) =>
  new RegExp(`<${tag}\\s+${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join("\\s+")}\\s*/>`);

describe("every public function has a reference entry", () => {
  for (const c of docsData.surface.contracts) {
    const slug = FUNCTION_PAGES[c.name];
    if (slug === undefined) continue; // IMandateVaultEvents has events only
    it.each(c.functions.map((f) => f.name))(`${c.name}.%s`, (name) => {
      expect(page(slug)).toMatch(entry("Fn", { contract: c.name, name }));
    });
  }
});

describe("every function has its heading", () => {
  // <FunctionIndex> links to these anchors and no other gate checks them. On the adapters page most names repeat
  // between an interface and its implementation, so every heading there names its contract. The entry sits directly
  // under its heading, so a heading cannot carry another function's signature.
  for (const c of docsData.surface.contracts) {
    const slug = FUNCTION_PAGES[c.name];
    if (slug === undefined) continue;
    it.each(c.functions.map((f) => f.name))(`${c.name}.%s`, (name) => {
      const text = slug === "reference/adapters" ? `${name} \\(${c.name}\\)` : name;
      const heading = new RegExp(`^### ${text}\\n\\n<Fn contract="${c.name}" name="${name}" />$`, "m");
      expect(page(slug).replace(/\r\n/g, "\n")).toMatch(heading);
    });
  }
});

describe("every event and error has a reference entry", () => {
  const events = page("reference/events");
  const errors = page("reference/errors");
  for (const c of docsData.surface.contracts) {
    // MandateVault re-exposes these events; the page lists them under MandateVault, where readers look.
    if (c.name === "IMandateVaultEvents") continue;
    it.each(c.events.map((e) => e.name))(`${c.name} event %s`, (name) => {
      expect(events).toMatch(entry("EventEntry", { contract: c.name, name }));
    });
    it.each(c.errors.map((e) => e.name))(`${c.name} error %s`, (name) => {
      expect(errors).toMatch(entry("ErrorEntry", { contract: c.name, name }));
    });
  }
});

describe("every enum and struct in Types.sol has a reference entry", () => {
  const types = page("reference/types");
  it.each([...docsData.surface.enums, ...docsData.surface.structs].map((t) => t.name))("%s", (name) => {
    expect(types).toMatch(entry("TypeEntry", { name }));
  });
});
