import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
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

export interface BaseConstant {
  readonly name: string;
  readonly type: "address" | "uint256";
  readonly value: string;
  readonly note: string;
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

/** `/// note` lines directly above each `address|uint256 internal constant NAME = value;`. */
export function parseBaseAddresses(text: string): BaseConstant[] {
  const out: BaseConstant[] = [];
  let note: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("///")) {
      note.push(line.slice(3).replace(/^\s*@notice\s+/, "").trim());
      continue;
    }
    const m = /^(address|uint256) internal constant (\w+) = ([^;]+);/.exec(line);
    if (m?.[1] && m[2] && m[3]) {
      out.push({ name: m[2], type: m[1] as BaseConstant["type"], value: m[3].trim(), note: note.join(" ") });
    }
    note = [];
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

/** JSON as committed: two-space indent and a trailing newline, so the sync test compares text exactly. */
export function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
