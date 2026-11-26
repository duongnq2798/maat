import { readFileSync } from "node:fs";
import { Attribution } from "ox/erc8021";
import { concat, decodeFunctionData, getAddress, size, slice, zeroAddress, type Hex } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildFirstDecision,
  DECISION_TOPIC,
  InputError,
  main,
  RUN_ID_PREFIX,
  type FirstDecisionInput,
} from "../scripts/first-decision.js";
import { mandateVaultAbi } from "../src/abi/index.js";
import { addressOf, BASKET } from "../src/addresses.js";
import { readVaultState } from "../src/chain/state.js";
import { builderSuffix, codesIn } from "../src/exec/builderCode.js";
import { EXECUTE_GAS_FLOOR, encodeExecute } from "../src/exec/calls.js";
import { GuardedSender } from "../src/exec/sender.js";
import { buildIntent, intentId, rationaleHash } from "../src/intent.js";
import { GENESIS } from "../src/rationale/blob.js";
import { decodeExecuteInput } from "../src/rationale/calldata.js";
import { VAULT, standardScene } from "./fakes/fakeChain.js";
import { FakeSender } from "./fakes/fakeSender.js";

const CODE = "bc_a1b2c3d4";
const SUFFIX = Attribution.toDataSuffix({ codes: [CODE] }) as Hex;
const base: FirstDecisionInput = { vault: VAULT, token: "NVDAc", builderCode: CODE, salt: "sat-1" };
const build = (over: Partial<FirstDecisionInput> = {}) => buildFirstDecision({ ...base, ...over });
const withoutSuffix = (data: Hex) => slice(data, 0, size(data) - size(SUFFIX));
const ARGV = ["--vault", VAULT, "--token", "NVDAc", "--salt", "sat-1", "--builder-code", CODE];

function run(argv: readonly string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = main(argv, (s) => out.push(s), (s) => err.push(s));
  return { code, out: out.join("\n"), err: err.join("\n") };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("first-decision execute calldata", () => {
  it("decodes against the MandateVault ABI to every Intent field", () => {
    const d = build();
    const call = decodeFunctionData({ abi: mandateVaultAbi, data: withoutSuffix(d.executeCalldata) });
    expect(call.functionName).toBe("execute");
    expect(call.args).toEqual([
      {
        id: intentId(`${RUN_ID_PREFIX}sat-1`, 0),
        action: 0,
        token: addressOf("NVDAc"),
        amount: 5_000_000n,
        minOut: 0n,
        payee: zeroAddress,
        rationaleHash: rationaleHash("Owner-sent first decision: BUY 5 USD of NVDAc"),
      },
    ]);
  });

  it("ends with exactly the ERC-8021 suffix of the code, and without it is plain execute calldata", () => {
    const d = build();
    expect(d.suffix).toBe(SUFFIX);
    expect(slice(d.executeCalldata, size(d.executeCalldata) - size(SUFFIX))).toBe(SUFFIX);
    expect(withoutSuffix(d.executeCalldata)).toBe(encodeExecute(d.intent));
    expect(decodeFunctionData({ abi: mandateVaultAbi, data: withoutSuffix(d.executeCalldata) }).args).toEqual([d.intent]);
    expect(codesIn(d.executeCalldata)).toEqual([CODE]);
    expect(d.codesInCalldata).toEqual([CODE]);
    expect(codesIn(withoutSuffix(d.executeCalldata))).toEqual([]);
  });

  it("is the execute call and the agent's Builder Code suffix with no blob between them, as the two owner Decisions are", () => {
    const d = build();
    expect(d.executeCalldata).toBe(concat([encodeExecute(d.intent), builderSuffix(CODE)]));
    expect(decodeExecuteInput(d.executeCalldata)).toMatchObject({ status: "none", codes: [CODE], rationaleHash: rationaleHash(d.rationale) });
    // The agent never sends that: every execute through its GuardedSender carries the maat:v1 blob.
    const guarded = new GuardedSender(new FakeSender(), { vault: d.vault, suffix: builderSuffix(CODE) });
    expect(() => guarded.calldata({ to: d.vault, data: encodeExecute(d.intent) })).toThrow(/execute needs a maat:v1 blob/);
  });

  it.each(BASKET.map((t) => t.symbol))("matches the intent the agent's buildIntent makes for a 5 USD %s BUY, but for the hash", async (symbol) => {
    const d = build({ token: symbol });
    const state = await readVaultState(standardScene().client(), VAULT);
    const b = buildIntent(
      { action: "BUY", symbol, amountUsd: 5, rationale: d.rationale },
      state,
      { runId: `${RUN_ID_PREFIX}sat-1`, index: 0, expensePayee: zeroAddress, blob: { c: "unknown", j: GENESIS, m: "fixed" } },
    );
    if (!b.ok) throw new Error(b.error);
    // The owner's intent commits to its plain text; the agent's commits to its blob.
    expect({ ...b.intent, rationaleHash: d.intent.rationaleHash }).toEqual(d.intent);
    expect(d.intent.rationaleHash).toBe(rationaleHash(d.rationale));
    expect(b.intent.rationaleHash).toBe(b.blob.hash);
  });
});

describe("first-decision previewIntent calldata", () => {
  it("encodes the same intent, with no suffix", () => {
    const d = build();
    const call = decodeFunctionData({ abi: mandateVaultAbi, data: d.previewCalldata });
    expect(call.functionName).toBe("previewIntent");
    expect(call.args).toEqual([d.intent]);
    expect(codesIn(d.previewCalldata)).toEqual([]);
  });
});

describe("first-decision inputs", () => {
  it("resolves each basket token to its address in src/addresses.ts, in any letter case", () => {
    for (const t of BASKET) {
      expect(build({ token: t.symbol }).intent.token).toBe(getAddress(t.address));
      expect(build({ token: t.symbol.toLowerCase() }).symbol).toBe(t.symbol);
    }
  });

  it("defaults to 5 USD and takes up to 6 decimals", () => {
    expect(build().intent.amount).toBe(5_000_000n);
    expect(build({ usd: "12.5" }).intent.amount).toBe(12_500_000n);
    expect(build({ usd: "0.000001" }).intent.amount).toBe(1n);
  });

  it("encodes the amount exactly as typed, up to 9 digits before the point", () => {
    expect(build({ usd: "999999999.999999" }).intent.amount).toBe(999_999_999_999_999n);
    expect(build({ usd: "123456789.123457" }).intent.amount).toBe(123_456_789_123_457n);
  });

  it("checksums the vault address", () => {
    expect(build({ vault: "0xb20000000000000000000078ee7ce2fe4908108c" }).vault).toBe("0xb20000000000000000000078ee7ce2fE4908108C");
  });

  it.each(["BC_UPPER", "", "a".repeat(33), "bc_a,b", "bc-dash"])("rejects the builder code %j", (builderCode) => {
    expect(() => build({ builderCode })).toThrow(InputError);
    expect(() => build({ builderCode })).toThrow(/--builder-code/);
  });

  it.each(["0x6d6161745f66616b65", "0xdeadbeef", "0x"])("refuses the hex form %j of a builder code, which the pattern alone lets through", (builderCode) => {
    expect(() => build({ builderCode })).toThrow(InputError);
    expect(() => build({ builderCode })).toThrow(/is a hex form; give the code exactly as Base Dashboard shows it \(deployments\/go-live\.md step 2, item 3\)/);
  });

  it.each(["TSLAc", "USDC", "NVDA", ""])("rejects the token %j", (token) => {
    expect(() => build({ token })).toThrow(/--token .* is not in the basket/);
  });

  const badUsd = ["0", "0.0", "0.000000", "-5", "abc", "1e3", "5.1234567", " 5", "", "1000000000", "98765432109.123456", "123456789012345678901234"];
  it.each(badUsd)("rejects the amount %j", (usd) => {
    expect(() => build({ usd })).toThrow(InputError);
    expect(() => build({ usd })).toThrow(/--usd/);
  });

  it.each([
    "0x123",
    "1111111111111111111111111111111111111111",
    "0xb20000000000000000000078ee7ce2fe4908108C", // mixed case, wrong checksum
    "0xZZ11111111111111111111111111111111111111",
    "0x0000000000000000000000000000000000000000",
  ])("rejects the vault address %s", (vault) => {
    expect(() => build({ vault })).toThrow(/--vault/);
  });

  it("builds BUY only: SELL and the other actions are refused", () => {
    expect(build({ action: "buy" }).intent.action).toBe(0);
    expect(() => build({ action: "SELL" })).toThrow(/SELL is not offered/);
    expect(() => build({ action: "SUPPLY" })).toThrow(/use BUY/);
  });

  it("gives two salts two ids, and one salt the same id", () => {
    const a = build({ salt: "sat-1" }).intent.id;
    const b = build({ salt: "mon-1" }).intent.id;
    expect(a).not.toBe(b);
    expect(build({ salt: "sat-1" }).intent.id).toBe(a);
    expect(a).toBe(intentId("first-decision:sat-1", 0));
  });

  it("takes a 32-byte --id as given", () => {
    const id = `0x${"Ab".repeat(32)}`;
    expect(build({ salt: undefined, id }).intent.id).toBe(id.toLowerCase());
    expect(build({ salt: undefined, id }).runId).toBeNull();
  });

  it("needs exactly one of --id and --salt, and refuses an empty salt or a malformed id", () => {
    expect(() => build({ salt: undefined })).toThrow(/exactly one of --id and --salt/);
    expect(() => build({ id: `0x${"11".repeat(32)}` })).toThrow(/exactly one of --id and --salt/);
    expect(() => build({ salt: " " })).toThrow(/--salt is empty/);
    for (const id of ["0x1234", `0x${"zz".repeat(32)}`, `0x${"00".repeat(32)}`, "11".repeat(32)]) {
      expect(() => build({ salt: undefined, id })).toThrow(/--id/);
    }
  });

  it("hashes the rationale text it is given", () => {
    expect(build({ rationale: "first mainnet refusal" }).intent.rationaleHash).toBe(rationaleHash("first mainnet refusal"));
    expect(() => build({ rationale: "" })).toThrow(/--rationale is empty/);
  });
});

describe("first-decision command line", () => {
  it("prints both calldatas and the owner-run templates with placeholders, and makes no network call", () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("network");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const d = build();
    const r = run(ARGV);
    expect(r.code).toBe(0);
    expect(r.err).toBe("");
    expect(r.out).toContain(d.previewCalldata);
    expect(r.out).toContain(d.executeCalldata);
    expect(r.out).toContain("OWNER-RUN");
    expect(r.out).toContain(`VAULT=${d.vault}`);
    expect(r.out).toContain(`cast call "$VAULT" --data ${d.previewCalldata} --from "$EXECUTOR" --rpc-url "$RPC"`);
    expect(r.out).toContain(
      `cast send "$VAULT" --data ${d.executeCalldata} --gas-limit ${EXECUTE_GAS_FLOOR} --account <your-keystore> --rpc-url "$RPC"`,
    );
    expect(r.out).toContain(`Decision topic 0  ${DECISION_TOPIC}`);
    expect(r.out).toContain(`Decision topic 1  ${d.intent.id}`);
    expect(r.out).toContain("6 MARKET_CLOSED");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("prints the codes it reads back from the execute calldata, and the Builder Code check between the preview and the send", () => {
    const r = run(ARGV);
    expect(r.out).toContain(`Codes in calldata ["${CODE}"]`);
    const check = r.out.indexOf("# Before c:");
    expect(check).toBeGreaterThan(r.out.indexOf("# b. Dry run"));
    expect(check).toBeLessThan(r.out.indexOf("cast send"));
  });

  it("never fills a template from the environment", () => {
    vi.stubEnv("BASE_RPC_URL", "https://fake-rpc.example");
    vi.stubEnv("RPC", "https://fake-rpc.example");
    vi.stubEnv("MAAT_VAULT", "0x9999999999999999999999999999999999999999");
    vi.stubEnv("MAAT_BUILDER_CODE", "bc_fakefromenv");
    const r = run(ARGV);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("fake-rpc");
    expect(r.out).not.toContain("0x9999999999999999999999999999999999999999");
    expect(r.out).not.toContain("bc_fakefromenv");
    for (const url of r.out.match(/https?:\/\/\S+/g) ?? []) expect(url).toBe("https://basescan.org/tx/<tx");
  });

  it("exits 1 on a missing or invalid flag value, 2 on an unknown flag, 0 for --help", () => {
    expect(run(ARGV.slice(2)).code).toBe(1);
    expect(run(ARGV.slice(2)).err).toMatch(/missing --vault/);
    expect(run([...ARGV, "--usd", "0"]).code).toBe(1);
    expect(run([...ARGV, "--usd", "123456789012345678901234"])).toMatchObject({ code: 1, err: expect.stringMatching(/^first-decision: --usd /) });
    expect(run([...ARGV.slice(0, -1), "0x6d6161745f66616b65"])).toMatchObject({
      code: 1,
      err: expect.stringMatching(/^first-decision: --builder-code "0x6d6161745f66616b65" is a hex form/),
    });
    expect(run([...ARGV, "--bogus"]).code).toBe(2);
    expect(run(["--help"])).toMatchObject({ code: 0, err: "" });
  });

  it("imports nothing that reads settings or talks to the network", () => {
    const src = readFileSync(new URL("../scripts/first-decision.ts", import.meta.url), "utf8");
    const imports = [...src.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
    expect(imports).toEqual([
      "node:fs",
      "node:url",
      "node:util",
      "viem",
      "../src/abi/index.js",
      "../src/addresses.js",
      "../src/exec/builderCode.js",
      "../src/exec/calls.js",
      "../src/intent.js",
      "../src/types.js",
      "../src/units.js",
    ]);
    expect(src).toMatch(/^import \{ realpathSync \} from "node:fs";$/m);
    expect(src).not.toMatch(/process\.env|createPublicClient|createWalletClient|http\(|fetch\(/);
  });
});
