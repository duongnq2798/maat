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
  it("takes an optional fallback RPC URL", () => {
    expect(loadConfig(base).rpcFallbackUrl).toBeUndefined();
    expect(loadConfig({ ...base, BASE_RPC_URL_FALLBACK: "https://fallback.example.org" }).rpcFallbackUrl).toBe("https://fallback.example.org");
  });
  it("rejects a fallback RPC that is not a URL", () => {
    expect(() => loadConfig({ ...base, BASE_RPC_URL_FALLBACK: "fallback.example.org" })).toThrow(/BASE_RPC_URL_FALLBACK/);
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
      BASE_RPC_URL_FALLBACK: "",
      MAAT_MODE: "",
      MAAT_BUILDER_CODE: "",
      MAAT_LOOP_MODEL: "",
      MAAT_DATA_DIR: "",
      MAAT_MAX_TX_PER_DAY: "",
      MAAT_DEFAULT_DAILY_COMPUTE_USD: "",
      CDP_ACCOUNT_NAME: "",
    });
    expect(c.rpcFallbackUrl).toBeUndefined();
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

  describe("guardrails", () => {
    it("defaults to credit actions off, a $0.75 daily LLM cap, and the bill minimum left to the mode", () => {
      const c = loadConfig(base);
      expect(c.creditActions).toBe(false);
      expect(c.maxLlmUsdPerDay).toBe(0.75);
      expect(c.billMinUsd).toBeUndefined();
    });
    it("treats blank guardrail values as unset", () => {
      const c = loadConfig({ ...base, MAAT_CREDIT_ACTIONS: "", MAAT_MAX_LLM_USD_PER_DAY: "", MAAT_BILL_MIN_USD: "" });
      expect([c.creditActions, c.maxLlmUsdPerDay, c.billMinUsd]).toEqual([false, 0.75, undefined]);
    });
    it("reads MAAT_CREDIT_ACTIONS as off or on, and nothing else", () => {
      expect(loadConfig({ ...base, MAAT_CREDIT_ACTIONS: "off" }).creditActions).toBe(false);
      expect(loadConfig({ ...base, MAAT_CREDIT_ACTIONS: "on" }).creditActions).toBe(true);
      for (const v of ["true", "1", "yes", "ON"]) expect(() => loadConfig({ ...base, MAAT_CREDIT_ACTIONS: v }), v).toThrow(/MAAT_CREDIT_ACTIONS/);
    });
    it("reads the daily LLM cap in dollars; 0 is allowed and a negative cap is not", () => {
      expect(loadConfig({ ...base, MAAT_MAX_LLM_USD_PER_DAY: "1.5" }).maxLlmUsdPerDay).toBe(1.5);
      expect(loadConfig({ ...base, MAAT_MAX_LLM_USD_PER_DAY: "0" }).maxLlmUsdPerDay).toBe(0);
      expect(() => loadConfig({ ...base, MAAT_MAX_LLM_USD_PER_DAY: "-1" })).toThrow(/MAAT_MAX_LLM_USD_PER_DAY/);
      expect(() => loadConfig({ ...base, MAAT_MAX_LLM_USD_PER_DAY: "lots" })).toThrow(/MAAT_MAX_LLM_USD_PER_DAY/);
    });
    it("reads the smallest bill repayment in dollars, above 0", () => {
      expect(loadConfig({ ...base, MAAT_BILL_MIN_USD: "1.00" }).billMinUsd).toBe(1);
      expect(() => loadConfig({ ...base, MAAT_BILL_MIN_USD: "0" })).toThrow(/MAAT_BILL_MIN_USD/);
    });
  });
});
