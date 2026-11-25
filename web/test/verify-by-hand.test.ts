// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DOCS_FACTS } from "@/content/docs-facts";
import { FACTS } from "@/content/facts";
import { parseDeployments } from "@/lib/docs/docs-data";
import { enumMembers, readRepo } from "./helpers/solidity";

const PAGE = "web/content/docs/guides/verify-by-hand.mdx";
const TYPES = "contracts/src/Types.sol";
const SECTION = "### Read the owner, the executor and the mandate";

interface Row {
  readonly field: string;
  /** The "Read from the vault" cell, without its backticks. */
  readonly vault: string;
  /** The "Reads as" cell. */
  readonly readsAs: string;
}

/** The text of the page's command 2 step: from its heading to the next heading of the same level. */
function section(source: string): string {
  const start = source.indexOf(SECTION);
  if (start < 0) throw new Error(`${PAGE} has no "${SECTION}"`);
  const rest = source.slice(start + SECTION.length);
  const end = rest.search(/^### /m);
  return end < 0 ? rest : rest.slice(0, end);
}

/** The mandate table of command 2: one row per field, as the page writes it. */
function mandateRows(source: string): Row[] {
  return [...section(source).matchAll(/^\| `(\w+)` \| `([^`]+)` \| (.*) \|$/gm)].map((m) => ({
    field: m[1] ?? "",
    vault: m[2] ?? "",
    readsAs: m[3] ?? "",
  }));
}

/** The mandate lines of command 2's output: every line after the owner and the executor, without cast's [9e4] note. */
function mandateOutput(source: string): string[] {
  const block = /^```text\n([\s\S]*?)^```$/m.exec(section(source))?.[1];
  if (block === undefined) throw new Error(`${PAGE}: command 2 shows no output`);
  return block
    .trimEnd()
    .split("\n")
    .slice(2)
    .map((l) => l.replace(/ \[[^\]]*\]$/, ""));
}

/** The field names of Types.sol's Mandate struct, in their order. */
function structFields(types: string): string[] {
  const body = /struct Mandate \{([\s\S]*?)\n\}/.exec(types)?.[1];
  if (body === undefined) throw new Error(`${TYPES} has no struct Mandate`);
  return [...body.replace(/\/\/[^\n]*/g, "").matchAll(/^\s*\w+\s+(\w+);/gm)].map((m) => m[1] ?? "");
}

/** "1.5" with 18 decimals is "1500000000000000000": a decimal number in the raw units the vault stores. */
function scaled(value: number, decimals: number): string {
  const [whole = "", fraction = ""] = String(value).split(".");
  if (fraction.length > decimals) throw new Error(`${value} has more than ${decimals} decimals`);
  return BigInt(whole + fraction.padEnd(decimals, "0")).toString();
}

/** WAD, the 18-decimal fixed point of the health factors (Types.sol). */
const WAD_DECIMALS = 18;

/** The repository's default mandate field `key` (FACTS.mandate) as `cast call ... mandate()` prints it. */
function defaultRaw(key: string, types: string): string {
  const m = FACTS.mandate.value;
  switch (key) {
    case "sessionMode":
      return String(enumMembers(types, "SessionMode").indexOf(m.sessionMode));
    case "perTradeCapUsd":
    case "dailyCapUsd":
      return scaled(m[key], DOCS_FACTS.usdcDecimals.value);
    case "minHealthFactor":
    case "targetHealthFactor":
      return scaled(m[key], WAD_DECIMALS);
    case "maxStalenessSec":
    case "maxPremiumBps":
    case "maxSlippageBps":
    case "twapWindowSec":
    case "multiplierCooldownSec":
    case "deriskWindowSec":
      return String(m[key]);
    default:
      throw new Error(`no raw form for mandate.${key}`);
  }
}

/**
 * Where the page's mandate table disagrees with command 2's output, with the repository's default mandate in its
 * Reads as column, or with the deployments table for the three addresses. Empty when the page holds together.
 */
function mandateProblems(source: string, types: string, deploymentsReadme: string): string[] {
  const rows = mandateRows(source);
  const output = mandateOutput(source);
  const deployments = parseDeployments(deploymentsReadme);
  const problems: string[] = [];
  const fields = structFields(types);
  if (rows.map((r) => r.field).join(",") !== fields.join(",")) {
    problems.push(`table fields ${rows.map((r) => r.field).join(",")} are not Mandate's ${fields.join(",")}`);
  }
  if (output.length !== rows.length) problems.push(`command 2 prints ${output.length} mandate lines, the table has ${rows.length} rows`);
  rows.forEach((r, i) => {
    const printed = output[i] ?? "";
    const [head = "", tail] = r.vault.split("...");
    const matches = tail === undefined ? printed === r.vault : printed.startsWith(head) && printed.endsWith(tail);
    if (!matches) problems.push(`${r.field}: the table reads ${r.vault}, command 2 prints ${printed}`);
    const fact = /<Fact name="mandate\.(\w+)" \/>/.exec(r.readsAs)?.[1];
    if (fact !== undefined) {
      const want = defaultRaw(fact, types);
      if (r.vault !== want) problems.push(`${r.field}: the vault value ${r.vault} is not the default mandate's ${want}`);
    }
    const contract = /^The `(\w+)` row/.exec(r.readsAs)?.[1];
    if (contract !== undefined) {
      const address = deployments.find((d) => d.contract === contract)?.address;
      if (address?.toLowerCase() !== printed.toLowerCase()) problems.push(`${r.field}: command 2 prints ${printed}, the ${contract} row holds ${address}`);
    }
  });
  return problems;
}

describe("Verify Maat by hand: the mandate the vault returned (command 2)", () => {
  const page = readRepo(PAGE).replace(/\r\n/g, "\n");
  const types = readRepo(TYPES);
  const deployments = readRepo("deployments/README.md");

  it("reads a table row for each Mandate field and the fourteen output lines that go with them", () => {
    expect(mandateRows(page)).toHaveLength(structFields(types).length);
    expect(mandateOutput(page)).toHaveLength(structFields(types).length);
    expect(mandateRows(page).filter((r) => r.readsAs.includes('<Fact name="mandate.'))).toHaveLength(11);
    expect(mandateRows(page).filter((r) => /^The `\w+` row/.test(r.readsAs))).toHaveLength(3);
  });

  it("shows, next to each default it renders, the value command 2 printed, which equals that default", () => {
    expect(mandateProblems(page, types, deployments)).toEqual([]);
  });

  it("fails once the default mandate and the value read from the vault differ, or the table and the output", () => {
    const table = page.replace("| `maxSlippageBps` | `150` |", "| `maxSlippageBps` | `151` |");
    expect(mandateProblems(table, types, deployments)).toEqual([
      "maxSlippageBps: the table reads 151, command 2 prints 150",
      "maxSlippageBps: the vault value 151 is not the default mandate's 150",
    ]);
    const output = page.replace("\n1800\n", "\n1801\n");
    expect(mandateProblems(output, types, deployments)).toEqual(["twapWindow: the table reads 1800, command 2 prints 1801"]);
    const adapter = page.replace("0x45dEA6BBeD30c120794115FeC8b01C346564aB2C\n", "0x45dEA6BB00000000000000000000000000aB2C\n");
    expect(mandateProblems(adapter, types, deployments)).toEqual([
      "creditAdapter: command 2 prints 0x45dEA6BB00000000000000000000000000aB2C, the AaveV4CreditAdapter row holds 0x45dEA6BBeD30c120794115FeC8b01C346564aB2C",
    ]);
  });
});
