import { readFileSync } from "node:fs";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { getAddress, keccak256, toBytes } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerDeps } from "@/components/ledger/useLedger";
import { HeroCard } from "@/components/sections/HeroCard";
import { VaultBarStatus, VaultCard, VaultPlate } from "@/components/sections/Vault";
import { VaultDecisionsProvider } from "@/components/sections/VaultDecisions";
import { intentText, RECORDED_ROWS, toVaultRow } from "@/components/sections/vault-rows";
import { FACTS } from "@/content/facts";
import { formatInt } from "@/content/format";
import addresses from "@/content/generated/base-addresses.json";
import deployments from "@/content/generated/deployments.json";
import { REASON_LABEL } from "@/content/reasons";
import type { CachedLog } from "@/lib/chain/cache";
import { deploymentConfig } from "@/lib/chain/config";
import { decodeVaultLogs } from "@/lib/chain/events";
import { toMainnetDecisions } from "@/lib/chain/ledger";
import type { RationaleSource } from "@/lib/chain/rationale";
import { basescanTx } from "@/lib/live/basescan";
import { executeInput, OWNER } from "./helpers/card";
import { decisionLog, fakeLedgerClient, hash32, memoryStorage, type FakeChain } from "./helpers/fake-ledger";

const RECORDED = FACTS.mainnetDecisions.value;
const USDC = getAddress(addresses.find((a) => a.name === "USDC")!.value);
/** A compute bill's maat:v1 blob, as the agent's code writes it (kind "bill"). */
const BILL_BLOB = `maat:v1:{"b":62500000,"c":"0123456789abcdef0123456789abcdef01234567","j":"0x${"0".repeat(64)}","k":"bill","r":"run-landing-test","s":[],"t":"Compute bill: $1.000000 of Claude API usage unpaid as of UTC day 20784"}`;
const BILL_HASH = keccak256(toBytes(BILL_BLOB));
const asLog = ({ blockNumber, logIndex, transactionHash, topics, data }: (typeof RECORDED)[number]): CachedLog => ({
  blockNumber,
  logIndex,
  transactionHash,
  topics: [...topics],
  data,
});

describe("the recorded Decisions", () => {
  it("decode as the ledger's loader decodes them, newest first", () => {
    const blockTimes = Object.fromEntries(RECORDED.map((l) => [l.blockNumber, l.blockTime]));
    const gasUsed = Object.fromEntries(RECORDED.map((l) => [l.transactionHash, l.gasUsed]));
    const decisions = toMainnetDecisions(decodeVaultLogs(RECORDED.map(asLog)), { blockTimes, gasUsed, decimals: {}, usdc: USDC });
    expect(decisions).toHaveLength(RECORDED.length);
    expect(RECORDED_ROWS).toEqual(decisions.map((d) => toVaultRow(d)));
  });

  it("are the deployed vault's, and match the transactions the status page records", () => {
    // Vitest runs in web/.
    const status = readFileSync("content/docs/get-started/status.mdx", "utf8");
    const vault = deploymentConfig(deployments)!.vault;
    for (const l of RECORDED) {
      expect(getAddress(l.address)).toBe(vault);
      expect(status).toContain(`(https://basescan.org/tx/${l.transactionHash})`);
      expect(status).toContain(`block \`${l.blockNumber}\``);
      const utc = new Date(l.blockTime * 1000).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
      expect(status).toContain(utc);
    }
    const [allowed, refused] = RECORDED_ROWS;
    expect(allowed).toMatchObject({ allowed: true, reason: "OK", action: "BUY", symbol: "NVDAc", amountLabel: "$5.00", timeLabel: "Tue 24 Nov 11:59" });
    expect(refused).toMatchObject({ allowed: false, reason: "MARKET_CLOSED", action: "BUY", symbol: "NVDAc", amountLabel: "$5.00", timeLabel: "Tue 24 Nov 09:28" });
  });
});

const DEPLOY = 61_698_517n;
const NEWEST = RECORDED_ROWS[0]!;
const HEAD = BigInt(NEWEST.block) + 1_000n;
const NEW_TIME = NEWEST.timestamp! + 1_980; // 990 blocks after the newest recorded one, at 2 s a block
const AGE_SEC = 2 * 3600 + 5 * 60;
// The reader is its own chunk (viem and the ABIs), loaded on mount: under a full parallel run it can take seconds.
const READ = { timeout: 15_000 };
// A test that waits for the reader gets more than Vitest's 5 s default, room for two READ waits.
const WAITS = 40_000;
const noRationales: RationaleSource = { name: "none", lookup: async () => new Map() };

/** The vault's chain: the recorded Decisions, then a newer refusal at HEAD - 10. */
function chain(): FakeChain {
  return {
    head: HEAD,
    logs: [...RECORDED.map(asLog), decisionLog(9, HEAD - 10n, { reason: "MARKET_CLOSED", amount: 20_000_000n })],
    times: { ...Object.fromEntries(RECORDED.map((l) => [l.blockNumber, l.blockTime])), [String(HEAD - 10n)]: NEW_TIME, [String(HEAD)]: NEW_TIME + 20 },
    gas: { ...Object.fromEntries(RECORDED.map((l) => [l.transactionHash, BigInt(l.gasUsed)])), [hash32(9)]: 111_116n },
    deployTx: { hash: hash32(42), block: DEPLOY },
  };
}

function deps(c: FakeChain): LedgerDeps {
  return {
    fetchDeployments: async () => ({ vault: deploymentConfig(deployments)!.vault, deployTx: hash32(42) }),
    client: fakeLedgerClient(c),
    endpoints: ["https://rpc.test"],
    rationaleSource: noRationales,
    storage: memoryStorage(),
    now: () => (NEW_TIME + AGE_SEC) * 1000,
  };
}

function landing(d: LedgerDeps) {
  return render(
    <VaultDecisionsProvider deps={d}>
      <VaultBarStatus />
      <VaultPlate />
      <VaultCard />
    </VaultDecisionsProvider>,
  );
}

const plate = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-vault-plate]")!;
const card = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-vault-card]")!;

describe("the landing's view of the mainnet vault", () => {
  beforeEach(() => {
    // Only Date is faked, so the age the plate gives is fixed while the loader's own timers run.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime((NEW_TIME + AGE_SEC) * 1000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the recorded Decisions without a provider, and names no fork", () => {
    const { container } = render(
      <>
        <VaultBarStatus />
        <VaultPlate />
        <VaultCard />
      </>,
    );
    expect(plate(container)).toHaveAttribute("data-vault-plate", "reading");
    expect(plate(container)).toHaveAttribute("href", basescanTx(NEWEST.txHash));
    expect(plate(container)).toHaveTextContent(`BASE MAINNET Recorded Decision: Allowed · ${intentText(NEWEST)} · ${NEWEST.timeLabel} ET`);
    expect(card(container)).toHaveTextContent("LATEST RECORDED DECISION");
    // The newest recorded Decision is allowed: its plate is the quiet accent tint, never the solid accent.
    const verdict = card(container).querySelector<HTMLElement>("[data-verdict]")!;
    expect(verdict).toHaveAttribute("data-verdict", "allowed");
    expect(verdict.className.split(" ")).toContain("bg-accent-tint");
    expect(verdict.className.split(" ")).not.toContain("bg-accent");
    expect(verdict).toHaveTextContent("Allowed");
    expect(card(container)).toHaveTextContent(`${RECORDED.length} Decisions recorded in this build. Reading the vault on Base…`);
    expect(container.querySelector("[data-vault-bar]")).toBeNull();
    expect(container.textContent).not.toMatch(/fork/i);
  });

  it("replaces them with the vault's Decisions read from Base, newest first, with the latest one's age", async () => {
    const { container } = landing(deps(chain()));
    expect(plate(container)).toHaveAttribute("data-vault-plate", "reading");
    await waitFor(() => expect(card(container)).toHaveAttribute("data-vault-card", "live"), READ);

    const p = plate(container);
    expect(p).toHaveAttribute("data-vault-plate", "live");
    expect(p).toHaveAttribute("href", basescanTx(hash32(9)));
    expect(p).toHaveTextContent(`BASE MAINNET Last Decision: Refused · ${REASON_LABEL.MARKET_CLOSED} · BUY NVDAc · $20.00 · 2 h 5 min ago`);
    expect(container.querySelector("[data-vault-bar]")).toHaveTextContent("Last Decision 2 h 5 min ago.");

    const c = card(container);
    expect(c).toHaveTextContent(`live · read to block ${formatInt(Number(HEAD))}`);
    expect(c).toHaveTextContent("LATEST DECISION");
    expect(c.querySelector("[data-verdict]")).toHaveAttribute("data-reason", "MARKET_CLOSED");
    const rows = within(within(c).getByRole("list", { name: "Recent decisions" })).getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("data-decision"))).toEqual(["refused", "allowed", "refused"]);
    expect(within(rows[1]!).getByRole("link")).toHaveAttribute("href", basescanTx(NEWEST.txHash));
    expect(c).toHaveTextContent("3 Decisions on Base mainnet, read from Base by your browser.");
    expect(container.textContent).not.toMatch(/fork/i);
  }, WAITS);

  it("gives a live Decision whose block time was not read its block, not a New York time", async () => {
    const c0 = chain();
    delete c0.times![String(HEAD - 10n)];
    const { container } = landing(deps(c0));
    await waitFor(() => expect(card(container)).toHaveAttribute("data-vault-card", "live"), READ);
    const block = `block ${formatInt(Number(HEAD - 10n))}`;

    const p = plate(container);
    expect(p).toHaveTextContent(`BASE MAINNET Last Decision: Refused · ${REASON_LABEL.MARKET_CLOSED} · BUY NVDAc · $20.00 · ${block}`);
    expect(p).not.toHaveTextContent(/\bET\b/);
    expect(p).toHaveAttribute("title", `Last Decision: Refused · ${REASON_LABEL.MARKET_CLOSED} · BUY NVDAc · $20.00 · ${block}`);
    // No age to give, so the bar stays empty.
    expect(container.querySelector("[data-vault-bar]")).toBeNull();

    const c = card(container);
    expect(c.querySelector("[data-latest-when]")).toHaveTextContent(new RegExp(`^${block}$`));
    const rows = within(within(c).getByRole("list", { name: "Recent decisions" })).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent(block);
    expect(rows[0]).not.toHaveTextContent(/\bET\b/);
    // The recorded Decisions keep their New York time.
    expect(rows[1]).toHaveTextContent(`${NEWEST.timeLabel} ET`);
  }, WAITS);

  it("labels a paid compute bill as a bill, with its amount and payee, on a neutral plate", async () => {
    const vault = deploymentConfig(deployments)!.vault;
    const c0 = chain();
    c0.logs = [...RECORDED.map(asLog), decisionLog(9, HEAD - 10n, { action: "PAY_EXPENSE", token: USDC, amount: 1_000_000n, rationaleHash: BILL_HASH })];
    c0.owner = OWNER;
    c0.txs = { [hash32(9)]: { from: OWNER, to: vault, input: executeInput({ action: "PAY_EXPENSE", token: USDC, amount: 1_000_000n, payee: OWNER, rationaleHash: BILL_HASH, blob: BILL_BLOB }) } };
    const { container } = landing(deps(c0));
    await waitFor(() => expect(card(container)).toHaveAttribute("data-vault-card", "live"), READ);

    const line = "Compute bill paid · $1.00 · to the owner's allowlisted address";
    const p = plate(container);
    expect(p).toHaveTextContent(`BASE MAINNET Last Decision: ${line} · 2 h 5 min ago`);
    expect(p).toHaveAttribute("title", `Last Decision: ${line} · 2 h 5 min ago`);

    const c = card(container);
    expect(c.querySelector("[data-latest-line]")).toHaveTextContent(line);
    const verdict = c.querySelector<HTMLElement>("[data-verdict]")!;
    expect(verdict).toHaveAttribute("data-verdict", "bill");
    expect(verdict).toHaveTextContent("Paid");
    expect(verdict).not.toHaveTextContent("Allowed");
    expect(verdict.className).not.toMatch(/(^|\s)bg-(accent|refuse|ink)(-|\s|$)/);
    const rows = within(within(c).getByRole("list", { name: "Recent decisions" })).getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("data-decision"))).toEqual(["bill", "allowed", "refused"]);
    expect(rows[0]).toHaveTextContent(line);
    // Never written as a trade.
    expect(container.textContent).not.toMatch(/PAY_EXPENSE|USDC/);
  }, WAITS);

  it("says the vault has made no Decision yet when Base has none", async () => {
    const { container } = landing(deps({ ...chain(), logs: [] }));
    await waitFor(() => expect(card(container)).toHaveAttribute("data-vault-card", "live"), READ);

    const p = plate(container);
    expect(p).toHaveAttribute("data-vault-plate", "live");
    expect(p.tagName).toBe("SPAN");
    expect(p).toHaveTextContent("BASE MAINNET The vault has made no Decision yet.");
    const c = card(container);
    expect(c).toHaveTextContent("The vault has made no Decision yet.");
    expect(c).toHaveTextContent("0 Decisions on Base mainnet, read from Base by your browser.");
    expect(within(c).queryByRole("list", { name: "Recent decisions" })).toBeNull();
    expect(c.querySelector("[data-verdict]")).toBeNull();
    expect(container.querySelector("[data-vault-bar]")).toBeNull();
  }, WAITS);

  it("keeps the recorded Decisions when the scan of the vault's logs leaves a gap", async () => {
    const { container } = landing(deps({ ...chain(), failLogs: true }));
    await waitFor(() => expect(card(container)).toHaveAttribute("data-vault-card", "recorded"), READ);
    expect(plate(container)).toHaveAttribute("data-vault-plate", "recorded");
    expect(plate(container)).toHaveAttribute("href", basescanTx(NEWEST.txHash));
    expect(card(container)).toHaveTextContent(`Could not read the vault on Base, so this shows the ${RECORDED.length} Decisions recorded in this build.`);
    expect(screen.getByRole("button", { name: "Read again" })).toBeInTheDocument();
    expect(container.querySelector("[data-vault-bar]")).toBeNull();
  }, WAITS);

  it("keeps the recorded Decisions when the read fails, and reads again on Read again", async () => {
    const c0 = { ...chain(), bytecode: "0x" as const };
    const { container } = landing(deps(c0));
    await waitFor(() => expect(card(container)).toHaveAttribute("data-vault-card", "recorded"), READ);
    expect(plate(container)).toHaveAttribute("data-vault-plate", "recorded");
    expect(plate(container)).toHaveAttribute("href", basescanTx(NEWEST.txHash));
    expect(card(container)).toHaveTextContent("recorded · could not read Base");
    expect(card(container)).toHaveTextContent(`Could not read the vault on Base, so this shows the ${RECORDED.length} Decisions recorded in this build.`);
    expect(container.querySelector("[data-vault-bar]")).toBeNull();

    // The fake client reads the chain on every call, so the next read finds the vault.
    delete (c0 as FakeChain).bytecode;
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Read again" }));
    });
    await waitFor(() => expect(card(container)).toHaveAttribute("data-vault-card", "live"), READ);
    expect(screen.queryByRole("button", { name: "Read again" })).toBeNull();
  }, WAITS);
});

describe("the hero's engine card", () => {
  it("opens on the mainnet vault, with the fork run one tab away", () => {
    render(<HeroCard />);
    const tabs = within(screen.getByRole("tablist", { name: "Decision engine" })).getAllByRole("tab");
    expect(tabs.map((t) => [t.textContent, t.getAttribute("aria-selected")])).toEqual([
      ["Base mainnet", "true"],
      ["Fork replay", "false"],
    ]);
    const mainnet = document.getElementById("engine-panel-mainnet")!;
    const fork = document.getElementById("engine-panel-fork")!;
    expect(mainnet).not.toHaveAttribute("hidden");
    expect(fork).toHaveAttribute("hidden");
    expect(mainnet.querySelector("[data-vault-card]")).not.toBeNull();
    expect(fork.querySelector('[role="status"]')).not.toBeNull();
    expect(mainnet.textContent).not.toMatch(/fork/i);

    fireEvent.click(tabs[1]!);
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveAttribute("tabindex", "0");
    expect(tabs[0]).toHaveAttribute("tabindex", "-1");
    expect(fork).not.toHaveAttribute("hidden");
    expect(mainnet).toHaveAttribute("hidden");
  });

  it("moves between the tabs with the arrow keys, Home and End", () => {
    render(<HeroCard />);
    const [mainnet, fork] = screen.getAllByRole("tab");
    mainnet!.focus();
    fireEvent.keyDown(mainnet!, { key: "ArrowRight" });
    expect(fork).toHaveAttribute("aria-selected", "true");
    expect(fork).toHaveFocus();
    fireEvent.keyDown(fork!, { key: "ArrowRight" });
    expect(mainnet).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(mainnet!, { key: "ArrowLeft" });
    expect(fork).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(fork!, { key: "Home" });
    expect(mainnet).toHaveAttribute("aria-selected", "true");
    expect(mainnet).toHaveFocus();
    fireEvent.keyDown(mainnet!, { key: "End" });
    expect(fork).toHaveAttribute("aria-selected", "true");
  });
});
