import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DEPLOYMENT_HEAD, DEPLOYMENTS_FILE } from "./reference-labels";
import { buildSurface, type SolSource, type SolSurface } from "./sol-surface";

/** Maat's own contracts and interfaces; third-party interfaces (Aave, Chainlink, B20, ERC-20) are left out. */
export const DOCUMENTED_CONTRACTS = [
  "MandateVault",
  "IMandateVaultEvents",
  "MarketCalendar",
  "ISwapAdapter",
  "AerodromeSwapAdapter",
  "ICreditAdapter",
  "AaveV4CreditAdapter",
] as const;

const TYPES_FILE = "contracts/src/Types.sol";
const ADDRESSES_FILE = "contracts/script/BaseAddresses.sol";

/** The ABIs the agent compiled with `npm run gen:abi`; the docs publish some of them as /data/abi/<contract>.json. */
export const AGENT_ABI_FILE = "agent/src/abi/generated.ts";

/**
 * The ABIs the docs publish, by contract, each with its export in AGENT_ABI_FILE. Maat's own contracts only: the
 * third-party interfaces in that file (IB20Asset, IAggregatorV3, IERC20Minimal) are left out, and it holds no ABI for
 * the swap adapter.
 */
export const PUBLISHED_ABIS = {
  MandateVault: "mandateVaultAbi",
  ICreditAdapter: "creditAdapterAbi",
  MarketCalendar: "marketCalendarAbi",
} as const;

export type AbiName = keyof typeof PUBLISHED_ABIS;

export interface BaseConstant {
  readonly name: string;
  readonly type: "address" | "uint256";
  readonly value: string;
  /** The `///` block above this constant alone; empty when it has none. */
  readonly note: string;
  /** The `///` block above the run of constants this one belongs to; empty when it is in no group. */
  readonly group: string;
}

/** A row of the table in deployments/README.md. The owner fills in Address, Tx and Date after a deploy; until then they are empty. */
export interface Deployment {
  readonly network: string;
  readonly contract: string;
  readonly address: string;
  readonly tx: string;
  readonly date: string;
}

export interface AgentEnvVar {
  readonly name: string;
  /** The value in agent/.env.example: an example or an empty placeholder, never a secret. */
  readonly example: string;
  /** The `#` comment lines directly above it in agent/.env.example. */
  readonly note: string;
  /** "agent" when agent/src/config.ts validates it; "sdk" when a library (Anthropic, CDP) reads it itself. */
  readonly readBy: "agent" | "sdk";
  /** The default config.ts applies when it is unset or empty, as written in the source. */
  readonly default: string | null;
  /** config.ts rejects a missing value in every mode. */
  readonly required: boolean;
  /** config.ts's superRefine rejects a missing value when MAAT_MODE is "live" (it may be unset in dry-run). */
  readonly requiredInLive: boolean;
}

export interface AgentScript {
  readonly name: string;
  readonly command: string;
}

export interface AgentData {
  readonly env: readonly AgentEnvVar[];
  /** `npm run <name>` scripts in agent/package.json. */
  readonly scripts: readonly AgentScript[];
  /** Files in agent/scripts, run with tsx or by an npm script. */
  readonly scriptFiles: readonly string[];
}

export interface DocsData {
  readonly surface: SolSurface;
  readonly addresses: readonly BaseConstant[];
  readonly deployments: readonly Deployment[];
  readonly agent: AgentData;
}

/** agent/.env.example joined with how agent/src/config.ts treats each key. */
export function parseAgentEnv(envExample: string, configSource: string): AgentEnvVar[] {
  const out: AgentEnvVar[] = [];
  let note: string[] = [];
  for (const raw of envExample.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("#")) {
      note.push(line.slice(1).trim());
      continue;
    }
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m?.[1] !== undefined && m[2] !== undefined) {
      const decl = new RegExp(`^\\s*${m[1]}: (.+),\\s*$`, "m").exec(configSource)?.[1];
      const def = decl === undefined ? null : (/\.default\(("?)([^)"]*)\1\)/.exec(decl)?.[2] ?? null);
      out.push({
        name: m[1],
        example: m[2].trim(),
        note: note.join(" "),
        readBy: decl === undefined ? "sdk" : "agent",
        default: def,
        required: decl !== undefined && def === null && !decl.includes(".optional()"),
        requiredInLive: new RegExp(`MAAT_MODE === "live" && !v\\.${m[1]}\\b`).test(configSource),
      });
    }
    note = [];
  }
  return out;
}

function solFiles(root: string, dir: string): SolSource[] {
  return readdirSync(join(root, dir)).flatMap((f): SolSource[] => {
    const rel = `${dir}/${f}`;
    if (statSync(join(root, rel)).isDirectory()) return solFiles(root, rel);
    return f.endsWith(".sol") ? [{ file: rel, text: readFileSync(join(root, rel), "utf8") }] : [];
  });
}

/**
 * Every `address|uint256 internal constant NAME = value;`, with the `///` block above it. A block covers the run
 * of constants below it, which ends at a blank line, at any other line (the `library` line, `}`), or where a new
 * `///` block starts. Above a run of two or more constants the block is their group's comment, so the table can
 * show it once; above a single constant it is that constant's own note.
 */
export function parseBaseAddresses(text: string): BaseConstant[] {
  const out: BaseConstant[] = [];
  let comment: string[] = [];
  let run: Omit<BaseConstant, "note" | "group">[] = [];
  const close = () => {
    const block = comment.join(" ");
    const grouped = run.length > 1;
    for (const c of run) out.push({ ...c, note: grouped ? "" : block, group: grouped ? block : "" });
    comment = [];
    run = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("///")) {
      if (run.length > 0) close();
      comment.push(line.slice(3).replace(/^\s*@notice\s+/, "").trim());
      continue;
    }
    const m = /^(address|uint256) internal constant (\w+) = ([^;]+);/.exec(line);
    if (m?.[1] && m[2] && m[3]) {
      run.push({ name: m[2], type: m[1] as BaseConstant["type"], value: m[3].trim() });
      continue;
    }
    close();
  }
  close();
  return out;
}

/**
 * The rows of the first table in deployments/README.md, whose columns must be Network | Contract | Address | Tx | Date.
 * A cell is its text: a link gives its text, and code marks are dropped. The table ends at the first line that is not
 * a row; any later table is not read.
 */
export function parseDeployments(text: string): Deployment[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const isRow = (line: string) => line.trimStart().startsWith("|");
  const cells = (line: string) =>
    line
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) =>
        c
          .trim()
          .replace(/^\[([^\]]*)\]\([^)]*\)$/, "$1")
          .replace(/^`([^`]*)`$/, "$1"),
      );
  const start = lines.findIndex(isRow);
  if (start < 0) throw new Error(`${DEPLOYMENTS_FILE} has no table`);
  const head = cells(lines[start] ?? "");
  if (head.join(" | ") !== DEPLOYMENT_HEAD.join(" | ")) {
    throw new Error(`${DEPLOYMENTS_FILE}: the table's columns are ${head.join(" | ")}, not ${DEPLOYMENT_HEAD.join(" | ")}`);
  }
  const out: Deployment[] = [];
  // The row after the header is the |---| separator.
  for (const line of lines.slice(start + 2)) {
    if (!isRow(line)) break;
    const row = cells(line);
    if (row.length !== DEPLOYMENT_HEAD.length) {
      throw new Error(`${DEPLOYMENTS_FILE}: the row ${line.trim()} has ${row.length} cells, not ${DEPLOYMENT_HEAD.length}`);
    }
    const [network = "", contract = "", address = "", tx = "", date = ""] = row;
    out.push({ network, contract, address, tx, date });
  }
  return out;
}

/** Everything docs-gen writes, built from the repo at `root`. Pure apart from reading the sources. */
export function generateDocsData(root: string): DocsData {
  const read = (rel: string) => readFileSync(join(root, rel), "utf8");
  const full = buildSurface(solFiles(root, "contracts/src"));
  const keep = new Set<string>(DOCUMENTED_CONTRACTS);
  return {
    surface: {
      contracts: full.contracts.filter((c) => keep.has(c.name)),
      enums: full.enums.filter((e) => e.file === TYPES_FILE),
      structs: full.structs.filter((s) => s.file === TYPES_FILE),
    },
    addresses: parseBaseAddresses(read(ADDRESSES_FILE)),
    deployments: parseDeployments(read(DEPLOYMENTS_FILE)),
    agent: {
      env: parseAgentEnv(read("agent/.env.example"), read("agent/src/config.ts")),
      scripts: Object.entries(JSON.parse(read("agent/package.json")).scripts as Record<string, string>).map(
        ([name, command]) => ({ name, command }),
      ),
      scriptFiles: readdirSync(join(root, "agent/scripts"))
        .filter((f) => f.endsWith(".ts"))
        .sort(),
    },
  };
}

/**
 * The ABI behind each `export const <name> = [...] as const;` of agent/src/abi/generated.ts that PUBLISHED_ABIS names,
 * by contract. gen:abi writes each array as JSON, so it parses as JSON.
 */
export function parseAbis(generatedTs: string): Record<AbiName, unknown[]> {
  const text = generatedTs.replace(/\r\n/g, "\n");
  const out = {} as Record<AbiName, unknown[]>;
  for (const [contract, name] of Object.entries(PUBLISHED_ABIS) as [AbiName, string][]) {
    const head = `export const ${name} = `;
    const start = text.indexOf(head);
    if (start < 0) throw new Error(`${name} is not in ${AGENT_ABI_FILE} (run npm run gen:abi in agent/)`);
    out[contract] = JSON.parse(text.slice(start + head.length, text.indexOf(" as const;", start))) as unknown[];
  }
  return out;
}

/** The published ABIs, read from the repo at `root`, as docs-gen writes them to content/generated/abi.json. */
export function generateAbis(root: string): Record<AbiName, unknown[]> {
  return parseAbis(readFileSync(join(root, AGENT_ABI_FILE), "utf8"));
}

/** JSON as committed: two-space indent and a trailing newline, so the sync test compares text exactly. */
export function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
