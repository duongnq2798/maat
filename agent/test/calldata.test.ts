import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Attribution } from "ox/erc8021";
import { concat, encodeFunctionData, keccak256, size, toBytes, toFunctionSelector, toHex, zeroAddress, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { mandateVaultAbi } from "../src/abi/index.js";
import { addressOf } from "../src/addresses.js";
import { builderSuffix } from "../src/exec/builderCode.js";
import { encodeExecute, encodeSyncMultiplier } from "../src/exec/calls.js";
import { BLOB_PREFIX } from "../src/rationale/blob.js";
import { decodeExecuteInput, EMPTY_HASH, EXECUTE_BYTES, EXECUTE_SELECTOR, senderLabel } from "../src/rationale/calldata.js";
import type { OnchainIntent } from "../src/types.js";

const VECTORS: Record<string, { hex: Hex }> = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "maat-v1-vectors.json"), "utf8"));
const V1 = VECTORS.V1!.hex;
const V4 = VECTORS.V4!.hex;
const V5 = VECTORS.V5!.hex;
const OWNER = "0x3c3a66f713DAE7e4A03Bbd81dB79FF65F42C1D6a";
const AGENT = "0x2222222222222222222222222222222222222222";

/** The §5.6 intent: id keccak256("spec-example"), a 5 USD NVDAc buy committing to `rationaleHash`. */
const intent = (rationaleHash: Hex): OnchainIntent => ({
  id: keccak256(toBytes("spec-example")),
  action: 0,
  token: addressOf("NVDAc"),
  amount: 5_000_000n,
  minOut: 0n,
  payee: zeroAddress,
  rationaleHash,
});

describe("the execute calldata layout (spec §1)", () => {
  it("execute(Intent) has the selector 0x4ad3993f and is always 228 bytes", () => {
    expect(toFunctionSelector("execute((bytes32,uint8,address,uint256,uint256,address,bytes32))")).toBe(EXECUTE_SELECTOR);
    expect(EXECUTE_SELECTOR).toBe("0x4ad3993f");
    expect(size(encodeExecute(intent(keccak256(V1))))).toBe(EXECUTE_BYTES);
    expect(EXECUTE_BYTES).toBe(228);
  });

  it("§5.6: execute ‖ V1 ‖ the fake_code suffix is 693 bytes; the decoder finds S = 666, V1 and a true hash tick", () => {
    const suffix = Attribution.toDataSuffix({ codes: ["fake_code"] }) as Hex;
    const data = concat([encodeExecute(intent(keccak256(V1))), V1, suffix]);
    expect(size(data)).toBe(693);
    expect(size(suffix)).toBe(27);
    const d = decodeExecuteInput(data)!;
    expect(d).toMatchObject({ suffixStart: 666, status: "v1", blobBytes: 438, hashTick: true, codes: ["fake_code"] });
    expect(d.blob).toBe(Buffer.from(V1.slice(2), "hex").toString("latin1"));
    expect(d.blobHash).toBe(keccak256(V1));
    expect(d.rationaleHash).toBe(keccak256(V1));
    expect(Attribution.fromData(data)).toMatchObject({ codes: ["fake_code"] });
  });

  it("the Builder Code parser still finds the configured code with a blob between the intent and the suffix", () => {
    // A code of the same 11-character shape as the configured one; ox reads it from the end of the calldata.
    const code = "bc_fake1234";
    const data = concat([encodeExecute(intent(keccak256(V1))), V1, builderSuffix(code)]);
    expect(Attribution.fromData(data)).toMatchObject({ codes: [code] });
    expect(decodeExecuteInput(data)?.codes).toEqual([code]);
  });

  it("reads the two owner Decisions' layout: 257 bytes, an 11-byte code, no blob", () => {
    const text = "Owner-sent first decision: BUY 5 USD of NVDAc";
    const hash = keccak256(toBytes(text));
    expect(hash).toBe("0x0baa4c52e17e7acc5c7cc851e57a9df523c70b5a1530d77055bb2401370f57f6");
    const data = concat([encodeExecute(intent(hash)), builderSuffix("bc_a1b2c3d4")]);
    expect(size(data)).toBe(257);
    expect(decodeExecuteInput(data)).toMatchObject({ suffixStart: 228, status: "none", blobBytes: 0, blobHash: null, hashTick: null, codes: ["bc_a1b2c3d4"], rationaleHash: hash });
    expect(keccak256("0x")).toBe(EMPTY_HASH);
  });

  it("calls bytes without the maat:v1: prefix foreign and decodes nothing from them, but still ticks their hash", () => {
    const blob = toHex("hello, vault");
    const d = decodeExecuteInput(concat([encodeExecute(intent(keccak256(blob))), blob, builderSuffix("bc_a1b2c3d4")]))!;
    expect(d).toMatchObject({ status: "foreign", blobBytes: 12, hashTick: true });
    expect(d.fields).toBeUndefined();
  });

  it("calls a maat:v1: blob that breaks a rule invalid, with its problem and its hash tick", () => {
    const bad = toHex(`${BLOB_PREFIX}{"b":1}`);
    const d = decodeExecuteInput(concat([encodeExecute(intent(`0x${"00".repeat(32)}`)), bad]))!;
    expect(d).toMatchObject({ status: "invalid", hashTick: false, codes: null, suffixStart: 228 + size(bad) });
    expect(d.problem).toMatch(/c is not/);
  });

  it("reads no suffix when the marker, the schema id or the code length do not fit", () => {
    const plain = encodeExecute(intent(keccak256(V1)));
    const suffix = builderSuffix("bc_a1b2c3d4");
    // Schema id 1 is not decoded in v1: the whole tail is the blob region.
    const schema1 = concat([plain, V1, `0x${suffix.slice(2, -34)}01${suffix.slice(-32)}`]);
    expect(decodeExecuteInput(schema1)).toMatchObject({ codes: null, suffixStart: size(schema1), status: "invalid" });
    // A code length that would reach back into the intent.
    const tooLong = concat([plain, "0xff00", "0x80218021802180218021802180218021"]);
    expect(decodeExecuteInput(tooLong)).toMatchObject({ codes: null, status: "foreign", blobBytes: 18 });
    // Shorter than 246 bytes: no room for a suffix after the intent.
    expect(decodeExecuteInput(concat([plain, "0x00", "0x80218021802180218021802180218021"]))).toMatchObject({ codes: null, blobBytes: 17 });
  });

  it("returns null for anything that is not a direct execute call", () => {
    expect(decodeExecuteInput(encodeSyncMultiplier(addressOf("NVDAc")))).toBeNull();
    expect(decodeExecuteInput(encodeFunctionData({ abi: mandateVaultAbi, functionName: "notifyRevenue" }))).toBeNull();
    expect(decodeExecuteInput(encodeExecute(intent(keccak256(V1))).slice(0, -2) as Hex)).toBeNull();
    expect(decodeExecuteInput("0x")).toBeNull();
  });
});

describe("sender labels (spec §4)", () => {
  const decoded = (blob: Hex) => decodeExecuteInput(concat([encodeExecute(intent(keccak256(blob))), blob, builderSuffix("bc_a1b2c3d4")]))!;
  const none = decodeExecuteInput(concat([encodeExecute(intent(EMPTY_HASH)), builderSuffix("bc_a1b2c3d4")]))!;

  it("names the owner first, whatever the calldata carries", () => {
    expect(senderLabel({ from: OWNER.toLowerCase() as Hex, owner: OWNER, decoded: decoded(V4) })).toBe("owner, by hand");
    expect(senderLabel({ from: OWNER, owner: OWNER, decoded: none })).toBe("owner, by hand");
  });

  it("then a probe, then a brief-driven intent, from a v1 blob", () => {
    expect(senderLabel({ from: AGENT, owner: OWNER, decoded: decoded(V4) })).toBe("probe");
    expect(senderLabel({ from: AGENT, owner: OWNER, decoded: decoded(V5) })).toBe("brief-driven");
  });

  it("calls every other Decision the agent's", () => {
    expect(senderLabel({ from: AGENT, owner: OWNER, decoded: decoded(V1) })).toBe("agent");
    expect(senderLabel({ from: AGENT, owner: OWNER, decoded: none })).toBe("agent");
    expect(senderLabel({ from: AGENT, owner: OWNER, decoded: decoded(toHex("hello")) })).toBe("agent");
  });
});
