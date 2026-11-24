import { fireEvent, render, screen, within } from "@testing-library/react";
import { keccak256, toBytes, type Hex } from "viem";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import LedgerPage from "@/app/(site)/ledger/page";
import { HowWeRead } from "@/components/ledger/HowWeRead";
import { LedgerApp } from "@/components/ledger/LedgerApp";
import { Ledger } from "@/components/sections/Ledger";
import type { LedgerState } from "@/components/ledger/useLedger";
import { formatInt } from "@/content/format";
import { SCAN_FLOOR_BLOCK } from "@/lib/chain/config";
import { loadLedger, type LedgerSnapshot } from "@/lib/chain/load";
import type { Treasury } from "@/lib/chain/treasury";
import { decisionLog, FAKE_USDC, FAKE_VAULT, fakeLedgerClient, hash32, memoryStorage, NVDAC } from "./helpers/fake-ledger";

const hook = vi.hoisted(() => ({ state: { mode: "waiting" } as LedgerState, retry: vi.fn() }));
vi.mock("@/components/ledger/useLedger", () => ({ useLedger: () => ({ ...hook.state, retry: hook.retry }) }));

const DEPLOY = SCAN_FLOOR_BLOCK + 10_000n;
const HEAD = DEPLOY + 120_000n;
const T0 = 1_795_707_000; // Thu 26 Nov 2026 15:30 UTC
const VERIFIED_TEXT = "NVDAc is 12 points under target; buying $20 in session.";
const ok = <T,>(value: T) => ({ ok: true as const, value });
const NO = { ok: false as const };

const treasury: Treasury = {
  blockNumber: HEAD,
  timestamp: T0 + 7300,
  owner: "0x0000000000000000000000000000000000000001",
  executor: "0x0000000000000000000000000000000000000002",
  paused: false,
  mandate: {
    sessionMode: 0,
    maxPremiumBps: 100,
    maxSlippageBps: 100,
    maxStaleness: 3600,
    multiplierCooldown: 86_400,
    twapWindow: 1800,
    perTradeCapUsd: 60_000_000n,
    dailyCapUsd: 100_000_000n,
    calendar: "0x0000000000000000000000000000000000000c01",
    swapAdapter: "0x0000000000000000000000000000000000000c02",
    creditAdapter: "0x0000000000000000000000000000000000000c03",
    minHealthFactor: 1_500_000_000_000_000_000n,
    targetHealthFactor: 2_000_000_000_000_000_000n,
    deriskWindow: 28_800,
  },
  mandateHash: hash32(77),
  usdcAddress: FAKE_USDC,
  usdc: ok(30_000_000n),
  tokens: [
    {
      address: NVDAC,
      symbol: "NVDAc",
      decimals: ok(18),
      raw: ok(81_000_000_000_000_000n),
      ui: ok(81_043_570_000_000_000n),
      supplied: ok(0n),
      price8: ok(18_512_000_000n),
      feedAgeSec: ok(14),
      maxWeightBps: ok(4000),
      valueUsd6: ok(14_994_720n),
      weightBps: 3332,
    },
    {
      address: "0xb20000000000000000000000000000000000600D",
      symbol: "GOOGLc",
      decimals: ok(18),
      raw: ok(10n ** 17n),
      ui: ok(10n ** 17n),
      supplied: ok(0n),
      price8: NO,
      feedAgeSec: NO,
      maxWeightBps: ok(4000),
      valueUsd6: NO,
      weightBps: null,
    },
  ],
  credit: { debt: ok(5_000_000n), healthFactor: ok(2_400_000_000_000_000_000n) },
  equityUsd6: NO,
};

let snapshot: LedgerSnapshot;
beforeAll(async () => {
  const client = fakeLedgerClient({
    head: HEAD,
    logs: [
      decisionLog(1, DEPLOY + 5n, { rationaleHash: keccak256(toBytes(VERIFIED_TEXT)) }),
      decisionLog(2, DEPLOY + 60_000n, { reason: "MARKET_CLOSED", amount: 10_000_000n }),
      decisionLog(3, HEAD - 10n, { reason: "SIZE_LIMIT", amount: 90_000_000n }),
    ],
    times: { [String(DEPLOY + 5n)]: T0, [String(DEPLOY + 60_000n)]: T0 + 3600, [String(HEAD - 10n)]: T0 + 7200, [String(HEAD)]: T0 + 7300 },
    deployTx: { hash: hash32(42), block: DEPLOY },
  });
  const texts = new Map<Hex, string>([
    [hash32(1001), VERIFIED_TEXT],
    [hash32(1002), "This text was edited after the fact."],
  ]);
  const loaded = await loadLedger({
    client,
    vault: FAKE_VAULT,
    deployTx: hash32(42),
    storage: memoryStorage(),
    rationaleSource: { name: "test", lookup: async (ids) => new Map(ids.flatMap((id) => (texts.has(id) ? [[id, texts.get(id)!] as const] : []))) },
    now: () => (T0 + 7300) * 1000,
  });
  snapshot = {
    ...loaded,
    treasury,
    summary: { ...loaded.summary, pending: [{ kind: "mandate", changeHash: hash32(9), eta: T0 + 86_400, status: "waiting" }] },
  };
});

beforeEach(() => {
  hook.retry.mockReset();
});

const mainnet = (): LedgerState => ({
  mode: "mainnet",
  snapshot,
  endpoints: ["https://base-rpc.publicnode.com", "https://mainnet.base.org"],
  loading: false,
  refreshError: null,
});

describe("/ledger as the build exports it", () => {
  it("connects instead of waiting, because the committed deployments table records the vault", () => {
    hook.state = { mode: "loading-config" };
    render(<LedgerPage />);
    expect(screen.getByText(/Connecting to Base/)).toBeInTheDocument();
    expect(screen.queryByText("Waiting for the mainnet deploy")).toBeNull();
  });
});

describe("/ledger while the deployments file has no vault", () => {
  beforeEach(() => {
    hook.state = { mode: "waiting" };
  });

  it("says it is waiting, and never calls anything live", () => {
    const { container } = render(<LedgerApp initial="waiting" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Mainnet ledger");
    expect(screen.getByText("Waiting for the mainnet deploy")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\blive\b/i);
  });

  it("shows the configured mandate, labeled as configured", () => {
    render(<LedgerApp initial="waiting" />);
    const mandate = screen.getByRole("region", { name: "Mandate" });
    const row = within(mandate).getByText("Per-trade cap").closest("tr")!;
    expect(row).toHaveTextContent("$50");
    expect(within(mandate).getAllByText("configured").length).toBeGreaterThan(0);
  });

  it("shows every chart's empty state", () => {
    render(<LedgerApp initial="waiting" />);
    expect(screen.getByText("No decisions yet.")).toBeInTheDocument();
    expect(screen.getByText("No refusals yet.")).toBeInTheDocument();
  });

  it("renders the waiting view while the deployments file loads, so the static HTML matches the build", () => {
    hook.state = { mode: "loading-config" };
    render(<LedgerApp initial="waiting" />);
    expect(screen.getByText("Waiting for the mainnet deploy")).toBeInTheDocument();
  });

  it("says it is connecting when the build recorded a vault", () => {
    hook.state = { mode: "loading-config" };
    render(<LedgerApp initial="loading" />);
    expect(screen.getByText(/Connecting to Base/)).toBeInTheDocument();
  });

  it("keeps the fork ledger on the page, and the nav points back to the landing", () => {
    render(<LedgerPage />);
    expect(screen.getByRole("region", { name: "Decision ledger" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "How it works" })).toHaveAttribute("href", "/#how");
    expect(within(nav).getByRole("link", { name: "Ledger" })).toHaveAttribute("href", "/ledger");
  });
});

describe("/ledger reading mainnet", () => {
  beforeEach(() => {
    hook.state = mainnet();
  });

  it("names the block it read and links the vault on Basescan", () => {
    render(<LedgerApp initial="loading" />);
    expect(screen.getByText(/Reading Base mainnet/)).toHaveTextContent(`block ${formatInt(Number(HEAD))}`);
    expect(screen.getByRole("link", { name: /vault on Basescan/ })).toHaveAttribute("href", `https://basescan.org/address/${FAKE_VAULT}`);
  });

  it("lists every decision newest first, each linking its transaction", () => {
    render(<LedgerApp initial="loading" />);
    const items = within(screen.getByRole("list", { name: "Mainnet decisions" })).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]!).getByRole("link", { name: /Basescan/ })).toHaveAttribute("href", `https://basescan.org/tx/${hash32(3)}`);
    expect(items[0]).toHaveTextContent("SIZE_LIMIT");
  });

  it("names each verdict in plain words, with the onchain code beside it", () => {
    render(<LedgerApp initial="loading" />);
    const items = within(screen.getByRole("list", { name: "Mainnet decisions" })).getAllByRole("listitem");
    expect(within(items[0]!).getByText("Refused · Over the size limit")).toBeInTheDocument();
    expect(within(items[0]!).getByText("SIZE_LIMIT", { selector: "code" })).toBeInTheDocument();
    expect(within(items[2]!).getByText("Allowed · All checks passed")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("group", { name: /Refusals by reason/ })).getByRole("button", { name: /Market closed/ }));
    expect(screen.getByRole("button", { name: /Market closed\s*MARKET_CLOSED.*clear the reason filter/ })).toBeInTheDocument();
  });

  it("checks each rationale against its onchain hash", () => {
    render(<LedgerApp initial="loading" />);
    expect(screen.getByText("Hash verified")).toBeInTheDocument();
    expect(screen.getByText("Hash mismatch")).toBeInTheDocument();
    expect(screen.getByText("Rationale not exported yet")).toBeInTheDocument();
    expect(screen.getByText(VERIFIED_TEXT)).toBeInTheDocument();
  });

  it("does not call a rationale unexported while it is still being checked, or when the text could not be read", () => {
    hook.state = { ...mainnet(), snapshot: { ...snapshot, rationales: new Map(), rationaleState: "checking" }, loading: true } as LedgerState;
    const { unmount } = render(<LedgerApp initial="loading" />);
    expect(screen.getAllByText("Checking rationale…")).toHaveLength(3);
    expect(screen.queryByText("Rationale not exported yet")).toBeNull();
    unmount();

    hook.state = { ...mainnet(), snapshot: { ...snapshot, rationales: new Map(), rationaleState: "unavailable" } } as LedgerState;
    render(<LedgerApp initial="loading" />);
    expect(screen.getAllByText("Rationale text unavailable")).toHaveLength(3);
    expect(screen.queryByText("Rationale not exported yet")).toBeNull();
  });

  it("filters the timeline to the refusal reason picked in the chart", () => {
    render(<LedgerApp initial="loading" />);
    const list = () => within(screen.getByRole("list", { name: "Mainnet decisions" })).getAllByRole("listitem");
    const bar = within(screen.getByRole("group", { name: /Refusals by reason/ })).getByRole("button", { name: /MARKET_CLOSED/ });
    fireEvent.click(bar);
    expect(list()).toHaveLength(1);
    expect(list()[0]).toHaveTextContent("MARKET_CLOSED");
    fireEvent.click(bar);
    expect(list()).toHaveLength(3);
  });

  it("shows the quantity a holder sees, and 'unavailable' for a read that failed", () => {
    render(<LedgerApp initial="loading" />);
    const table = screen.getByRole("table", { name: "Treasury" });
    expect(within(table).getByText("NVDAc").closest("tr")).toHaveTextContent("0.081");
    expect(within(table).getByText("GOOGLc").closest("tr")).toHaveTextContent("unavailable");
    expect(screen.getByText("Net equity").parentElement).toHaveTextContent("unavailable");
  });

  it("flags a mandate value that differs from the configured default, and lists a pending change", () => {
    render(<LedgerApp initial="loading" />);
    const mandate = screen.getByRole("region", { name: "Mandate" });
    const row = within(mandate).getByText("Per-trade cap").closest("tr")!;
    expect(row).toHaveTextContent("$60");
    expect(row).toHaveTextContent("default $50");
    expect(within(mandate).getByText("Mandate change")).toBeInTheDocument();
  });

  it("says who sent the intents only as far as the chain shows it", () => {
    // The vault records the executor's address, not who runs it, and the owner can be the executor (as at the deploy).
    const { container, unmount } = render(<LedgerApp initial="loading" />);
    expect(screen.getByText(/Every intent sent to the vault/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/the agent sends|Executor \(the agent\)/);
    const who = screen.getByRole("heading", { name: "Who and what" }).parentElement!;
    expect(within(who).getByText("Executor")).toBeInTheDocument();
    expect(who).not.toHaveTextContent("same address as the owner");
    unmount();

    hook.state = { ...mainnet(), snapshot: { ...snapshot, treasury: { ...treasury, executor: treasury.owner } } } as LedgerState;
    render(<LedgerApp initial="loading" />);
    const same = screen.getByRole("heading", { name: "Who and what" }).parentElement!;
    expect(within(same).getByText("Executor · same address as the owner")).toBeInTheDocument();
  });

  it("does not name the agent's journal as the missing source of a rationale", () => {
    render(<LedgerApp initial="loading" />);
    const badge = screen.getByText("Rationale not exported yet");
    expect(badge.getAttribute("title")).not.toMatch(/agent/);
    expect(badge.getAttribute("title")).toMatch(/hash onchain still commits to its text/);
  });

  it("says the health factor is unavailable, not waiting for the deploy, when the treasury read failed", () => {
    hook.state = { ...mainnet(), snapshot: { ...snapshot, treasury: null, treasuryError: "multicall failed" } } as LedgerState;
    render(<LedgerApp initial="loading" />);
    expect(screen.queryByText(/once the vault is deployed/)).toBeNull();
    expect(screen.getByText("Health factor unavailable: the vault's balances could not be read.")).toBeInTheDocument();
  });

  it("draws the health factor from the credit adapter", () => {
    render(<LedgerApp initial="loading" />);
    expect(screen.getByRole("img", { name: /Health factor 2.40/ })).toBeInTheDocument();
  });

  it("reports a refresh that failed without dropping the data", () => {
    hook.state = { ...mainnet(), refreshError: "rpc down" } as LedgerState;
    render(<LedgerApp initial="loading" />);
    expect(screen.getByText(/rpc down/)).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Mainnet decisions" })).getAllByRole("listitem")).toHaveLength(3);
  });
});

describe("/ledger when Base cannot be read", () => {
  it("shows the error, a retry and the vault's events on Basescan", () => {
    hook.state = { mode: "error", message: `${FAKE_VAULT} has no contract on Base mainnet.`, vault: FAKE_VAULT };
    render(<LedgerApp initial="loading" />);
    expect(screen.getByText(`${FAKE_VAULT} has no contract on Base mainnet.`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(hook.retry).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: /events on Basescan/ })).toHaveAttribute("href", `https://basescan.org/address/${FAKE_VAULT}#events`);
  });
});

describe("the landing's ledger section", () => {
  it("links to the mainnet ledger page", () => {
    render(<Ledger />);
    expect(screen.getByRole("link", { name: "Open the mainnet ledger" })).toHaveAttribute("href", "/ledger");
  });
});

describe("how the page reads Base", () => {
  it("names the RPCs the page tries, NEXT_PUBLIC_BASE_RPC_URL first, and does not claim a single multicall", () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_RPC_URL", "https://rpc.example/some-key");
    try {
      const { container } = render(<HowWeRead />);
      expect(container).toHaveTextContent("rpc.example, falling back to base-rpc.publicnode.com, falling back to mainnet.base.org");
      expect(container.textContent).not.toMatch(/one multicall/);
      expect(container.textContent).not.toContain("some-key");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
