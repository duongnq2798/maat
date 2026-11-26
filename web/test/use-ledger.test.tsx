import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLedger, type LedgerDeps } from "@/components/ledger/useLedger";
import { cacheKey, memoryStorage } from "@/lib/chain/cache";
import { SCAN_FLOOR_BLOCK } from "@/lib/chain/config";
import type { LedgerClient } from "@/lib/chain/load";
import type { RationaleSource } from "@/lib/chain/rationale";
import { SNAPSHOT_REORG_WINDOW } from "@/lib/chain/snapshot";
import snapshotFixture from "./fixtures/decisions-snapshot.json";
import { decisionLog, FAKE_VAULT, fakeLedgerClient, hash32, type FakeChain } from "./helpers/fake-ledger";
import { SNAP_BLOCK, SNAP_DEPLOY, SNAP_DEPLOY_TX, SNAP_HEAD, snapshotChain } from "./helpers/snapshot-chain";

const DEPLOY = SCAN_FLOOR_BLOCK + 10_000n;
const HEAD = DEPLOY + 60_000n;
const T0 = 1_795_707_000; // Thu 26 Nov 2026 15:30 UTC
const noRationales: RationaleSource = { name: "none", lookup: async () => new Map() };
const ENDPOINTS = ["https://rpc.test"];

const fullChain = (): FakeChain => ({
  head: HEAD,
  logs: [decisionLog(1, DEPLOY + 5n), decisionLog(2, HEAD - 10n, { reason: "MARKET_CLOSED" })],
  times: { [String(DEPLOY + 5n)]: T0, [String(HEAD - 10n)]: T0 + 3600, [String(HEAD)]: T0 + 3700 },
  deployTx: { hash: hash32(42), block: DEPLOY },
});

const deployed = async () => ({ vault: FAKE_VAULT, deployTx: hash32(42) });

function hook(deps: LedgerDeps) {
  return renderHook(() => useLedger({ rationaleSource: noRationales, endpoints: ENDPOINTS, storage: memoryStorage(), now: () => (T0 + 3700) * 1000, ...deps }));
}

/** A client whose every method fails the test if called. */
function untouchableClient() {
  const fail = vi.fn(async () => {
    throw new Error("the client was called");
  });
  const methods = ["getBlockNumber", "getBytecode", "readContract", "multicall", "getBlock", "getLogs", "getTransactionReceipt"] as const;
  return { client: Object.fromEntries(methods.map((m) => [m, fail])) as unknown as LedgerClient, fail };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useLedger", () => {
  it("waits for the deploy without calling Base when the deployments file has no vault", async () => {
    const { client, fail } = untouchableClient();
    const { result } = hook({ client, fetchDeployments: async () => ({ vault: null, deployTx: null }) });
    expect(result.current.mode).toBe("loading-config");
    await waitFor(() => expect(result.current.mode).toBe("waiting"));
    expect(fail).not.toHaveBeenCalled();
  });

  it("reads /data/deployments.json by default", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ network: "Base mainnet", chainId: 8453, vault: null, deployTx: null, contracts: [] })));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = hook({ client: untouchableClient().client });
    await waitFor(() => expect(result.current.mode).toBe("waiting"));
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe("/data/deployments.json");
  });

  it("reports a deployments file it cannot read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 200 })));
    const { result } = hook({ client: untouchableClient().client });
    await waitFor(() => expect(result.current.mode).toBe("error"));
    expect(result.current.mode === "error" && result.current.message).toMatch(/deployments/);
  });

  it("names the address when it holds no MandateVault", async () => {
    const { result } = hook({ client: fakeLedgerClient({ ...fullChain(), bytecode: "0x" }), fetchDeployments: deployed });
    await waitFor(() => expect(result.current.mode).toBe("error"));
    expect(result.current).toMatchObject({ mode: "error", vault: FAKE_VAULT });
    expect(result.current.mode === "error" && result.current.message).toContain(FAKE_VAULT);
  });

  it("reads the vault: decisions newest first, a finished scan, the summary, and a saved cache", async () => {
    const storage = memoryStorage();
    const { result } = hook({ client: fakeLedgerClient(fullChain()), fetchDeployments: deployed, storage });
    await waitFor(() => expect(result.current.mode === "mainnet" && !result.current.loading).toBe(true));
    const s = result.current;
    if (s.mode !== "mainnet") throw new Error("not mainnet");
    expect(s.snapshot.decisions.map((d) => d.intentId)).toEqual([hash32(1002), hash32(1001)]);
    expect(s.snapshot.scan.done).toBe(true);
    expect(s.snapshot.summary).toMatchObject({ allowed: 1, refused: 1 });
    expect(s.endpoints).toEqual(ENDPOINTS);
    expect(storage.getItem(cacheKey(FAKE_VAULT))).not.toBeNull();
  });

  it("starts over on retry", async () => {
    const fetchDeployments = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue({ vault: null, deployTx: null });
    const { result } = hook({ client: untouchableClient().client, fetchDeployments });
    await waitFor(() => expect(result.current.mode).toBe("error"));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.mode).toBe("waiting"));
  });

  it("rereads the vault on a timer while the tab is visible, keeping the data when a refresh fails", async () => {
    const chain = fullChain();
    const client = fakeLedgerClient(chain);
    const { result } = hook({ client, fetchDeployments: deployed, refreshMs: 20 });
    await waitFor(() => expect(result.current.mode === "mainnet" && !result.current.loading).toBe(true));
    const first = client.logCalls.length;
    await waitFor(() => expect(client.logCalls.length).toBeGreaterThan(first));

    chain.failTreasury = true;
    vi.spyOn(client, "getBlockNumber").mockRejectedValue(new Error("rpc down"));
    await waitFor(() => expect(result.current.mode === "mainnet" && result.current.refreshError).toMatch(/rpc down/));
    expect(result.current.mode === "mainnet" && result.current.snapshot.decisions).toHaveLength(2);
  });

  it("starts the first read from the committed snapshot, fetched once the deployments file names a vault", async () => {
    const fetchSnapshot = vi.fn(async () => snapshotFixture as unknown);
    const client = fakeLedgerClient(snapshotChain());
    const { result } = hook({ client, fetchDeployments: async () => ({ vault: FAKE_VAULT, deployTx: SNAP_DEPLOY_TX }), fetchSnapshot, refreshMs: 60_000 });
    await waitFor(() => expect(result.current.mode === "mainnet" && !result.current.loading).toBe(true));
    const s = result.current;
    if (s.mode !== "mainnet") throw new Error("not mainnet");
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(s.snapshot.scan.fromSnapshot?.block).toBe(SNAP_BLOCK);
    expect(client.logCalls.reduce((m, c) => (c.from < m ? c.from : m), SNAP_BLOCK)).toBe(SNAP_BLOCK - SNAPSHOT_REORG_WINDOW);
    expect(s.snapshot.decisions).toHaveLength(4);
  });

  it("asks for no snapshot while the deployments file has no vault", async () => {
    const fetchSnapshot = vi.fn(async () => snapshotFixture as unknown);
    const { result } = hook({ client: untouchableClient().client, fetchDeployments: async () => ({ vault: null, deployTx: null }), fetchSnapshot });
    await waitFor(() => expect(result.current.mode).toBe("waiting"));
    expect(fetchSnapshot).not.toHaveBeenCalled();
  });

  it("reads /data/decisions-snapshot.json by default, and scans from the deploy block when it holds no snapshot", async () => {
    const fetchMock = vi.fn(async (url: string) => (url === "/data/decisions-snapshot.json" ? new Response("null\n") : Promise.reject(new TypeError("offline"))));
    vi.stubGlobal("fetch", fetchMock);
    const client = fakeLedgerClient(snapshotChain());
    const { result } = hook({ client, fetchDeployments: async () => ({ vault: FAKE_VAULT, deployTx: SNAP_DEPLOY_TX }), refreshMs: 60_000 });
    await waitFor(() => expect(result.current.mode === "mainnet" && !result.current.loading).toBe(true));
    expect(fetchMock.mock.calls.map((c) => c[0])).toContain("/data/decisions-snapshot.json");
    expect(client.logCalls.reduce((m, c) => (c.from < m ? c.from : m), SNAP_HEAD)).toBe(SNAP_DEPLOY);
    expect(result.current.mode === "mainnet" && result.current.snapshot.scan.fromSnapshot).toBeNull();
  });

  it("does not reread while the tab is hidden", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const client = fakeLedgerClient(fullChain());
    const { result } = hook({ client, fetchDeployments: deployed, refreshMs: 10 });
    await waitFor(() => expect(result.current.mode === "mainnet" && !result.current.loading).toBe(true));
    const first = client.logCalls.length;
    await new Promise((r) => setTimeout(r, 80));
    expect(client.logCalls.length).toBe(first);
  });
});
