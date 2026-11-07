import { describe, expect, it } from "vitest";
import { previewIntent, type PreviewClient } from "../src/chain/preview.js";
import type { OnchainIntent } from "../src/types.js";

const VAULT = "0x1111111111111111111111111111111111111111" as const;
const EXEC = "0x2222222222222222222222222222222222222222" as const;
const intent: OnchainIntent = {
  id: `0x${"11".repeat(32)}`,
  action: 0,
  token: "0xb20000000000000000000078ee7ce2fE4908108C",
  amount: 1n,
  minOut: 0n,
  payee: "0x0000000000000000000000000000000000000000",
  rationaleHash: `0x${"22".repeat(32)}`,
};

function client(answer: () => Promise<unknown>, seen: unknown[]): PreviewClient {
  return { readContract: (async (p: unknown) => (seen.push(p), answer())) as PreviewClient["readContract"] };
}

describe("previewIntent", () => {
  it("calls previewIntent as the executor at the pinned block", async () => {
    const seen: unknown[] = [];
    const r = await previewIntent(client(async () => 6, seen), VAULT, EXEC, intent, 123n);
    expect(r).toEqual({ result: "MARKET_CLOSED" });
    expect(seen[0]).toMatchObject({ address: VAULT, functionName: "previewIntent", args: [intent], account: EXEC, blockNumber: 123n });
  });
  it("returns OK", async () => {
    expect(await previewIntent(client(async () => 0, []), VAULT, EXEC, intent)).toEqual({ result: "OK" });
  });
  it("returns UNKNOWN with the RPC error when the call fails", async () => {
    expect(await previewIntent(client(async () => Promise.reject(new Error("timeout\nmore detail")), []), VAULT, EXEC, intent)).toEqual({ result: "UNKNOWN", error: "timeout" });
  });
  it("returns UNKNOWN for a reason id the agent does not know", async () => {
    expect(await previewIntent(client(async () => 42, []), VAULT, EXEC, intent)).toEqual({ result: "UNKNOWN", error: "unknown reason id 42" });
  });
});
