import { readFileSync } from "node:fs";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { getAddress, keccak256, toBytes } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerDeps } from "@/components/ledger/useLedger";
import { HeroCard } from "@/components/sections/HeroCard";
import { PROBE_GLOSS, probeGlossAt, VaultBarStatus, VaultCard, VERDICT_PLATE } from "@/components/sections/Vault";
import { VaultDecisionsProvider } from "@/components/sections/VaultDecisions";
import { intentText, RECORDED_ROWS, toVaultRow, type VaultRow } from "@/components/sections/vault-rows";
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
import { basescanDecision } from "@/lib/live/basescan";
import { AGENT, executeInput, NVDAC, OWNER, v1Blob } from "./helpers/card";
import { decisionLog, fakeLedgerClient, hash32, memoryStorage, type FakeChain } from "./helpers/fake-ledger";

const RECORDED = FACTS.mainnetDecisions.value;
const USDC = getAddress(addresses.find((a) => a.name === "USDC")!.value);
/** A compute bill's maat:v1 blob, as the agent's code writes it (kind "bill"). */
const BILL_BLOB = `maat:v1:{"b":62500000,"c":"0123456789abcdef0123456789abcdef01234567","j":"0x${"0".repeat(64)}","k":"bill","r":"run-landing-test","s":[],"t":"Compute bill: $1.000000 of Claude API usage unpaid as of UTC day 20784"}`;
const BILL_HASH = keccak256(toBytes(BILL_BLOB));
/** A probe's maat:v1 blob, as the agent's code writes it (kind "probe", its text after PROBE_TEXT_PREFIX). */
const PROBE_BLOB = v1Blob({ k: "probe", t: "PROBE v1, not a Claude proposal. Expected OK before the 13:00 ET early close." });
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
    // Each with the sender label the build records, which the loader takes from the transaction.
    const sender = (tx: string) => RECORDED.find((l) => l.transactionHash === tx)!.sender;
    expect(RECORDED_ROWS).toEqual(decisions.map((d) => toVaultRow(d, {}, sender(d.txHash))));
  });

  it("are the deployed vault's, and match the transactions the status page records", () => {
    // Vitest runs in web/.
    const status = readFileSync("content/docs/get-started/status.mdx", "utf8");
    const vault = deploymentConfig(deployments)!.vault;
    for (const l of RECORDED) {
      expect(getAddress(l.address)).toBe(vault);
      expect(status).toContain(`(https://basescan.org/tx/${l.transactionHash})`);
      expect(status).toContain(`block \`${l.blockNumber}\``);
      // A paragraph that links the transaction gives its block and its UTC date and time to the second:
      // "2026-11-24 14:28:15 UTC", or the date, then "02:14:46 UTC that day".
      const [date, time] = new Date(l.blockTime * 1000).toISOString().replace(/\.\d+Z$/, "").split("T");
      const dated = status
        .split("\n")
        .filter((line) => line.includes(`(https://basescan.org/tx/${l.transactionHash})`) && line.includes(`block \`${l.blockNumber}\``))
        .filter((line) => line.includes(date!) && line.includes(`${time} UTC`));
      expect(dated, `${l.transactionHash} at ${date} ${time} UTC`).not.toHaveLength(0);
    }
    const [agent, allowed, refused] = RECORDED_ROWS;
    expect(agent).toMatchObject({
      allowed: false,
      reason: "MARKET_CLOSED",
      action: "BUY",
      symbol: "GOOGLc",
      amountLabel: "$4.68",
      timeLabel: "Thu 26 Nov 21:14",
      rationaleHash: "0xb855268417f4edb7b305281f7d7afb5bd7dc5506878a9e36476cf0ca78e0a6c1",
      sender: "agent",
    });
    expect(allowed).toMatchObject({ allowed: true, reason: "OK", action: "BUY", symbol: "NVDAc", amountLabel: "$5.00", timeLabel: "Tue 24 Nov 11:59", sender: "owner, by hand" });
    expect(refused).toMatchObject({ allowed: false, reason: "MARKET_CLOSED", action: "BUY", symbol: "NVDAc", amountLabel: "$5.00", timeLabel: "Tue 24 Nov 09:28", sender: "owner, by hand" });
  });
});

describe("the card's gloss of a probe (cold read of 2026-11-28, gap 2)", () => {
  it("goes under the latest Decision when that is a probe, under the list when an older listed one is, else nowhere", () => {
    const row = (sender: VaultRow["sender"]) => ({ sender });
    expect(probeGlossAt([row("probe"), row("agent"), row("agent")])).toBe("latest");
    expect(probeGlossAt([row("agent"), row("probe"), row("probe")])).toBe("list");
    expect(probeGlossAt([row("agent"), row("owner, by hand"), row(null)])).toBeNull();
    expect(probeGlossAt([])).toBeNull();
  });

  it("says a probe is $1, as the agent sizes it", () => {
    expect(PROBE_GLOSS).toBe("A probe is a $1 test trade the owner scheduled, not a Claude proposal.");
    // Vitest runs in web/.
    expect(readFileSync("../agent/src/probes.ts", "utf8")).toContain("export const PROBE_USD = 1;");
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
      <VaultCard />
    </VaultDecisionsProvider>,
  );
}

const card = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-vault-card]")!;
/** The card's latest Decision: its intent line and the line under it, with its time, block, age and sender. */
const latestLine = (c: HTMLElement) => card(c).querySelector<HTMLElement>("[data-latest-line]")!;
const latestWhen = (c: HTMLElement) => card(c).querySelector<HTMLElement>("[data-latest-when]")!;
/** The Basescan link of the card's first row, the latest Decision. */
const firstLink = (c: HTMLElement) =>
  within(within(card(c)).getByRole("list", { name: "Recent decisions" }).querySelector("li")!).getByRole("link");

describe("the landing's view of the mainnet vault", () => {
  beforeEach(() => {
    // Only Date is faked, so the age the card gives is fixed while the loader's own timers run.
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
        <VaultCard />
      </>,
    );
    expect(card(container)).toHaveAttribute("data-vault-card", "reading");
    // The newest recorded Decision is the agent's refusal, linked to Basescan's Logs tab, where the refusal shows.
    expect(NEWEST).toMatchObject({ allowed: false, reason: "MARKET_CLOSED", sender: "agent" });
    expect(firstLink(container)).toHaveAttribute("href", basescanDecision(NEWEST.txHash));
    expect(card(container)).toHaveTextContent("LATEST RECORDED DECISION");
    expect(latestLine(container)).toHaveTextContent(intentText(NEWEST));
    expect(latestWhen(container)).toHaveTextContent(new RegExp(`^${NEWEST.timeLabel} ET · block [\\d,]+ · agent$`));
    expect(card(container).querySelector("[data-verdict]")).toHaveTextContent(`Refused${REASON_LABEL.MARKET_CLOSED}MARKET_CLOSED`);
    // The first ticker on the landing, named (spec 2026-11-27 section 4).
    expect(card(container).querySelector("[data-ticker-gloss]")).toHaveTextContent("GOOGLc (Alphabet, a B20 token on Base)");
    // A refusal sits on the loud plate, white on solid ink.
    const verdict = card(container).querySelector<HTMLElement>("[data-verdict]")!;
    expect(verdict).toHaveAttribute("data-verdict", "refused");
    expect(verdict.className.split(" ")).toContain("bg-ink");
    expect(verdict).toHaveTextContent("Refused");
    // An allowed one is the quiet accent tint, never the solid accent.
    expect(VERDICT_PLATE.allowed.box.split(" ")).toContain("bg-accent-tint");
    expect(VERDICT_PLATE.allowed.box.split(" ")).not.toContain("bg-accent");
    // Each row names its sender, as /ledger labels it: the agent's, then the owner's two sent by hand.
    const rows = within(within(card(container)).getByRole("list", { name: "Recent decisions" })).getAllByRole("listitem");
    expect(rows.map((r) => r.querySelector("[data-sender]")?.textContent)).toEqual([" · agent", " · owner, by hand", " · owner, by hand"]);
    expect(rows.map((r) => within(r).getByRole("link").getAttribute("href"))).toEqual(RECORDED_ROWS.map((r) => basescanDecision(r.txHash)));
    expect(card(container)).toHaveTextContent(`${RECORDED.length} Decisions recorded in this build. Reading the vault on Base…`);
    // The recorded rows hold no probe, so the static card says nothing of one.
    expect(card(container).querySelector("[data-probe-gloss]")).toBeNull();
    expect(container.querySelector("[data-vault-bar]")).toBeNull();
    expect(container.textContent).not.toMatch(/fork/i);
  });

  it("replaces them with the vault's Decisions read from Base, newest first, with the latest one's age", async () => {
    const { container } = landing(deps(chain()));
    expect(card(container)).toHaveAttribute("data-vault-card", "reading");
    await waitFor(() => expect(card(container)).toHaveAttribute("data-vault-card", "live"), READ);

    expect(firstLink(container)).toHaveAttribute("href", basescanDecision(hash32(9)));
    expect(latestLine(container)).toHaveTextContent("BUY NVDAc · $20.00");
    expect(latestWhen(container)).toHaveTextContent(" · 2 h 5 min ago");
    expect(card(container).querySelector("[data-ticker-gloss]")).toHaveTextContent("NVDAc (NVIDIA, a B20 token on Base)");
    expect(container.querySelector("[data-vault-bar]")).toHaveTextContent("Last Decision 2 h 5 min ago.");

    const c = card(container);
    expect(c).toHaveTextContent(`live · read to block ${formatInt(Number(HEAD))}`);
    expect(c).toHaveTextContent("LATEST DECISION");
    expect(c.querySelector("[data-verdict]")).toHaveAttribute("data-reason", "MARKET_CLOSED");
    const rows = within(within(c).getByRole("list", { name: "Recent decisions" })).getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("data-decision"))).toEqual(["refused", ...RECORDED_ROWS.slice(0, 2).map((r) => (r.allowed ? "allowed" : "refused"))]);
    expect(within(rows[1]!).getByRole("link")).toHaveAttribute("href", basescanDecision(NEWEST.txHash));
    // A Decision whose transaction this read did not label keeps none; a recorded one keeps the label this build records.
    expect(rows.map((r) => r.querySelector("[data-sender]")?.textContent ?? null)).toEqual([null, ...RECORDED_ROWS.slice(0, 2).map((r) => ` · ${r.sender}`)]);
    expect(c).toHaveTextContent(`${RECORDED.length + 1} Decisions on Base mainnet, read from Base by your browser.`);
    expect(container.textContent).not.toMatch(/fork/i);
  }, WAITS);

  it("gives a live Decision whose block time was not read its block, not a New York time", async () => {
    const c0 = chain();
    delete c0.times![String(HEAD - 10n)];
    const { container } = landing(deps(c0));
    await waitFor(() => expect(card(container)).toHaveAttribute("data-vault-card", "live"), READ);
    const block = `block ${formatInt(Number(HEAD - 10n))}`;

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
    expect(firstLink(container)).toHaveAttribute("href", basescanDecision(hash32(9)));
    expect(latestWhen(container)).toHaveTextContent(" · 2 h 5 min ago");
    // A bill names no ticker.
    expect(card(container).querySelector("[data-ticker-gloss]")).toBeNull();

    const c = card(container);
    expect(c.querySelector("[data-latest-line]")).toHaveTextContent(line);
    const verdict = c.querySelector<HTMLElement>("[data-verdict]")!;
    expect(verdict).toHaveAttribute("data-verdict", "bill");
    expect(verdict).toHaveTextContent("Paid");
    expect(verdict).not.toHaveTextContent("Allowed");
    expect(verdict.className).not.toMatch(/(^|\s)bg-(accent|refuse|ink)(-|\s|$)/);
    const rows = within(within(c).getByRole("list", { name: "Recent decisions" })).getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("data-decision"))).toEqual(["bill", ...RECORDED_ROWS.slice(0, 2).map((r) => (r.allowed ? "allowed" : "refused"))]);
    expect(rows[0]).toHaveTextContent(line);
    // Never written as a trade.
    expect(container.textContent).not.toMatch(/PAY_EXPENSE|USDC/);
  }, WAITS);

  it("says what a probe is right under the latest Decision when that is one", async () => {
    const vault = deploymentConfig(deployments)!.vault;
    const rationaleHash = keccak256(toBytes(PROBE_BLOB));
    const c0 = chain();
    c0.logs = [...RECORDED.map(asLog), decisionLog(9, HEAD - 10n, { amount: 1_000_000n, rationaleHash })];
    c0.owner = OWNER;
    c0.txs = {
      [hash32(9)]: { from: AGENT, to: vault, input: executeInput({ action: "BUY", token: NVDAC, amount: 1_000_000n, rationaleHash, blob: PROBE_BLOB }) },
    };
    const { container } = landing(deps(c0));
    await waitFor(() => expect(card(container)).toHaveAttribute("data-vault-card", "live"), READ);

    const when = latestWhen(container);
    expect(when.textContent).toMatch(/ · probe$/);
    const gloss = when.nextElementSibling!;
    expect(gloss).toHaveAttribute("data-probe-gloss");
    expect(gloss.textContent).toBe(PROBE_GLOSS);
    expect(card(container).querySelectorAll("[data-probe-gloss]")).toHaveLength(1);
  }, WAITS);

  it("says the vault has made no Decision yet when Base has none", async () => {
    const { container } = landing(deps({ ...chain(), logs: [] }));
    await waitFor(() => expect(card(container)).toHaveAttribute("data-vault-card", "live"), READ);

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
    expect(firstLink(container)).toHaveAttribute("href", basescanDecision(NEWEST.txHash));
    expect(card(container)).toHaveTextContent(`Could not read the vault on Base, so this shows the ${RECORDED.length} Decisions recorded in this build.`);
    expect(screen.getByRole("button", { name: "Read again" })).toBeInTheDocument();
    expect(container.querySelector("[data-vault-bar]")).toBeNull();
  }, WAITS);

  it("keeps the recorded Decisions when the read fails, and reads again on Read again", async () => {
    const c0 = { ...chain(), bytecode: "0x" as const };
    const { container } = landing(deps(c0));
    await waitFor(() => expect(card(container)).toHaveAttribute("data-vault-card", "recorded"), READ);
    expect(firstLink(container)).toHaveAttribute("href", basescanDecision(NEWEST.txHash));
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
      ["Before mainnet (fork test)", "false"],
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
