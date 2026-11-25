// @vitest-environment node
import { keccak256, toBytes, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { briefCalldata } from "@/lib/chain/inbox";
import type { LedgerClient } from "@/lib/chain/load";
import { readBuilderCode } from "@/lib/wallet/builder-code";
import { briefTxData, BUILDER_CODE_RE, erc8021Suffix } from "@/lib/wallet/suffix";
import { decisionLog, fakeLedgerClient, hash32, type FakeChain } from "./helpers/fake-ledger";
import { AGENT_TEST_CODE, AGENT_TEST_SUFFIX, erc8021Suffix as specSuffix, executeCalldata, SPEC_CODE } from "./helpers/maat-v1";

const VAULT: Address = "0x00000000000000000000000000000000000Aa001";
const OWNER: Address = "0x00000000000000000000000000000000000000A1";
const AGENT: Address = "0x00000000000000000000000000000000000000b2";
const DEPLOY = 2_000_000n;
const DEPLOY_TX = { hash: hash32(4242), block: DEPLOY };

describe("erc8021Suffix", () => {
  it("is the exact 29-byte schema-0 suffix of the agent's test code", () => {
    expect(erc8021Suffix(AGENT_TEST_CODE)).toBe(AGENT_TEST_SUFFIX);
    expect((AGENT_TEST_SUFFIX.length - 2) / 2).toBe(29);
  });

  it("is the code, its byte count, schema id 0 and the 16-byte marker, as the maat:v1 spec helper builds it", () => {
    expect(erc8021Suffix(SPEC_CODE)).toBe(specSuffix([SPEC_CODE]));
    expect(erc8021Suffix("a")).toBe(`0x61010080218021802180218021802180218021`);
  });

  it("refuses a code the Builder Codes registry would refuse", () => {
    expect(BUILDER_CODE_RE.test("bc_ok_123")).toBe(true);
    for (const bad of ["", "Has-Caps", "a".repeat(33), "with space", "bc,two"]) expect(() => erc8021Suffix(bad), bad).toThrow(/Builder Code/);
  });
});

describe("briefTxData", () => {
  it("is brief(text) calldata followed by the exact suffix", () => {
    const text = "buy more NVDAc";
    expect(briefTxData(text, AGENT_TEST_SUFFIX)).toBe(`${briefCalldata(text)}${AGENT_TEST_SUFFIX.slice(2)}`);
    expect(briefTxData(text, AGENT_TEST_SUFFIX).endsWith(AGENT_TEST_SUFFIX.slice(2))).toBe(true);
  });

  it("is brief(text) calldata alone when there is no suffix", () => {
    expect(briefTxData("buy", null)).toBe(briefCalldata("buy"));
  });
});

/** execute() calldata with the given suffix codes, as the owner's first Decision carried them. */
const executeWith = (code: string | null): Hex =>
  `${executeCalldata({ rationaleHash: keccak256(toBytes("first")) })}${code === null ? "" : erc8021Suffix(code).slice(2)}` as Hex;

function chainWith(decisions: { n: number; block: bigint; from: Address; input: Hex; to?: Address }[], extra: Partial<FakeChain> = {}) {
  const fake = fakeLedgerClient({
    head: DEPLOY + 2_000_000n,
    deployTx: DEPLOY_TX,
    owner: OWNER,
    logs: decisions.map((d) => decisionLog(d.n, d.block)),
    txs: Object.fromEntries(decisions.map((d) => [hash32(d.n), { from: d.from, to: d.to ?? VAULT, input: d.input }])),
    ...extra,
  });
  const client = {
    ...fake,
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "owner") return OWNER;
      throw new Error(`unexpected readContract ${functionName}`);
    },
  } as unknown as LedgerClient;
  return { client, logCalls: fake.logCalls };
}

describe("readBuilderCode: the first code on the vault's first Decision, when its owner sent it (the ledger's reference)", () => {
  it("reads the code from the owner's first Decision, not from a later one", async () => {
    const { client } = chainWith([
      { n: 1, block: DEPLOY + 5n, from: OWNER, input: executeWith(AGENT_TEST_CODE) },
      { n: 2, block: DEPLOY + 400_000n, from: AGENT, input: executeWith(SPEC_CODE) },
    ]);
    expect(await readBuilderCode(client, { vault: VAULT, deployTx: DEPLOY_TX.hash })).toEqual({
      state: "read",
      code: AGENT_TEST_CODE,
      suffix: AGENT_TEST_SUFFIX,
      txHash: hash32(1),
    });
  });

  it("scans forward from the deploy block and stops at the batch that holds the first Decision", async () => {
    const { client, logCalls } = chainWith([{ n: 1, block: DEPLOY + 320_000n, from: OWNER, input: executeWith(AGENT_TEST_CODE) }]);
    const read = await readBuilderCode(client, { vault: VAULT, deployTx: DEPLOY_TX.hash });
    expect(read).toMatchObject({ state: "read", code: AGENT_TEST_CODE });
    expect(Math.min(...logCalls.map((c) => Number(c.from)))).toBe(Number(DEPLOY));
    expect(Math.max(...logCalls.map((c) => Number(c.to)))).toBeLessThan(Number(DEPLOY + 700_000n));
  });

  it("is unavailable when the first Decision was not sent by the owner", async () => {
    const { client } = chainWith([{ n: 1, block: DEPLOY + 5n, from: AGENT, input: executeWith(AGENT_TEST_CODE) }]);
    expect(await readBuilderCode(client, { vault: VAULT, deployTx: DEPLOY_TX.hash })).toEqual({
      state: "unavailable",
      why: "the vault's first Decision was not sent by its owner",
    });
  });

  it("is unavailable when the first Decision carries no Builder Code", async () => {
    const { client } = chainWith([{ n: 1, block: DEPLOY + 5n, from: OWNER, input: executeWith(null) }]);
    expect(await readBuilderCode(client, { vault: VAULT, deployTx: DEPLOY_TX.hash })).toEqual({
      state: "unavailable",
      why: "the vault's first Decision carries no Builder Code",
    });
  });

  it("is unavailable when the vault has no Decision yet", async () => {
    const { client } = chainWith([]);
    expect(await readBuilderCode(client, { vault: VAULT, deployTx: DEPLOY_TX.hash })).toEqual({ state: "unavailable", why: "the vault has no Decision yet" });
  });

  it("is unavailable when a log read fails, the owner cannot be read, or the first Decision's transaction cannot", async () => {
    const failing = chainWith([{ n: 1, block: DEPLOY + 5n, from: OWNER, input: executeWith(AGENT_TEST_CODE) }], { failLogs: true });
    expect(await readBuilderCode(failing.client, { vault: VAULT, deployTx: DEPLOY_TX.hash })).toEqual({
      state: "unavailable",
      why: "a log read failed before the vault's first Decision was found",
    });

    const { client } = chainWith([{ n: 1, block: DEPLOY + 5n, from: OWNER, input: executeWith(AGENT_TEST_CODE) }]);
    const noOwner = { ...client, readContract: async () => Promise.reject(new Error("rate limited")) } as unknown as LedgerClient;
    expect(await readBuilderCode(noOwner, { vault: VAULT, deployTx: DEPLOY_TX.hash })).toEqual({ state: "unavailable", why: "the vault's owner could not be read" });

    const noTx = { ...client, getTransaction: async () => Promise.reject(new Error("not found")) } as unknown as LedgerClient;
    expect(await readBuilderCode(noTx, { vault: VAULT, deployTx: DEPLOY_TX.hash })).toEqual({
      state: "unavailable",
      why: "the vault's first Decision transaction could not be read",
    });
  });

  it("is unavailable when the code on that Decision is not one the registry allows", async () => {
    const odd = `${executeCalldata({ rationaleHash: keccak256(toBytes("first")) })}${specSuffix(["Not-A-Code"]).slice(2)}` as Hex;
    const { client } = chainWith([{ n: 1, block: DEPLOY + 5n, from: OWNER, input: odd }]);
    expect(await readBuilderCode(client, { vault: VAULT, deployTx: DEPLOY_TX.hash })).toEqual({
      state: "unavailable",
      why: "the code on the vault's first Decision is not a valid Builder Code",
    });
  });
});
