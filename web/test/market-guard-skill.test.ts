// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { type Abi, type AbiFunction, encodeFunctionData, toFunctionSelector } from "viem";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import abis from "@/content/generated/abi.json";
import addresses from "@/content/generated/base-addresses.json";
import deployments from "@/content/generated/deployments.json";
import { REASON_GROUPS, REASON_LABEL, REASON_MEANING_DOCS, REASONS } from "@/content/reasons";
import * as guard from "../../skills/maat-market-guard/scripts/check.mjs";
import { enumMembers, REPO_ROOT, readRepo } from "./helpers/solidity";

// skills/maat-market-guard is the guard other agents call, in BankrBot's skills format, and it must run outside this
// repository. So it carries its own copy of the addresses, selectors and reasons; these tests hold that copy to the
// contracts, the deployment record and the site's reason text, and run its offline selftest so CI covers it.

const SLUG = "maat-market-guard";
const DIR = `skills/${SLUG}`;
const lf = (rel: string) => readRepo(rel).replace(/\r\n/g, "\n");
const skillMd = lf(`${DIR}/SKILL.md`);

/** The lines under the heading line `heading`, up to the next heading of its level or above. */
function under(md: string, heading: string): string {
  const level = /^#+/.exec(heading)?.[0].length ?? 0;
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l === heading);
  if (start < 0) return "";
  const end = lines.findIndex((l, i) => i > start && (/^#+ /.exec(l)?.[0].length ?? Infinity) <= level);
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}
/** The body rows of the first table in `text`, each as its trimmed cells. */
function tableRows(text: string): string[][] {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith("|"));
  if (start < 0) return [];
  const end = lines.findIndex((l, i) => i > start && !l.startsWith("|"));
  return lines.slice(start + 2, end < 0 ? undefined : end).map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));
}
const unquote = (cell: string) => cell.replace(/^`|`$/g, "");

describe("skills/maat-market-guard", () => {
  // The selftest is a child node process; on a loaded machine its start alone can pass vitest's 5 s default.
  it("passes its offline selftest, which serves recorded answers and fails on any network call", () => {
    const out = execFileSync(process.execPath, [`${DIR}/scripts/selftest.mjs`], { cwd: REPO_ROOT, encoding: "utf8" });
    const m = /^selftest: (\d+)\/(\d+) passed \(offline, fixtures recorded \S+ from mainnet\.base\.org\)$/m.exec(out);
    expect(m, out).not.toBeNull();
    expect(m![1]).toBe(m![2]);
    expect(Number(m![2])).toBeGreaterThan(0);
  }, 30_000);

  it("has a catalog.json in BankrBot's schemaVersion 1 form, its slug the folder's name", () => {
    const catalog = JSON.parse(readRepo(`${DIR}/catalog.json`)) as Record<string, unknown>;
    expect(Object.keys(catalog)).toEqual(["schemaVersion", "slug", "provider", "providerUrl", "logo", "demo", "setup", "install"]);
    expect(catalog.schemaVersion).toBe(1);
    expect(catalog.slug).toBe(SLUG);
    expect(catalog.providerUrl).toBe("https://maatonbase.xyz");
    expect(readdirSync(join(REPO_ROOT, DIR))).toContain(catalog.logo);
    const demo = catalog.demo as Record<string, unknown>;
    expect(Object.keys(demo)).toEqual(["title", "language", "code"]);
    expect(Object.values(demo).every((v) => typeof v === "string" && v.length > 0)).toBe(true);
    const setup = catalog.setup as unknown[];
    expect(setup.length).toBeGreaterThan(0);
    expect(setup.every((s) => typeof s === "string" && s.length > 0)).toBe(true);
    expect(catalog.install).toEqual({
      type: "bankr",
      repoPath: SLUG,
      command: `install the ${SLUG} skill from https://github.com/BankrBot/skills/tree/main/${SLUG}`,
    });
  });

  it("uses the site's mark as its logo", () => {
    expect(readRepo(`${DIR}/logo.svg`)).toBe(readRepo("web/brand/src/mark.svg"));
  });

  it("names the folder and says what it does in SKILL.md's frontmatter, and no file carries an AI-attribution line", () => {
    const front = /^---\n([\s\S]*?)\n---\n/.exec(skillMd);
    expect(front).not.toBeNull();
    const meta = parse(front![1]!) as Record<string, unknown>;
    expect(Object.keys(meta)).toEqual(["name", "description"]);
    expect(meta.name).toBe(SLUG);
    expect(typeof meta.description).toBe("string");
    expect((meta.description as string).length).toBeLessThanOrEqual(1024);
    // The count of refusal codes it names is the count the script returns: every reason but OK.
    expect(meta.description).toContain(`OK or one of ${guard.REASONS.length - 1} refusal codes`);
    const files = ["SKILL.md", "catalog.json", "scripts/check.mjs", "scripts/selftest.mjs"].map((f) => readRepo(`${DIR}/${f}`));
    for (const text of files) expect(text).not.toMatch(/co-authored-by|generated with|claude code|anthropic/i);
  });

  it("imports nothing but Node built-ins: check.mjs none else, selftest.mjs only check.mjs", () => {
    const imports = (rel: string) => {
      const src = readRepo(rel);
      expect(src).not.toMatch(/\brequire\(/);
      return [...src.matchAll(/^\s*import\s[^;]*?\bfrom\s+["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']/gm)].map((m) => m[1] ?? m[2]);
    };
    const check = imports(`${DIR}/scripts/check.mjs`);
    expect(check.length).toBeGreaterThan(0);
    expect(check.filter((s) => !s?.startsWith("node:"))).toEqual([]);
    expect(imports(`${DIR}/scripts/selftest.mjs`).filter((s) => !s?.startsWith("node:"))).toEqual(["./check.mjs"]);
  });
});

describe("the skill's copy of the contracts", () => {
  it("has the vault and the calendar of the deployment table, and the tokens of BaseAddresses.sol", () => {
    const deployed = (name: string) => deployments.find((d) => d.contract === name)?.address;
    const constant = (name: string) => addresses.find((a) => a.name === name)?.value;
    expect(guard.ADDRESSES).toEqual({ MandateVault: deployed("MandateVault"), MarketCalendar: deployed("MarketCalendar") });
    expect(guard.TOKENS).toEqual({ USDC: constant("USDC"), NVDAc: constant("NVDAC"), GOOGLc: constant("GOOGLC"), AAPLc: constant("AAPLC") });
  });

  it("gives each selector the hash of a function the published ABIs hold, and decimals() its ERC-20 selector", () => {
    const fns = [...(abis.MandateVault as Abi), ...(abis.MarketCalendar as Abi)].filter((i): i is AbiFunction => i.type === "function");
    const signature = (f: AbiFunction) => `${f.name}(${f.inputs.map(canonical).join(",")})`;
    for (const [sig, selector] of Object.entries(guard.SELECTORS)) {
      if (sig === "decimals()") {
        expect(selector).toBe(toFunctionSelector("function decimals() view returns (uint8)"));
        continue;
      }
      const fn = fns.find((f) => signature(f) === sig);
      expect(fn, sig).toBeDefined();
      expect(selector, sig).toBe(toFunctionSelector(fn!));
    }
  });

  it("reads the session mode and the calendar at their places among the mandate's 14 static words", () => {
    const mandate = (abis.MandateVault as Abi).find((i): i is AbiFunction => i.type === "function" && i.name === "mandate");
    const fields = (mandate!.outputs[0] as { components: readonly { name?: string; type: string }[] }).components;
    expect(fields.every((f) => /^(uint\d+|address|bool)$/.test(f.type))).toBe(true);
    expect(fields).toHaveLength(guard.MANDATE_WORDS.count);
    expect(fields.findIndex((f) => f.name === "sessionMode")).toBe(guard.MANDATE_WORDS.sessionMode);
    expect(fields.findIndex((f) => f.name === "calendar")).toBe(guard.MANDATE_WORDS.calendar);
  });

  it("encodes previewIntent calldata as viem does from the vault's ABI", () => {
    const intents = [
      { id: `0x${"00".repeat(32)}`, action: 0, token: guard.TOKENS.NVDAc, amount: 1_000_000n, minOut: 0n, payee: `0x${"00".repeat(20)}`, rationaleHash: `0x${"00".repeat(32)}` },
      { id: `0x${"ab".repeat(32)}`, action: 6, token: guard.TOKENS.USDC, amount: 2n ** 200n, minOut: 7n, payee: "0x000000000000000000000000000000000000dEaD", rationaleHash: `0x${"cd".repeat(32)}` },
    ] as const;
    for (const intent of intents) {
      expect(guard.encodePreviewIntent(intent)).toBe(encodeFunctionData({ abi: abis.MandateVault as Abi, functionName: "previewIntent", args: [intent] }));
    }
  });

  it("follows enum Action, enum SessionMode and the calendar's session minutes", () => {
    const types = readRepo("contracts/src/Types.sol");
    expect([...guard.ACTIONS]).toEqual(enumMembers(types, "Action"));
    expect([...guard.SESSIONS]).toEqual(enumMembers(types, "SessionMode"));
    const calendar = readRepo("contracts/src/MarketCalendar.sol");
    for (const [name, value] of Object.entries(guard.CALENDAR_MINUTES)) {
      expect(calendar, name).toMatch(new RegExp(`uint256 internal constant ${name} = ${value};`));
    }
  });

  it("lists enum Reason in order, with the site's label, group and meaning for each refusal", () => {
    expect(guard.REASONS.map((r) => r.name)).toEqual(enumMembers(readRepo("contracts/src/Types.sol"), "Reason"));
    expect(guard.REASONS.map((r) => r.name)).toEqual(["OK", ...REASONS]);
    const groupOf = (code: string) => REASON_GROUPS.find((g) => (g.codes as readonly string[]).includes(code))?.title ?? null;
    for (const r of guard.REASONS) {
      expect(r.label, r.name).toBe(REASON_LABEL[r.name as keyof typeof REASON_LABEL]);
      expect(r.group, r.name).toBe(groupOf(r.name));
      if (r.name !== "OK") expect(r.meaning, r.name).toBe(REASON_MEANING_DOCS[r.name as keyof typeof REASON_MEANING_DOCS]);
    }
  });
});

describe("SKILL.md", () => {
  it("tables every reason the script returns, by id, name, group and meaning", () => {
    const rows = tableRows(under(skillMd, "## Typed reasons"));
    expect(rows.map(([id = "", name = "", group = "", meaning = ""]) => [Number(id), unquote(name), group || null, meaning])).toEqual(
      guard.REASONS.map((r, id) => [id, r.name, r.group, r.meaning]),
    );
  });

  it("tables the addresses the script carries", () => {
    const rows = tableRows(under(skillMd, "## Configuration")).map(([name = "", address = ""]) => [unquote(name), unquote(address)]);
    expect(Object.fromEntries(rows)).toEqual({ ...guard.ADDRESSES, ...guard.TOKENS });
  });

  it("names the script's RPC default and its environment variable", () => {
    expect(skillMd).toContain(`\`${guard.RPC_ENV}\``);
    expect(skillMd).toContain(`\`${guard.DEFAULT_RPC}\``);
  });
});

/** A Solidity ABI parameter as a selector signature writes it: a tuple as its components in parentheses. */
function canonical(p: { type: string; components?: readonly { type: string }[] }): string {
  if (!p.type.startsWith("tuple")) return p.type;
  return `(${(p.components ?? []).map(canonical).join(",")})${p.type.slice("tuple".length)}`;
}
