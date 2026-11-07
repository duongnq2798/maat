import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const base = {
  BASE_RPC_URL: "https://mainnet.base.org",
  MAAT_VAULT: "0x1111111111111111111111111111111111111111",
  MAAT_EXECUTOR: "0x2222222222222222222222222222222222222222",
  MAAT_EXPENSE_PAYEE: "0x3333333333333333333333333333333333333333",
};

describe("loadConfig", () => {
  it("defaults to dry-run with the documented defaults", () => {
    const c = loadConfig(base);
    expect(c.mode).toBe("dry-run");
    expect(c.loopModel).toBe("claude-sonnet-5-5");
    expect(c.maxTxPerDay).toBe(40);
    expect(c.defaultDailyComputeUsd).toBe(0.5);
    expect(c.dataDir).toBe("./data");
    expect(c.vault).toBe("0x1111111111111111111111111111111111111111");
  });
  it("checksums addresses", () => {
    const c = loadConfig({ ...base, MAAT_VAULT: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" });
    expect(c.vault).toBe("0xABcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD");
  });
  it("rejects a bad address", () => {
    expect(() => loadConfig({ ...base, MAAT_VAULT: "0x123" })).toThrow(/MAAT_VAULT/);
  });
  it("requires a Builder Code in live mode", () => {
    expect(() => loadConfig({ ...base, MAAT_MODE: "live" })).toThrow(/MAAT_BUILDER_CODE/);
    expect(loadConfig({ ...base, MAAT_MODE: "live", MAAT_BUILDER_CODE: "bc_test" }).mode).toBe("live");
  });
  it("treats blank env values as unset so defaults apply", () => {
    const c = loadConfig({
      ...base,
      MAAT_MODE: "",
      MAAT_BUILDER_CODE: "",
      MAAT_LOOP_MODEL: "",
      MAAT_DATA_DIR: "",
      MAAT_MAX_TX_PER_DAY: "",
      MAAT_DEFAULT_DAILY_COMPUTE_USD: "",
      CDP_ACCOUNT_NAME: "",
    });
    expect(c.mode).toBe("dry-run");
    expect(c.builderCode).toBeUndefined();
    expect(c.loopModel).toBe("claude-sonnet-5-5");
    expect(c.dataDir).toBe("./data");
    expect(c.maxTxPerDay).toBe(40);
    expect(c.defaultDailyComputeUsd).toBe(0.5);
    expect(c.cdpAccountName).toBe("maat-executor");
  });
  it("live mode treats a blank Builder Code as missing", () => {
    expect(() => loadConfig({ ...base, MAAT_MODE: "live", MAAT_BUILDER_CODE: "" })).toThrow(/MAAT_BUILDER_CODE/);
  });
  it("reports a blank required address as required", () => {
    expect(() => loadConfig({ ...base, MAAT_VAULT: "" })).toThrow(/MAAT_VAULT is required/);
  });
});
