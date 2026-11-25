import { readFileSync } from "node:fs";
import { join } from "node:path";
import { encodeFunctionData, hexToString, keccak256, toBytes, toHex, zeroAddress, type Address, type Hash, type Hex } from "viem";
import { vaultAbi } from "../../lib/chain/abi";

// The test vectors of the maat:v1 spec, read from the spec itself so the tests and the e2e specs cannot drift from it.
// Only the vectors are read here; every other fixture is built from them.

// Vitest and Playwright both run from web/, which is how the jsdom tests find files too (import.meta.url is not a file
// URL under jsdom).
const REPO_ROOT = join(process.cwd(), "..");
export const SPEC_PATH = "docs/superpowers/specs/2026-11-25-maat-v1-rationale-blob-design.md";
const spec = readFileSync(join(REPO_ROOT, SPEC_PATH), "utf8").replace(/\r\n/g, "\n");

export type VectorName = "V1" | "V2" | "V3" | "V4" | "V5";

export interface Vector {
  /** The blob, as ASCII text. */
  blob: string;
  /** Its byte count, from the spec's table. */
  bytes: number;
  /** keccak256 of the blob, from the spec's table. */
  hash: Hash;
}

function vector(name: VectorName): Vector {
  const hex = new RegExp(`^${name} hex: \`(0x[0-9a-f]+)\`$`, "m").exec(spec)?.[1];
  const row = new RegExp(`^\\| ${name} [^|]*\\|[^|]*\\| (\\d+) \\| \`(0x[0-9a-f]{64})\` \\|$`, "m").exec(spec);
  if (!hex || !row) throw new Error(`${SPEC_PATH} has no ${name} vector`);
  return { blob: hexToString(hex as Hex), bytes: Number(row[1]), hash: row[2] as Hash };
}

export const VECTORS: Readonly<Record<VectorName, Vector>> = {
  V1: vector("V1"),
  V2: vector("V2"),
  V3: vector("V3"),
  V4: vector("V4"),
  V5: vector("V5"),
};

/** The two published journal lines of §5.7, and the hash the spec gives for each. */
export const JOURNAL_LINES: readonly string[] = (() => {
  const section = spec.slice(spec.indexOf("### 5.7 Journal"));
  const block = /```\n([\s\S]*?)\n```/.exec(section)?.[1];
  if (!block) throw new Error(`${SPEC_PATH} has no §5.7 journal lines`);
  return block.split("\n");
})();
export const JOURNAL_HASHES: readonly Hash[] = [1, 2].map((n) => {
  const h = new RegExp(`\`hash\` of line ${n}: \`(0x[0-9a-f]{64})\``).exec(spec)?.[1];
  if (!h) throw new Error(`${SPEC_PATH} gives no hash for journal line ${n}`);
  return h as Hash;
});

/** NVDAc on Base (contracts/script/BaseAddresses.sol), the token of the §5.6 intent. */
export const NVDAC_TOKEN: Address = "0xb20000000000000000000078ee7ce2fE4908108C";
/** The Builder Code of §5.6, a value made up for the spec. */
export const SPEC_CODE = "fake_code";
/** The agent's builderCode test code, which is not Maat's, and the 29-byte suffix that test expects for it. */
export const AGENT_TEST_CODE = "bc_a1b2c3d4";
export const AGENT_TEST_SUFFIX: Hex = "0x62635f61316232633364340b0080218021802180218021802180218021";

/** The ERC-8021 schema-0 suffix: codes, their byte count, schema id 0x00, the 16-byte marker (spec §1). */
export function erc8021Suffix(codes: readonly string[]): Hex {
  const joined = toHex(codes.join(","));
  const n = (joined.length - 2) / 2;
  return `${joined}${n.toString(16).padStart(2, "0")}00${"8021".repeat(8)}` as Hex;
}

/** `execute(intent)` calldata, 228 bytes: the §5.6 intent unless overridden. */
export function executeCalldata(opts: { rationaleHash: Hash; id?: Hash; amount?: bigint }): Hex {
  return encodeFunctionData({
    abi: vaultAbi,
    functionName: "execute",
    args: [
      {
        id: opts.id ?? keccak256(toBytes("spec-example")),
        action: 0,
        token: NVDAC_TOKEN,
        amount: opts.amount ?? 5_000_000n,
        minOut: 0n,
        payee: zeroAddress,
        rationaleHash: opts.rationaleHash,
      },
    ],
  });
}

/**
 * A full transaction input: `execute(intent)` ‖ blob ‖ suffix. The intent commits to keccak256 of the blob unless
 * `rationaleHash` says otherwise; `code: null` leaves the suffix out.
 */
export function txInput(blob: string, opts: { code?: string | null; rationaleHash?: Hash; id?: Hash } = {}): Hex {
  const rationaleHash = opts.rationaleHash ?? keccak256(toBytes(blob));
  const code = opts.code === undefined ? SPEC_CODE : opts.code;
  const suffix = code === null ? "" : erc8021Suffix([code]).slice(2);
  return `${executeCalldata({ rationaleHash, id: opts.id })}${toHex(blob).slice(2)}${suffix}` as Hex;
}
