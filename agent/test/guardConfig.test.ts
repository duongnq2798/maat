import { describe, expect, it } from "vitest";
import { loadGuardConfig } from "../src/guard/config.js";

const base = {
  BASE_RPC_URL: "https://mainnet.base.org",
  MAAT_VAULT: "0x1111111111111111111111111111111111111111",
  MAAT_EXECUTOR: "0x2222222222222222222222222222222222222222",
  CDP_API_KEY_ID: "key-id",
  CDP_API_KEY_SECRET: "key-secret",
};

describe("loadGuardConfig", () => {
  it("pays the vault through the CDP facilitator by default", () => {
    const c = loadGuardConfig(base);
    expect(c.payTo).toBe(base.MAAT_VAULT);
    expect(c.port).toBe(8080);
    expect(c.rateLimitPerMinute).toBe(60);
    expect(c.corsOrigins).toEqual(["https://maatonbase.xyz", "https://www.maatonbase.xyz"]);
    expect(c.builderCode).toBeUndefined();
    expect(c.facilitator).toEqual({ kind: "cdp", apiKeyId: "key-id", apiKeySecret: "key-secret" });
  });

  it("takes the S4 fallback payee and a facilitator URL", () => {
    const c = loadGuardConfig({
      ...base,
      GUARD_PAY_TO: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      GUARD_FACILITATOR_URL: "http://127.0.0.1:4022",
      CDP_API_KEY_ID: "",
      CDP_API_KEY_SECRET: "",
    });
    expect(c.payTo).toBe("0xABcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD");
    expect(c.facilitator).toEqual({ kind: "url", url: "http://127.0.0.1:4022" });
  });

  it("treats blank values from the env file as unset", () => {
    const c = loadGuardConfig({ ...base, GUARD_PAY_TO: "", GUARD_PORT: "", GUARD_BUILDER_CODE: "", GUARD_FACILITATOR_URL: "", CDP_WALLET_SECRET: "" });
    expect(c.payTo).toBe(base.MAAT_VAULT);
    expect(c.port).toBe(8080);
    expect(c.facilitator.kind).toBe("cdp");
  });

  it("refuses to start with a wallet secret in its env", () => {
    expect(() => loadGuardConfig({ ...base, CDP_WALLET_SECRET: "secret" })).toThrow(/never signs/);
  });

  it("needs the CDP API key when no facilitator URL is set", () => {
    expect(() => loadGuardConfig({ ...base, CDP_API_KEY_SECRET: "" })).toThrow(/CDP_API_KEY_ID and CDP_API_KEY_SECRET/);
  });

  it("validates the builder code and the port", () => {
    expect(loadGuardConfig({ ...base, GUARD_BUILDER_CODE: "bc_maat" }).builderCode).toBe("bc_maat");
    expect(() => loadGuardConfig({ ...base, GUARD_BUILDER_CODE: "Bad-Code" })).toThrow(/GUARD_BUILDER_CODE/);
    expect(() => loadGuardConfig({ ...base, GUARD_PORT: "70000" })).toThrow(/GUARD_PORT/);
  });
});
