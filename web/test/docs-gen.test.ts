// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateDocsData, parseAgentEnv, parseBaseAddresses, serialize } from "@/lib/docs/docs-data";
import { buildSurface, type SolContract } from "@/lib/docs/sol-surface";
import { readRepo, REPO_ROOT } from "./helpers/solidity";

const one = (text: string, name: string): SolContract => {
  const c = buildSurface([{ file: "contracts/src/X.sol", text }]).contracts.find((k) => k.name === name);
  if (!c) throw new Error(`no ${name}`);
  return c;
};

describe("buildSurface", () => {
  it("keeps external and public functions with their access, mutability, params, returns and notice", () => {
    const c = one(
      `contract V {
    address public immutable owner;
    modifier onlyOwner() { if (msg.sender != owner) revert(); _; }
    /// @notice Pauses it.
    /// @dev Not shown.
    function setPaused(bool p) external onlyOwner { paused = p; }
    function run(Intent calldata intent) external returns (bool allowed, Reason reason) {
        if (msg.sender != executor) revert NotExecutor();
    }
    function hash(Mandate memory m) public pure returns (bytes32) { return 0; }
    function _internal() internal view returns (uint256) { return 1; }
}`,
      "V",
    );
    expect(c.functions.map((f) => [f.name, f.kind, f.visibility, f.access, f.mutability])).toEqual([
      ["hash", "function", "public", "anyone", "pure"],
      ["owner", "getter", "public", "anyone", "view"],
      ["run", "function", "external", "executor", "nonpayable"],
      ["setPaused", "function", "external", "owner", "nonpayable"],
    ]);
    const run = c.functions.find((f) => f.name === "run");
    expect(run?.params).toEqual([{ type: "Intent", name: "intent" }]);
    expect(run?.returns).toEqual([
      { type: "bool", name: "allowed" },
      { type: "Reason", name: "reason" },
    ]);
    expect(c.functions.find((f) => f.name === "setPaused")?.notice).toBe("Pauses it.");
  });

  it("reads a guard that also rejects address(0) as one caller, and never reads `&&` as a single role", () => {
    const c = one(
      `contract P {
    function callback() external {
        if (msg.sender != _activePool || msg.sender == address(0)) revert BadCallback();
    }
    function either() external {
        if (msg.sender != a && msg.sender != b) revert NotAllowed();
    }
}`,
      "P",
    );
    expect(c.functions.map((f) => [f.name, f.access])).toEqual([
      ["callback", "activePool"],
      ["either", "anyone"],
    ]);
  });

  it("turns public mappings, arrays and constants into getters, and reads `=>` as a type, not an initializer", () => {
    const c = one(
      `contract S {
    uint256 public constant TIMELOCK = 24 hours;
    mapping(uint256 utcDay => uint256) public spentOnDay;
    mapping(address => mapping(address => bool)) public allowed;
    address[] public list;
    uint256 internal hidden;
}`,
      "S",
    );
    expect(c.functions.map((f) => [f.name, f.params.map((p) => `${p.type} ${p.name}`.trim()), f.returns[0]?.type])).toEqual([
      ["allowed", ["address", "address"], "bool"],
      ["list", ["uint256"], "address"],
      ["spentOnDay", ["uint256 utcDay"], "uint256"],
      ["TIMELOCK", [], "uint256"],
    ]);
  });

  it("gives a contract the events of the interfaces it inherits and the errors of the libraries it uses", () => {
    const s = buildSurface([
      { file: "contracts/src/E.sol", text: "interface IE {\n    event Done(bytes32 indexed id, bool ok);\n}" },
      { file: "contracts/src/L.sol", text: "library L {\n    error TransferFailed(address token);\n    function f() internal {}\n}" },
      { file: "contracts/src/V.sol", text: "contract V is IE {\n    using L for address;\n    error NotOwner();\n}" },
    ]);
    const v = s.contracts.find((c) => c.name === "V");
    expect(v?.events).toEqual([
      { name: "Done", notice: "", params: [{ type: "bytes32", name: "id", indexed: true }, { type: "bool", name: "ok" }] },
    ]);
    expect(v?.errors.map((e) => e.name)).toEqual(["NotOwner", "TransferFailed"]);
    expect(s.contracts.map((c) => c.name)).toEqual(["IE", "V"]); // libraries are not listed
  });

  it("reads file-level enums and structs, ignoring comments", () => {
    const s = buildSurface([
      {
        file: "contracts/src/Types.sol",
        text: "enum Side {\n    BUY, // first\n    SELL\n}\n/// @notice An order.\nstruct Order {\n    Side side;\n    uint256 amount; // raw\n}",
      },
    ]);
    expect(s.enums).toEqual([{ name: "Side", file: "contracts/src/Types.sol", members: ["BUY", "SELL"] }]);
    expect(s.structs).toEqual([
      {
        name: "Order",
        file: "contracts/src/Types.sol",
        notice: "An order.",
        fields: [
          { type: "Side", name: "side" },
          { type: "uint256", name: "amount" },
        ],
      },
    ]);
  });

  it("gives the same surface for CRLF and LF checkouts", () => {
    const lf = { file: "contracts/src/V.sol", text: "contract V {\n    /// @notice Hi.\n    function f(uint256 a) external view returns (uint256) {}\n}" };
    const crlf = { ...lf, text: lf.text.replace(/\n/g, "\r\n") };
    expect(buildSurface([crlf])).toEqual(buildSurface([lf]));
  });
});

/** The ABI the agent compiled from the same sources (agent/src/abi/generated.ts, written by forge). */
function agentAbi(name: string): { type: string; name?: string; stateMutability?: string; inputs?: { indexed?: boolean }[] }[] {
  const src = readRepo("agent/src/abi/generated.ts");
  const start = src.indexOf(`export const ${name} = `);
  if (start < 0) throw new Error(`${name} not in agent/src/abi/generated.ts`);
  const json = src.slice(start + `export const ${name} = `.length, src.indexOf(" as const;", start));
  return JSON.parse(json);
}

describe("parity with the compiled ABI", () => {
  const data = generateDocsData(REPO_ROOT);
  it.each([
    ["MandateVault", "mandateVaultAbi"],
    ["MarketCalendar", "marketCalendarAbi"],
    ["ICreditAdapter", "creditAdapterAbi"],
  ])("%s has exactly the ABI's functions, events and errors", (contract, abiName) => {
    const c = data.surface.contracts.find((k) => k.name === contract);
    if (!c) throw new Error(`${contract} missing from the generated surface`);
    const flags = (ps: readonly { indexed?: boolean }[]) => ps.map((p) => (p.indexed ? "i" : "-")).join("");
    const ours = [
      ...c.functions.map((f) => `function ${f.name}/${f.params.length} ${f.mutability}`),
      ...c.events.map((e) => `event ${e.name}/${e.params.length} ${flags(e.params)}`),
      ...c.errors.map((e) => `error ${e.name}/${e.params.length}`),
    ].sort();
    const abi = agentAbi(abiName)
      .filter((e) => e.type !== "constructor")
      .map((e) => {
        const n = `${e.type} ${e.name}/${e.inputs?.length ?? 0}`;
        if (e.type === "function") return `${n} ${e.stateMutability}`;
        return e.type === "event" ? `${n} ${flags(e.inputs ?? [])}` : n;
      })
      .sort();
    expect(ours).toEqual(abi);
  });
});

describe("committed data is current", () => {
  const data = generateDocsData(REPO_ROOT);
  it.each([
    ["web/content/generated/contracts.json", data.surface],
    ["web/content/generated/base-addresses.json", data.addresses],
    ["web/content/generated/agent.json", data.agent],
  ] as const)("%s matches the sources (run `npm run docs:gen` in web/ if this fails)", (file, value) => {
    expect(readRepo(file).replace(/\r\n/g, "\n")).toBe(serialize(value));
  });
});

describe("parseAgentEnv", () => {
  const config = [
    "const schema = z",
    "  .object({",
    '    BASE_RPC_URL: field(z.string({ error: "BASE_RPC_URL is required" }).pipe(z.url())),',
    '    MAAT_VAULT: address("MAAT_VAULT"),',
    '    MAAT_MODE: field(z.enum(["dry-run", "live"]).default("dry-run")),',
    "    MAAT_BUILDER_CODE: field(z.string().min(1).optional()),",
    "    MAAT_MAX_TX_PER_DAY: field(z.coerce.number().int().positive().default(40)),",
    "  })",
  ].join("\n");
  const example = [
    "# RPC for Base mainnet.",
    "BASE_RPC_URL=https://mainnet.base.org",
    "MAAT_VAULT=0x0000000000000000000000000000000000000000",
    "# dry-run (default) or live.",
    "MAAT_MODE=dry-run",
    "MAAT_BUILDER_CODE=",
    "MAAT_MAX_TX_PER_DAY=40",
    "# Anthropic API key (the SDK reads it).",
    "ANTHROPIC_API_KEY=",
  ].join("\r\n");

  it("joins each example key with its comment and how config.ts treats it", () => {
    expect(parseAgentEnv(example, config).map((v) => [v.name, v.readBy, v.default, v.required, v.note])).toEqual([
      ["BASE_RPC_URL", "agent", null, true, "RPC for Base mainnet."],
      ["MAAT_VAULT", "agent", null, true, ""],
      ["MAAT_MODE", "agent", "dry-run", false, "dry-run (default) or live."],
      ["MAAT_BUILDER_CODE", "agent", null, false, ""],
      ["MAAT_MAX_TX_PER_DAY", "agent", "40", false, ""],
      ["ANTHROPIC_API_KEY", "sdk", null, false, "Anthropic API key (the SDK reads it)."],
    ]);
  });

  it("every key config.ts validates is in agent/.env.example", () => {
    const source = readRepo("agent/src/config.ts");
    const validated = [...source.matchAll(/^\s{4}([A-Z0-9_]+): /gm)].map((m) => m[1]);
    const documented = generateDocsData(REPO_ROOT).agent.env.map((v) => v.name);
    expect(validated.length).toBeGreaterThan(0);
    for (const name of validated) expect(documented, name).toContain(name);
  });
});

describe("parseBaseAddresses", () => {
  it("applies a note to every constant in its group", () => {
    const parsed = parseBaseAddresses(
      "library B {\n    /// Pools, token0 = USDC.\n    address internal constant POOL_A = 0xAbC;\n    address internal constant POOL_B = 0xDeF;\n\n    uint256 internal constant BLOCK = 53_551_627;\n    /// Weekend block.\n    uint256 internal constant WEEKEND = 1;\n}",
    );
    expect(parsed).toEqual([
      { name: "POOL_A", type: "address", value: "0xAbC", note: "Pools, token0 = USDC." },
      { name: "POOL_B", type: "address", value: "0xDeF", note: "Pools, token0 = USDC." },
      { name: "BLOCK", type: "uint256", value: "53_551_627", note: "" },
      { name: "WEEKEND", type: "uint256", value: "1", note: "Weekend block." },
    ]);
  });
});
