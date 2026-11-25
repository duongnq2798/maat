// @vitest-environment node
import { keccak256, toBytes, toHex, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { senderLabel } from "@/lib/chain/ledger";
import { canon, decodeExecuteInput, EXECUTE_BYTES, verifyRationale, type DecodedBlob } from "@/lib/chain/rationale";
import { AGENT_TEST_CODE, AGENT_TEST_SUFFIX, erc8021Suffix, executeCalldata, SPEC_CODE, txInput, VECTORS, type VectorName } from "./helpers/maat-v1";

const OWNER: Address = "0x00000000000000000000000000000000000000A1";
const AGENT: Address = "0x00000000000000000000000000000000000000B2";
const bytesOf = (h: Hex) => (h.length - 2) / 2;
const prefix = "maat:v1:";
/** The JSON object of a blob, for building variants of it. */
const body = (name: VectorName) => JSON.parse(VECTORS[name].blob.slice(prefix.length)) as Record<string, unknown>;
const blobOf = (input: Hex): DecodedBlob => decodeExecuteInput(input)!.blob;
const problemOf = (blob: string) => {
  const b = blobOf(txInput(blob));
  return b.status === "invalid" ? b.problem : b.status;
};

describe("the spec's vectors (§5)", () => {
  it.each(["V1", "V2", "V3", "V4", "V5"] as const)("%s has the byte count and keccak256 the spec gives, and decodes as v1", (name) => {
    const v = VECTORS[name];
    expect(v.blob.length).toBe(v.bytes);
    expect(keccak256(toBytes(v.blob))).toBe(v.hash);
    const call = decodeExecuteInput(txInput(v.blob))!;
    expect(call.blob.status).toBe("v1");
    expect(call.blobHash).toBe(v.hash);
    // The web's existing check works on a blob unchanged (§2.5).
    expect(verifyRationale(v.blob, v.hash)).toBe("verified");
  });

  it("V3 is exactly the 1,024-byte cap and still valid", () => {
    expect(VECTORS.V3.bytes).toBe(1024);
    expect(blobOf(txInput(VECTORS.V3.blob)).status).toBe("v1");
  });

  it("serializes each vector's JSON back to itself with canon (§2.2)", () => {
    for (const name of ["V1", "V2", "V3", "V4", "V5"] as const) expect(prefix + canon(body(name))).toBe(VECTORS[name].blob);
  });

  it("decodes V1's fields, sources in the vault's token order with the round id as a decimal string", () => {
    const b = blobOf(txInput(VECTORS.V1.blob));
    if (b.status !== "v1") throw new Error(b.status);
    expect(b.fields).toMatchObject({ b: 61_745_836, c: "0123456789abcdef0123456789abcdef01234567", m: "claude-sonnet-5-5", r: "1795539542000-a1b2c3d4" });
    expect(b.fields.k).toBeUndefined();
    expect(b.fields.q).toBeUndefined();
    expect(b.fields.s.map((s) => s.sym)).toEqual(["NVDAc", "GOOGLc", "AAPLc"]);
    expect(b.fields.s[0]).toEqual({ sym: "NVDAc", roundId: "36893488147419105055", updatedAt: 1_795_539_382, premiumBps: 19 });
    expect(b.fields.t).toBe("Fixture rationale: NVDAc is under its target weight and the feed is fresh, so buy 5 USD.");
  });

  it("decodes V4 as a probe with no model, and V5 with its brief ids", () => {
    const v4 = blobOf(txInput(VECTORS.V4.blob));
    const v5 = blobOf(txInput(VECTORS.V5.blob));
    if (v4.status !== "v1" || v5.status !== "v1") throw new Error("not v1");
    expect(v4.fields).toMatchObject({ k: "probe", r: "probe-2026-11-27T17:58:00Z" });
    expect(v4.fields.m).toBeUndefined();
    expect(v5.fields.q).toEqual([7]);
  });
});

describe("decodeExecuteInput (§1)", () => {
  it("splits §5.6's calldata: 228 + 438 + 27 = 693 bytes, the blob is V1, the hash tick holds and the code is read", () => {
    const input = txInput(VECTORS.V1.blob, { code: SPEC_CODE });
    expect(bytesOf(input)).toBe(693);
    const call = decodeExecuteInput(input)!;
    expect(call.codes).toEqual([SPEC_CODE]);
    expect(call.blob).toMatchObject({ status: "v1", text: VECTORS.V1.blob });
    expect(call.intentRationaleHash).toBe(VECTORS.V1.hash);
    expect(call.blobHash).toBe(call.intentRationaleHash);
  });

  it("builds the agent's own suffix vector, so the fixture calldata ends as the agent's does", () => {
    expect(erc8021Suffix([AGENT_TEST_CODE])).toBe(AGENT_TEST_SUFFIX);
  });

  it("reads a 257-byte owner-style input (intent and a suffix with one 11-byte code) as no blob", () => {
    const text = "Owner-sent first decision: BUY 5 USD of NVDAc";
    const input = `${executeCalldata({ rationaleHash: keccak256(toBytes(text)) })}${AGENT_TEST_SUFFIX.slice(2)}` as Hex;
    expect(bytesOf(input)).toBe(257);
    const call = decodeExecuteInput(input)!;
    expect(call.blob).toEqual({ status: "none" });
    expect(call.blobHash).toBeNull();
    expect(call.codes).toEqual([AGENT_TEST_CODE]);
    expect(verifyRationale(text, call.intentRationaleHash)).toBe("verified");
  });

  it("reads a bare execute call as no blob and no suffix", () => {
    const call = decodeExecuteInput(executeCalldata({ rationaleHash: VECTORS.V1.hash }))!;
    expect(call).toMatchObject({ blob: { status: "none" }, codes: null, blobHash: null });
  });

  it("reads several comma-joined codes", () => {
    const input = `${executeCalldata({ rationaleHash: VECTORS.V1.hash })}${toHex(VECTORS.V1.blob).slice(2)}${erc8021Suffix([SPEC_CODE, AGENT_TEST_CODE]).slice(2)}` as Hex;
    expect(decodeExecuteInput(input)!.codes).toEqual([SPEC_CODE, AGENT_TEST_CODE]);
  });

  it("returns null for anything that is not a direct execute call", () => {
    expect(decodeExecuteInput("0x")).toBeNull();
    expect(decodeExecuteInput(`0xdeadbeef${"00".repeat(EXECUTE_BYTES)}`)).toBeNull();
    expect(decodeExecuteInput(executeCalldata({ rationaleHash: VECTORS.V1.hash }).slice(0, -2) as Hex)).toBeNull();
  });

  it("finds the blob's end at the suffix, never by parsing: a blob with a brace and the marker inside still decodes", () => {
    const b = { ...body("V1"), t: "Text with } and 8021 inside." };
    const blob = prefix + canon(b);
    expect(blobOf(txInput(blob))).toMatchObject({ status: "v1" });
  });

  it("does not read a suffix whose schema id is not 0, or whose length points inside the intent", () => {
    const schema1 = txInput(VECTORS.V1.blob).replace(/00(8021){8}$/, `01${"8021".repeat(8)}`) as Hex;
    const s1 = decodeExecuteInput(schema1)!;
    expect(s1.codes).toBeNull();
    expect(s1.blob.status).toBe("invalid");

    const intent = executeCalldata({ rationaleHash: VECTORS.V1.hash });
    const tooLong = `${intent}ff00${"8021".repeat(8)}` as Hex;
    const t = decodeExecuteInput(tooLong)!;
    expect(t.codes).toBeNull();
    expect(t.blob).toEqual({ status: "foreign", bytes: 18 });
  });

  it("marks bytes that do not start with maat:v1: as foreign and decodes nothing from them", () => {
    const call = decodeExecuteInput(txInput("hello world"))!;
    expect(call.blob).toEqual({ status: "foreign", bytes: 11 });
    expect(call.blobHash).toBe(keccak256(toBytes("hello world")));
  });

  it("gives the hash tick over the bytes, so a blob whose intent commits to another hash fails it", () => {
    const call = decodeExecuteInput(txInput(VECTORS.V1.blob, { rationaleHash: VECTORS.V2.hash }))!;
    expect(call.blob.status).toBe("v1");
    expect(call.blobHash).toBe(VECTORS.V1.hash);
    expect(call.intentRationaleHash).toBe(VECTORS.V2.hash);
  });
});

describe("blob validation (§2.6)", () => {
  const v1 = () => body("V1");
  const make = (o: Record<string, unknown>) => prefix + canon(o);

  it("accepts the vectors and rejects every broken rule, naming it", () => {
    expect(problemOf(make(v1()))).toBe("v1");
    expect(problemOf(make({ ...v1(), x: 1 }))).toMatch(/key the spec does not allow: "x"/);
    expect(problemOf(make({ ...v1(), b: -1 }))).toMatch(/^b /);
    expect(problemOf(make({ ...v1(), c: "0123456789ABCDEF0123456789abcdef01234567" }))).toMatch(/^c /);
    expect(problemOf(make({ ...v1(), j: (v1().j as string).toUpperCase().replace("0X", "0x") }))).toMatch(/^j /);
    expect(problemOf(make({ ...v1(), k: "audit" }))).toMatch(/^k /);
    expect(problemOf(make({ ...v1(), k: "probe" }))).toMatch(/m is present although k is/);
    const { m: _m, ...noModel } = v1();
    expect(problemOf(make(noModel))).toMatch(/m is not a model id/);
    expect(problemOf(make({ ...v1(), m: "-bad" }))).toMatch(/m is not a model id/);
    expect(problemOf(make({ ...v1(), q: [] }))).toMatch(/q is not/);
    expect(problemOf(make({ ...v1(), q: [3, 3] }))).toMatch(/q is not/);
    expect(problemOf(make({ ...v1(), q: [1, 2, 3, 4] }))).toMatch(/q is not/);
    expect(problemOf(make({ ...noModel, k: "probe", q: [1], t: "PROBE v1, not a Claude proposal." }))).toMatch(/q is present although k is/);
    expect(problemOf(make({ ...v1(), r: "" }))).toMatch(/^r /);
    expect(problemOf(make({ ...v1(), s: [["NVDAc", 36893488, 1, 19]] }))).toMatch(/s entry 1/);
    expect(problemOf(make({ ...v1(), s: [["NVDAc", "1", 1]] }))).toMatch(/s entry 1/);
    expect(problemOf(make({ ...v1(), s: Array.from({ length: 17 }, () => ["NVDAc", "1", 1, 0]) }))).toMatch(/at most 16/);
    expect(problemOf(make({ ...v1(), t: "" }))).toMatch(/^t /);
    expect(problemOf(make({ ...v1(), t: "x".repeat(601) }))).toMatch(/^t /);
    expect(problemOf(make({ ...v1(), k: undefined }))).toBe("v1");
  });

  it("accepts c in each form gitCommit() gives, and nothing else (§2.1)", () => {
    const sha = v1().c as string;
    for (const c of [sha, `${sha}-dirty`, "unknown"]) {
      const b = blobOf(txInput(make({ ...v1(), c })));
      if (b.status !== "v1") throw new Error(`${c}: ${b.status === "invalid" ? b.problem : b.status}`);
      expect(b.fields.c).toBe(c);
    }
    for (const c of [`${sha}-DIRTY`, `${sha}-dirty-dirty`, `${sha.slice(0, 39)}-dirty`, "unknown-dirty", "Unknown", ""]) {
      expect(problemOf(make({ ...v1(), c }))).toMatch(/^c is not a git commit/);
    }
  });

  it("rejects an m or r that fits its pattern but matches URL_RE or KEY_RE (§2.1)", () => {
    // The spec's own example: a Bedrock-style id fits the model pattern, and URL_RE reads it as a domain.
    expect(problemOf(make({ ...v1(), m: "us.anthropic.claude-sonnet-5-5" }))).toBe("m matches the URL or key pattern");
    expect(problemOf(make({ ...v1(), r: "run.example.com" }))).toBe("r matches the URL or key pattern");
    expect(problemOf(make({ ...v1(), r: `rk-${"0".repeat(16)}` }))).toBe("r matches the URL or key pattern");
    // One character short of KEY_RE's 16, and no dot: still a run id.
    expect(problemOf(make({ ...v1(), r: `rk-${"0".repeat(15)}` }))).toBe("v1");
    // The check keeps no state between blobs: the same denied value is rejected twice in a row.
    expect(problemOf(make({ ...v1(), r: "run.example.com" }))).toBe("r matches the URL or key pattern");
  });

  it("keeps a null source value, which means the read failed", () => {
    const b = blobOf(txInput(make({ ...v1(), s: [["0xb20000000000000000000078ee7ce2fe4908108c", null, null, null]] })));
    if (b.status !== "v1") throw new Error(b.status);
    expect(b.fields.s).toEqual([{ sym: "0xb20000000000000000000078ee7ce2fe4908108c", roundId: null, updatedAt: null, premiumBps: null }]);
  });

  it("requires a probe's text to say it is a probe, and a bill's to be the bill line", () => {
    const { m: _m, ...noModel } = v1();
    expect(problemOf(make({ ...noModel, k: "probe" }))).toMatch(/probe's t does not start with/);
    expect(problemOf(make({ ...noModel, k: "bill", t: "Compute bill: $1.000000 of Claude API usage unpaid as of UTC day 20781" }))).toBe("v1");
    expect(problemOf(make({ ...noModel, k: "bill", t: "Pay me." }))).toMatch(/bill's t does not start with/);
  });

  it("rejects a blob that is not in canonical form: spacing, key order, a repeated key", () => {
    const text = VECTORS.V1.blob;
    expect(problemOf(text.replace('{"b":', '{ "b":'))).toMatch(/canonical/);
    expect(problemOf(text.replace(/^maat:v1:\{"b":61745836,("c":"[0-9a-f]+"),/, 'maat:v1:{$1,"b":61745836,'))).toMatch(/canonical/);
    expect(problemOf(text.replace('{"b":61745836,', '{"b":61745836,"b":61745836,'))).toMatch(/canonical/);
  });

  it("rejects a byte outside printable ASCII, a non-integer number, non-JSON and a blob over 1,024 bytes", () => {
    expect(problemOf(VECTORS.V1.blob.replace("Fixture rationale", "Fixture\trationale"))).toMatch(/printable ASCII/);
    expect(problemOf(VECTORS.V1.blob.replace('"b":61745836', '"b":61745836.5'))).toMatch(/^b |safe integer/);
    expect(problemOf("maat:v1:{not json")).toMatch(/not JSON/);
    expect(problemOf("maat:v1:[1,2]")).toMatch(/not a JSON object/);
    const long = make({ ...v1(), s: Array.from({ length: 16 }, () => ["NVDAc", "36893488147419105055", 1_795_539_382, 19]) });
    expect(long.length).toBeGreaterThan(1024);
    expect(problemOf(long)).toMatch(/over the 1024-byte cap/);
  });
});

describe("senderLabel (§4)", () => {
  const blob = (name: VectorName) => blobOf(txInput(VECTORS[name].blob));

  it("labels whatever the owner sends 'owner, by hand', first match wins", () => {
    for (const name of ["V1", "V4", "V5"] as const) expect(senderLabel(OWNER, OWNER, blob(name))).toBe("owner, by hand");
    expect(senderLabel(OWNER.toLowerCase() as Address, OWNER, { status: "none" })).toBe("owner, by hand");
  });

  it("labels a probe, a brief-driven intent and everything else from another executor", () => {
    expect(senderLabel(AGENT, OWNER, blob("V4"))).toBe("probe");
    expect(senderLabel(AGENT, OWNER, blob("V5"))).toBe("brief-driven");
    expect(senderLabel(AGENT, OWNER, blob("V1"))).toBe("agent");
    expect(senderLabel(AGENT, OWNER, { status: "none" })).toBe("agent");
    expect(senderLabel(AGENT, OWNER, { status: "foreign", bytes: 3 })).toBe("agent");
    expect(senderLabel(AGENT, OWNER, { status: "invalid", bytes: 9, problem: "x" })).toBe("agent");
  });
});

describe("canon (§2.2)", () => {
  it("sorts keys at every level, drops undefined, keeps arrays in order and allows integers only", () => {
    expect(canon({ b: 1, a: { d: [3, { z: 1, y: null }], c: "x" }, u: undefined })).toBe('{"a":{"c":"x","d":[3,{"y":null,"z":1}]},"b":1}');
    expect(() => canon({ a: 1.5 })).toThrow(/integers only/);
    expect(() => canon({ a: 2 ** 53 })).toThrow(/integers only/);
    expect(canon('say "no" \\ ok')).toBe('"say \\"no\\" \\\\ ok"');
  });
});
