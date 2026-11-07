// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FACT_TEXT } from "@/lib/docs/fact-text";
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

describe("the agent reference covers every setting and script", () => {
  const config = page("reference/agent-configuration");
  const scripts = page("reference/agent-scripts");
  it.each(docsData.agent.env.map((v) => v.name))("env %s", (name) => {
    expect(config).toMatch(entry("EnvVar", { name }));
  });
  it.each(docsData.agent.scripts.map((s) => s.name))("npm run %s", (name) => {
    expect(scripts).toMatch(entry("ScriptEntry", { name }));
  });
  it.each(docsData.agent.scriptFiles)("scripts/%s", (file) => {
    expect(scripts).toMatch(entry("ScriptFile", { name: file }));
  });
});

describe("every setting, script and script file has its heading", () => {
  // <EnvTable> links to #<setting name in lower case>, so the heading must be the name itself. The entry sits
  // directly under its heading, so a heading cannot carry another entry.
  const lf = (slug: string) => page(slug).replace(/\r\n/g, "\n");
  const config = lf("reference/agent-configuration");
  const scripts = lf("reference/agent-scripts");
  const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = (name: string, tag: string, attr: string) =>
    new RegExp(`^### ${literal(name)}\\n\\n<${tag} ${attr}="${literal(name)}" />$`, "m");
  it.each(docsData.agent.env.map((v) => v.name))("env %s", (name) => {
    expect(config).toMatch(heading(name, "EnvVar", "name"));
  });
  it.each(docsData.agent.scripts.map((s) => s.name))("npm run %s", (name) => {
    expect(scripts).toMatch(heading(name, "ScriptEntry", "name"));
  });
  it.each(docsData.agent.scriptFiles)("scripts/%s", (file) => {
    expect(scripts).toMatch(heading(file, "ScriptFile", "name"));
  });
});

describe("base addresses page lists every constant", () => {
  it("uses the generated table", () => {
    expect(page("reference/base-addresses")).toMatch(/<AddressTable\s*\/>/);
  });
});

describe("default parameters page", () => {
  it("default-parameters lists every fact once", () => {
    const src = page("reference/default-parameters");
    const listed = [...src.matchAll(/names=\{\[([^\]]*)\]\}/g)].flatMap((m) =>
      [...(m[1] ?? "").matchAll(/"([^"]+)"/g)].map((n) => n[1]),
    );
    expect([...listed].sort()).toEqual(Object.keys(FACT_TEXT).sort());
  });
});
