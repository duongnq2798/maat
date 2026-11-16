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
    expect(c.llmProvider).toBe("anthropic");
    expect(c.bankrApiKey).toBeUndefined();
    expect(c.anthropicApiKeySet).toBe(false);
  });
  it("needs a Bankr key when the provider is bankr, and only then", () => {
    expect(() => loadConfig({ ...base, MAAT_LLM_PROVIDER: "bankr" })).toThrow(/BANKR_API_KEY/);
    expect(() => loadConfig({ ...base, MAAT_LLM_PROVIDER: "bankr", BANKR_API_KEY: "" })).toThrow(/BANKR_API_KEY/);
    expect(() => loadConfig({ ...base, MAAT_LLM_PROVIDER: "bankr", BANKR_API_KEY: "   " })).toThrow(/BANKR_API_KEY/);
    const c = loadConfig({ ...base, MAAT_LLM_PROVIDER: "bankr", BANKR_API_KEY: "bk_test" });
    expect(c.llmProvider).toBe("bankr");
    expect(c.bankrApiKey).toBe("bk_test");
    // The default provider does not use the key, so a key of spaces does not stop the start.
    const spaces = loadConfig({ ...base, BANKR_API_KEY: "   " });
    expect(spaces.llmProvider).toBe("anthropic");
    expect(spaces.bankrApiKey).toBeUndefined();
  });
  it("rejects an unknown provider", () => {
    expect(() => loadConfig({ ...base, MAAT_LLM_PROVIDER: "openrouter" })).toThrow(/MAAT_LLM_PROVIDER/);
  });
  it("never repeats a key in its error", () => {
    const keys = { BANKR_API_KEY: "bk_secret_1", ANTHROPIC_API_KEY: "sk-ant-secret-2" };
    expect(() => loadConfig({ ...base, ...keys, MAAT_LLM_PROVIDER: "nope", MAAT_VAULT: "0x123" })).toThrow(/^(?!.*secret).*$/s);
  });
  it("notes whether an Anthropic key is set, without keeping it", () => {
    const c = loadConfig({ ...base, ANTHROPIC_API_KEY: "sk-ant-test" });
    expect(c.anthropicApiKeySet).toBe(true);
    expect(JSON.stringify(c)).not.toContain("sk-ant-test");
    expect(loadConfig({ ...base, ANTHROPIC_API_KEY: "" }).anthropicApiKeySet).toBe(false);
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
      MAAT_LLM_PROVIDER: "",
      BANKR_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      CDP_ACCOUNT_NAME: "",
    });
    expect(c.llmProvider).toBe("anthropic");
    expect(c.bankrApiKey).toBeUndefined();
    expect(c.anthropicApiKeySet).toBe(false);
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
