// @vitest-environment node
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import { ABI_NAMES, abiFile, abiUrl } from "@/lib/docs/abi";
import { generateAbis, generateDocsData, parseAbis, parseAgentEnv, parseBaseAddresses, serialize } from "@/lib/docs/docs-data";
import { collectTestLines } from "@/lib/docs/remark-test-anchors";
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
      `struct Intent {
    bytes32 id;
}
struct Mandate {
    uint256 cap;
}
enum Reason {
    OK
}
contract V {
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

  it("returns a struct's members from a getter of a struct, leaving out arrays and mappings, but not from a declared function", () => {
    const s = buildSurface([
      {
        file: "contracts/src/X.sol",
        text: [
          "struct S {",
          "    uint a;",
          "    address b;",
          "    uint[] list;",
          "    mapping(address => bool) seen;",
          "}",
          "contract G {",
          "    mapping(address => S) public m;",
          "    function whole(address k) external view returns (S memory) {}",
          "}",
        ].join("\n"),
      },
    ]);
    const g = s.contracts.find((c) => c.name === "G");
    expect(g?.functions.find((f) => f.name === "m")?.returns).toEqual([
      { type: "uint", name: "a" },
      { type: "address", name: "b" },
    ]);
    expect(g?.functions.find((f) => f.name === "whole")?.returns).toEqual([{ type: "S", name: "" }]);
  });

  it("gives a contract the events of the interfaces it inherits and the errors of the libraries it uses", () => {
    const s = buildSurface([
      { file: "contracts/src/E.sol", text: "interface IE {\n    event Done(bytes32 indexed id, bool ok);\n}" },
      { file: "contracts/src/L.sol", text: "library L {\n    error TransferFailed(address token);\n    function f() internal {}\n}" },
      { file: "contracts/src/V.sol", text: "contract V is IE {\n    using L for address;\n    error NotOwner();\n}" },
    ]);
    const v = s.contracts.find((c) => c.name === "V");
    expect(v?.events).toEqual([
      {
        name: "Done",
        notice: "",
        params: [{ type: "bytes32", name: "id", indexed: true }, { type: "bool", name: "ok" }],
        topic0: keccak("Done(bytes32,bool)"),
      },
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

/** A parameter of the compiled ABI: a tuple names its fields in `components`. */
interface AbiParam {
  type: string;
  indexed?: boolean;
  components?: AbiParam[];
}

/** The ABI the agent compiled from the same sources (agent/src/abi/generated.ts, written by forge). */
function agentAbi(name: string): {
  type: string;
  name?: string;
  stateMutability?: string;
  inputs?: AbiParam[];
  outputs?: unknown[];
}[] {
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
      ...c.functions.map((f) => `function ${f.name}/${f.params.length}/${f.returns.length} ${f.mutability}`),
      ...c.events.map((e) => `event ${e.name}/${e.params.length} ${flags(e.params)}`),
      ...c.errors.map((e) => `error ${e.name}/${e.params.length}`),
    ].sort();
    const abi = agentAbi(abiName)
      .filter((e) => e.type !== "constructor")
      .map((e) => {
        const n = `${e.type} ${e.name}/${e.inputs?.length ?? 0}`;
        if (e.type === "function") return `function ${e.name}/${e.inputs?.length ?? 0}/${e.outputs?.length ?? 0} ${e.stateMutability}`;
        return e.type === "event" ? `${n} ${flags(e.inputs ?? [])}` : n;
      })
      .sort();
    expect(ours).toEqual(abi);
  });
});

const keccak = (text: string) => `0x${bytesToHex(keccak_256(utf8ToBytes(text)))}`;
/** The first four bytes of the hash: a function's or an error's selector. */
const selector = (text: string) => keccak(text).slice(0, 10);

describe("selectors and topic 0", () => {
  it("hashes the canonical signature: an enum as uint8, a contract or an interface as an address, a struct as the tuple of its fields", () => {
    const s = buildSurface([
      {
        file: "contracts/src/X.sol",
        text: [
          "enum Side {",
          "    BUY,",
          "    SELL",
          "}",
          "struct Inner {",
          "    uint a;",
          "    Side side;",
          "}",
          "struct Order {",
          "    Inner inner;",
          "    address[] list;",
          "}",
          "interface IPool {}",
          "contract V {",
          "    event Placed(Order indexed order, Side side);",
          "    error Bad(uint256 got, IPool pool);",
          "    mapping(address => mapping(uint256 => bool)) public seen;",
          "    function place(Order calldata order, IPool pool, Inner[] memory inners, bytes calldata data) external {}",
          "}",
        ].join("\n"),
      },
    ]);
    const v = s.contracts.find((c) => c.name === "V");
    expect(v?.functions.map((f) => [f.name, f.selector])).toEqual([
      ["place", selector("place(((uint256,uint8),address[]),address,(uint256,uint8)[],bytes)")],
      ["seen", selector("seen(address,uint256)")],
    ]);
    expect(v?.events.map((e) => e.topic0)).toEqual([keccak("Placed(((uint256,uint8),address[]),uint8)")]);
    expect(v?.errors.map((e) => e.selector)).toEqual([selector("Bad(uint256,address)")]);
  });

  it("fails on a parameter type it cannot encode, instead of hashing a wrong signature", () => {
    const text = "contract V {\n    function f(Unknown u) external {}\n}";
    expect(() => buildSurface([{ file: "contracts/src/V.sol", text }])).toThrow("V.f: cannot encode the type Unknown");
  });

  it("fails on an anonymous event, whose logs carry no topic 0", () => {
    const text = "contract V {\n    event Quiet(uint256 a) anonymous;\n}";
    expect(() => buildSurface([{ file: "contracts/src/V.sol", text }])).toThrow("V.Quiet: an anonymous event has no topic 0");
  });

  it("gives the values computed independently with viem and cast", () => {
    const vault = generateDocsData(REPO_ROOT).surface.contracts.find((c) => c.name === "MandateVault");
    const fn = (name: string) => vault?.functions.find((f) => f.name === name)?.selector;
    const err = (contract: string, name: string) =>
      generateDocsData(REPO_ROOT)
        .surface.contracts.find((c) => c.name === contract)
        ?.errors.find((e) => e.name === name)?.selector;
    const topic = (name: string) => vault?.events.find((e) => e.name === name)?.topic0;
    expect(fn("execute")).toBe("0x4ad3993f");
    expect(fn("previewIntent")).toBe("0x0ee774db");
    expect(err("MandateVault", "NotExecutor")).toBe("0xc32d1d76");
    expect(err("MandateVault", "IntentAlreadyUsed")).toBe("0xb256356e");
    expect(err("MandateVault", "NotOwner")).toBe("0x30cd7471");
    expect(err("MandateVault", "InvalidConfig")).toBe("0x35be3ac8");
    expect(err("MandateVault", "ChangeNotQueued")).toBe("0x8b2bb7d5");
    expect(err("MandateVault", "ChangeNotReady")).toBe("0x2b169f55");
    expect(err("MandateVault", "ChangeExpired")).toBe("0x051a48c0");
    expect(err("ICreditAdapter", "HealthFactorTooLow")).toBe("0x7e7222b7");
    expect(err("AerodromeSwapAdapter", "InsufficientOutput")).toBe("0x2c19b8b8");
    expect(topic("Decision")).toBe("0x31e6f801fe8c4e61fff662a75a05831c8f1341359c56a18463b2a33bfa2df322");
    // The two queue events whose topic 0 guides/watch-decisions-onchain prints.
    expect(topic("MandateChangeQueued")).toBe("0x7fa3c0bb17162e829120b28266b7550061c3b40db9435802b3b81b4be2f1d4b1");
    expect(topic("TokenConfigChangeQueued")).toBe("0x52c7e79abff67f340ea03b262ee706f9f7b59fd984c52ae45155eaef031057d9");
  });

  /** A parameter's type as the compiled ABI encodes it: a tuple is its components in brackets. */
  const abiType = (p: AbiParam): string => (p.type.startsWith("tuple") ? `(${(p.components ?? []).map(abiType).join(",")})${p.type.slice(5)}` : p.type);

  it.each([
    ["MandateVault", "mandateVaultAbi"],
    ["MarketCalendar", "marketCalendarAbi"],
    ["ICreditAdapter", "creditAdapterAbi"],
  ])("%s has the selector and the topic 0 of every function, error and event in the compiled ABI", (contract, abiName) => {
    const c = generateDocsData(REPO_ROOT).surface.contracts.find((k) => k.name === contract);
    if (!c) throw new Error(`${contract} missing from the generated surface`);
    const ours = [
      ...c.functions.map((f) => `function ${f.name} ${f.selector}`),
      ...c.events.map((e) => `event ${e.name} ${e.topic0}`),
      ...c.errors.map((e) => `error ${e.name} ${e.selector}`),
    ].sort();
    const abi = agentAbi(abiName)
      .filter((e) => e.type !== "constructor")
      .map((e) => {
        const hash = keccak(`${e.name}(${(e.inputs ?? []).map(abiType).join(",")})`);
        return `${e.type} ${e.name} ${e.type === "event" ? hash : hash.slice(0, 10)}`;
      })
      .sort();
    expect(ours).toEqual(abi);
  });
});

describe("the published ABIs", () => {
  it.each([
    ["MandateVault", "mandateVaultAbi"],
    ["ICreditAdapter", "creditAdapterAbi"],
    ["MarketCalendar", "marketCalendarAbi"],
  ] as const)("%s.json is {source, note, abi}, with exactly %s from agent/src/abi/generated.ts", (name, abiName) => {
    const file = abiFile(name);
    expect(Object.keys(file)).toEqual(["source", "note", "abi"]);
    expect(file.abi).toEqual(agentAbi(abiName));
    expect(file.source).toBe(
      `${abiName} in agent/src/abi/generated.ts (https://github.com/duongnq2798/maat/blob/main/agent/src/abi/generated.ts), which npm run gen:abi in agent/ generates from the compiled contracts in contracts/out.`,
    );
    expect(file.note).toBe("ABI of contracts that are built and fork-tested, not deployed. The contracts are unaudited.");
    expect(abiUrl(name)).toBe(`/data/abi/${name}.json`);
  });

  it("publishes Maat's own contracts only: no third-party interface, and no swap adapter, which generated.ts does not hold", () => {
    expect(ABI_NAMES).toEqual(["MandateVault", "ICreditAdapter", "MarketCalendar"]);
    expect(Object.keys(parseAbis(readRepo("agent/src/abi/generated.ts")))).toEqual(["MandateVault", "ICreditAdapter", "MarketCalendar"]);
  });

  it("reads the ABIs the same from a CRLF checkout", () => {
    const lf = readRepo("agent/src/abi/generated.ts").replace(/\r\n/g, "\n");
    expect(parseAbis(lf.replace(/\n/g, "\r\n"))).toEqual(parseAbis(lf));
  });

  it("fails when generated.ts lacks an ABI it publishes", () => {
    expect(() => parseAbis("export const erc20Abi = [] as const;\n")).toThrow(/mandateVaultAbi is not in agent\/src\/abi\/generated\.ts/);
  });
});

describe("committed data is current", () => {
  const data = generateDocsData(REPO_ROOT);
  it.each([
    ["web/content/generated/contracts.json", data.surface],
    ["web/content/generated/base-addresses.json", data.addresses],
    ["web/content/generated/agent.json", data.agent],
    // The ABIs that /data/abi/*.json publish: the build reads this copy, never agent/ (spec §5.3).
    ["web/content/generated/abi.json", generateAbis(REPO_ROOT)],
    // A test that moves changes its line, so the links that remarkTestAnchors points at it need a regeneration too.
    ["web/content/generated/tests.json", collectTestLines(REPO_ROOT)],
  ] as const)("%s matches the sources (run `npm run docs:gen` in web/ if this fails)", (file, value) => {
    expect(readRepo(file).replace(/\r\n/g, "\n")).toBe(serialize(value));
  });
});

describe("the test lines of the repo", () => {
  const tests = collectTestLines(REPO_ROOT);

  it("finds test_replayReverts on the line of MandateVault.t.sol that defines it", () => {
    const lines = readRepo("contracts/test/MandateVault.t.sol").split(/\r?\n/);
    const defined = lines.findIndex((l) => l.includes("function test_replayReverts(")) + 1;
    expect(defined).toBeGreaterThan(0);
    expect(tests["contracts/test/MandateVault.t.sol"]?.test_replayReverts).toBe(defined);
  });

  it("finds a Vitest title on the line of its it() call", () => {
    const lines = readRepo("agent/test/runOnce.test.ts").split(/\r?\n/);
    const title = "halts when the preview said OK but the vault refused";
    expect(lines[(tests["agent/test/runOnce.test.ts"]?.[title] ?? 0) - 1]).toContain(`it("${title}"`);
  });

  it("covers both test folders", () => {
    const files = Object.keys(tests);
    expect(files.some((f) => f.startsWith("contracts/test/fork/"))).toBe(true);
    expect(files.some((f) => f.startsWith("agent/test/integration/"))).toBe(true);
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
    "  .superRefine((v, ctx) => {",
    '    if (v.MAAT_MODE === "live" && !v.MAAT_BUILDER_CODE) {',
    '      ctx.addIssue({ code: "custom", path: ["MAAT_BUILDER_CODE"], message: "MAAT_BUILDER_CODE is required in live mode" });',
    "    }",
    "  });",
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

  it("marks a setting that the superRefine requires in live mode, and no other", () => {
    expect(
      parseAgentEnv(example, config)
        .filter((v) => v.requiredInLive)
        .map((v) => v.name),
    ).toEqual(["MAAT_BUILDER_CODE"]);
    expect(parseAgentEnv(example, config.replace(/MAAT_MODE === "live" && !v\.MAAT_BUILDER_CODE/, "false")).some((v) => v.requiredInLive)).toBe(false);
  });

  it("marks MAAT_BUILDER_CODE as required in live mode in the committed agent data", () => {
    const live = generateDocsData(REPO_ROOT).agent.env.filter((v) => v.requiredInLive);
    expect(live.map((v) => v.name)).toEqual(["MAAT_BUILDER_CODE"]);
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
  it("gives a block above several constants to their group, and a block above one constant to that constant", () => {
    const parsed = parseBaseAddresses(
      "/// @notice Library header.\nlibrary B {\n    /// Pools, token0 = USDC.\n    address internal constant POOL_A = 0xAbC;\n    address internal constant POOL_B = 0xDeF;\n\n    uint256 internal constant BLOCK = 53_551_627;\n    /// Session block.\n    uint256 internal constant SESSION = 2;\n    /// Weekend block.\n    uint256 internal constant WEEKEND = 1;\n}",
    );
    expect(parsed).toEqual([
      { name: "POOL_A", type: "address", value: "0xAbC", note: "", group: "Pools, token0 = USDC." },
      { name: "POOL_B", type: "address", value: "0xDeF", note: "", group: "Pools, token0 = USDC." },
      { name: "BLOCK", type: "uint256", value: "53_551_627", note: "", group: "" },
      { name: "SESSION", type: "uint256", value: "2", note: "Session block.", group: "" },
      { name: "WEEKEND", type: "uint256", value: "1", note: "Weekend block.", group: "" },
    ]);
  });

  it("reads BaseAddresses.sol's two group comments once each, and gives the fork blocks their own notes", () => {
    const parsed = generateDocsData(REPO_ROOT).addresses;
    const groups = [...new Set(parsed.map((a) => a.group).filter(Boolean))];
    expect(groups.map((g) => g.split(" ").slice(0, 3).join(" "))).toEqual(["Aerodrome Slipstream pools,", "Aave V4 Equities"]);
    expect(parsed.filter((a) => a.group !== "").every((a) => a.note === "")).toBe(true);
    expect(parsed.filter((a) => a.note !== "").map((a) => a.name)).toEqual(["BLOCK_SESSION", "BLOCK_WEEKEND"]);
  });
});
