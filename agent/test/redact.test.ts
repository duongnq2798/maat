import { HttpRequestError } from "viem";
import { describe, expect, it } from "vitest";
import { MAX_LINE_CHARS, oneLine, redact, secretValues } from "../src/redact.js";

const RPC = "https://base-mainnet.example.org/v2/fakeRpcKey0123456789";
const ENV = {
  BASE_RPC_URL: RPC,
  BASE_RPC_URL_FALLBACK: "https://fallback.example.org/?apikey=fake-query-key-42",
  ANTHROPIC_API_KEY: "sk-ant-api03-fake-anthropic-key",
  CDP_API_KEY_SECRET: "fakeCdpSecret/with+base64==",
  CDP_WALLET_SECRET: "fake-wallet-secret-value",
  MAAT_VAULT: "0x3f956072d18ddd20d5efb74e9ccabf8deade699b",
  MAAT_DATA_DIR: "./data-dryrun",
  SHORT_KEY: "abc",
};

describe("secretValues", () => {
  it("takes the env vars named as secrets or RPC URLs, with the key-holding parts of a URL, longest first", () => {
    const s = secretValues(ENV);
    expect(s).toContain(RPC);
    expect(s).toContain("fakeRpcKey0123456789");
    expect(s).toContain("fake-query-key-42");
    expect(s).toContain("sk-ant-api03-fake-anthropic-key");
    expect(s).toContain("fakeCdpSecret/with+base64==");
    expect(s).toContain("fake-wallet-secret-value");
    expect(s).not.toContain("0x3f956072d18ddd20d5efb74e9ccabf8deade699b");
    expect(s).not.toContain("./data-dryrun");
    expect(s).not.toContain("abc");
    expect(s.map((v) => v.length)).toEqual([...s.map((v) => v.length)].sort((a, b) => b - a));
  });
});

describe("redact", () => {
  const s = secretValues(ENV);

  it("replaces each secret value, even where it appears without its URL", () => {
    expect(redact(`failed at ${RPC} with key fakeRpcKey0123456789`, s)).toBe("failed at [redacted] with key [redacted]");
    expect(redact("wallet fake-wallet-secret-value and fakeCdpSecret/with+base64== refused", s)).toBe("wallet [redacted] and [redacted] refused");
  });

  it("replaces any URL, Anthropic key, bearer token and long opaque token, with no env at all", () => {
    expect(redact("POST https://other.example.org/rpc?key=fake123 failed", [])).toBe("POST [url] failed");
    expect(redact("auth sk-ant-api03-fake-0123 rejected", [])).toBe("auth [redacted] rejected");
    expect(redact("header Authorization: Bearer fake.jwt.token", [])).toBe("header Authorization: Bearer [redacted]");
    expect(redact(`token ${"fakeOpaqueToken".repeat(3)} expired`, [])).toBe("token [redacted] expired");
  });

  it("keeps addresses, hashes and ordinary words, which the journal and the halt reasons need", () => {
    const hash = `0x${"ab".repeat(32)}`;
    const line = `no receipt for ${hash}: Timed out; vault 0x3f956072d18ddd20d5efb74e9ccabf8deade699b; MARKET_CLOSED:overnight`;
    expect(redact(line, s)).toBe(line);
  });
});

describe("oneLine", () => {
  const s = secretValues(ENV);

  it("keeps the first non-empty line of the message only", () => {
    expect(oneLine(new Error("\n  rate limited  \nURL: " + RPC + "\nRequest body: {}"), s)).toBe("rate limited");
    expect(oneLine("plain string\nsecond", s)).toBe("plain string");
    expect(oneLine(42, s)).toBe("42");
  });

  it("gives viem's HTTP error without the URL it lists below", () => {
    const e = new HttpRequestError({ url: RPC, body: { method: "eth_call" }, details: "fetch failed" });
    expect(e.message).toContain(RPC);
    expect(oneLine(e, s)).toBe("HTTP request failed.");
  });

  it("redacts the line it keeps and cuts it to MAX_LINE_CHARS", () => {
    expect(oneLine(new Error(`connect to ${RPC} refused`), s)).toBe("connect to [redacted] refused");
    const long = oneLine(new Error("word ".repeat(200)), s);
    expect(long).toHaveLength(MAX_LINE_CHARS);
    expect(long.endsWith("...")).toBe(true);
  });

  it("reads secrets from process.env by default", () => {
    process.env.MAAT_REDACT_TEST_TOKEN = "fake-token-from-process-env";
    try {
      expect(oneLine(new Error("got fake-token-from-process-env back"))).toBe("got [redacted] back");
    } finally {
      delete process.env.MAAT_REDACT_TEST_TOKEN;
    }
  });
});
