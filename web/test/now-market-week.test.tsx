import { render, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { keccak256, toBytes, type Address, type Hash } from "viem";
import { describe, expect, it, vi } from "vitest";
import { AgentNote } from "@/components/live/AgentNote";
import { MarketWeek, type WeekDecision, type WeekDecisionsView } from "@/components/live/MarketWeek";
import { NowBoard } from "@/components/live/NowBoard";
import NowDecisions from "@/components/live/NowDecisions";
import type { LedgerDeps } from "@/components/ledger/useLedger";
import { type Hex, MULTICALL3 } from "@/content/b20-nav";
import { regularSession } from "@/content/calendar";
import { FACTS } from "@/content/facts";
import { memoryStorage } from "@/lib/chain/cache";
import { verifyJournal, type JournalRead } from "@/lib/chain/ledger";
import { canon, type RationaleSource } from "@/lib/chain/rationale";
import { SNAPSHOT_REORG_WINDOW } from "@/lib/chain/snapshot";
import { type CallResult, decodeAggregate3, encodeAggregate3Result, word } from "@/lib/live/abi";
import { LIVE_RPCS, type LiveReader } from "@/lib/live/rpc";
import snapshotFixture from "./fixtures/decisions-snapshot.json";
import fixture from "./fixtures/live-aggregate3.json";
import { decisionLog, FAKE_VAULT, type FakeChain, fakeLedgerClient, hash32 } from "./helpers/fake-ledger";
import { executeCalldata, JOURNAL_HASHES, JOURNAL_LINES } from "./helpers/maat-v1";
import { SNAP_BLOCK, SNAP_DEPLOY_TX, snapshotChain } from "./helpers/snapshot-chain";

// /now's market week (culture plan Move 8a) and the agent's latest note (Move 8b). Every clock is injected: the week
// is drawn from the clock the test gives, never from the machine's.

const utc = (y: number, mo: number, d: number, h: number, mi: number, s = 0) => Date.UTC(y, mo - 1, d, h, mi, s) / 1000;
const SATURDAY = utc(2026, 11, 28, 15, 0); // Sat 28 Nov 10:00 ET: closed, Thanksgiving week
const MONDAY_SESSION = utc(2026, 11, 30, 16, 0); // Mon 30 Nov 11:00 ET: in session
const [REFUSED, ALLOWED] = [...FACTS.mainnetDecisions.value].sort((a, b) => a.blockTime - b.blockTime);

const decision = (over: Partial<WeekDecision> & Pick<WeekDecision, "key" | "timestamp">): WeekDecision => ({
  txHash: `0x${"ab".repeat(32)}`,
  timeLabel: "Tue 24 Nov 09:28",
  allowed: false,
  reason: "MARKET_CLOSED",
  intent: "BUY NVDAc · $5.00",
  sender: "owner, by hand",
  ordinal: null,
  ...over,
});

/** The two mainnet Decisions recorded in this build, newest first, as the reader gives them once it has read Base. */
const RECORDED: WeekDecision[] = [
  decision({ key: "2", txHash: ALLOWED!.transactionHash, timestamp: ALLOWED!.blockTime, timeLabel: "Tue 24 Nov 11:59", allowed: true, reason: "OK", ordinal: 2 }),
  decision({ key: "1", txHash: REFUSED!.transactionHash, timestamp: REFUSED!.blockTime, ordinal: 1 }),
];

const closedLine = { tone: "closed", text: "NYSE closed · the vault refuses trades until Mon 09:30 ET", live: true } as const;

const days = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>("[data-week-days] > li")];
const spans = (day: HTMLElement) =>
  [...day.querySelectorAll<HTMLElement>("[data-span]")].map((s) => [s.dataset.span, Number(s.dataset.from), Number(s.dataset.to)]);

describe("MarketWeek", () => {
  it("draws Thanksgiving week from the calendar: hatched closed windows, plain sessions, Thanksgiving and the early close", () => {
    const { container } = render(<MarketWeek nowSec={SATURDAY} line={closedLine} decisions={{ state: "read", decisions: [], snapshot: null }} />);
    const rows = days(container);
    expect(rows.map((r) => r.dataset.day)).toEqual(["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]);
    expect(rows[0]).toHaveTextContent("Mon 23 Nov");
    expect(rows[0]).toHaveTextContent("Open 09:30–16:00 ET");
    expect(spans(rows[0]!)).toEqual([
      ["overnight", 0, 570],
      ["open", 570, 960],
      ["overnight", 960, 1440],
    ]);
    expect(rows[3]).toHaveTextContent("Closed: Thanksgiving");
    expect(spans(rows[3]!)).toEqual([["holiday", 0, 1440]]);
    expect(rows[4]).toHaveTextContent("Open 09:30–13:00 ET, early close");
    expect(spans(rows[4]!)).toEqual([
      ["overnight", 0, 570],
      ["open", 570, 780],
      ["early-close", 780, 960],
      ["overnight", 960, 1440],
    ]);
    expect(rows[5]).toHaveTextContent("Closed: weekend");

    // Each span sits at its share of the 24 h bar; every closed one wears the refuse hatch, an open one is plain.
    const friday = [...rows[4]!.querySelectorAll<HTMLElement>("[data-span]")];
    expect(friday.map((s) => [s.style.left, s.style.width])).toEqual([
      ["0%", "39.5833%"],
      ["39.5833%", "14.5833%"],
      ["54.1667%", "12.5%"],
      ["66.6667%", "33.3333%"],
    ]);
    for (const s of container.querySelectorAll<HTMLElement>("[data-span]")) {
      expect(s.className.includes("var(--color-refuse-hatch)"), s.dataset.span).toBe(s.dataset.span !== "open");
    }
  });

  it("marks today and the now line, which the visitor's clock sets", () => {
    const { container } = render(<MarketWeek nowSec={SATURDAY} line={closedLine} decisions={{ state: "read", decisions: [], snapshot: null }} />);
    const today = container.querySelector<HTMLElement>('[aria-current="date"]')!;
    expect(today.dataset.day).toBe("2026-11-28");
    expect(container.querySelectorAll("[aria-current]")).toHaveLength(1);
    const marker = container.querySelectorAll<HTMLElement>("[data-now-marker]");
    expect(marker).toHaveLength(1);
    expect(today.contains(marker[0]!)).toBe(true);
    expect(marker[0]!.style.left).toBe("41.6667%"); // 10:00 of 24:00
    expect(today).toHaveTextContent("now 10:00 ET");
  });

  it("puts each Decision of the week on its day at its minute, in its verdict's color, and lists it in words", () => {
    const { container } = render(<MarketWeek nowSec={SATURDAY} line={closedLine} decisions={{ state: "read", decisions: RECORDED, snapshot: null }} />);
    const tuesday = days(container)[1]!;
    const ticks = [...tuesday.querySelectorAll<HTMLElement>("[data-tick]")];
    expect(ticks.map((t) => [t.dataset.verdict, Math.floor(Number(t.dataset.minute))])).toEqual([
      ["refused", 9 * 60 + 28],
      ["allowed", 11 * 60 + 59],
    ]);
    expect(ticks[0]).toHaveClass("bg-refuse");
    expect(ticks[1]).toHaveClass("bg-accent");
    expect(container.querySelectorAll("[data-tick]")).toHaveLength(2);
    // The ticks are drawn; the list says the same in words, and is what a keyboard and a screen reader reach.
    for (const t of ticks) expect(t).toHaveAttribute("aria-hidden", "true");

    expect(container.querySelector("[data-week-count]")).toHaveTextContent("2 Decisions this week");
    const items = [...container.querySelectorAll<HTMLElement>("[data-week-decisions] > li")];
    expect(items.map((li) => li.textContent)).toEqual([
      "Weighing № 1 · Tue 24 Nov 09:28 ET · Refused · Market closed (MARKET_CLOSED) · BUY NVDAc · $5.00 · owner, by hand · Basescan ↗",
      "Weighing № 2 · Tue 24 Nov 11:59 ET · Allowed · All checks passed (OK) · BUY NVDAc · $5.00 · owner, by hand · Basescan ↗",
    ]);
    const link = within(items[0]!).getByRole("link");
    expect(link).toHaveAttribute("href", `https://basescan.org/tx/${REFUSED!.transactionHash}`);
    expect(link).toHaveAccessibleName(`Weighing № 1, transaction ${REFUSED!.transactionHash.slice(0, 10)}… on Basescan`);
  });

  it("shows zero as 0 for a week with no Decision, and leaves out Decisions of another week", () => {
    const { container } = render(<MarketWeek nowSec={MONDAY_SESSION} line={null} decisions={{ state: "read", decisions: RECORDED, snapshot: null }} />);
    expect(container.querySelector("[data-week-count]")).toHaveTextContent("0 Decisions this week");
    expect(container.querySelectorAll("[data-tick]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-week-decisions] > li")).toHaveLength(0);
  });

  it("says 1 Decision, and drops the ordinal when the read is not whole enough to number it", () => {
    const one = [decision({ key: "x", timestamp: utc(2026, 11, 30, 15, 15), timeLabel: "Mon 30 Nov 10:15", allowed: true, reason: "OK", sender: "agent" })];
    const { container } = render(<MarketWeek nowSec={MONDAY_SESSION} line={null} decisions={{ state: "read", decisions: one, snapshot: null }} />);
    expect(container.querySelector("[data-week-count]")).toHaveTextContent("1 Decision this week");
    expect(container.querySelector("[data-week-decisions] > li")!.textContent).toBe(
      "Mon 30 Nov 10:15 ET · Allowed · All checks passed (OK) · BUY NVDAc · $5.00 · agent · Basescan ↗",
    );
  });

  it("says while it reads the vault, and why it could not, with a retry", () => {
    const { container, rerender } = render(<MarketWeek nowSec={SATURDAY} line={null} decisions={{ state: "reading" }} />);
    expect(container.querySelector("[data-week-decisions-state]")).toHaveTextContent("Reading the vault's Decisions from Base…");
    expect(container.querySelector("[data-week-count]")).toBeNull();
    const retry = vi.fn();
    rerender(<MarketWeek nowSec={SATURDAY} line={null} decisions={{ state: "error", message: "HTTP 503", retry }} />);
    expect(container.querySelector("[data-week-decisions-state]")).toHaveTextContent("The vault's Decisions could not be read from Base: HTTP 503.");
    screen.getByRole("button", { name: "Read again" }).click();
    expect(retry).toHaveBeenCalledOnce();
    expect(container.querySelectorAll("[data-tick]")).toHaveLength(0);
  });

  it("sets the closed line large and the open line plain, and shows neither before a reading", () => {
    const { container, rerender } = render(<MarketWeek nowSec={SATURDAY} line={closedLine} decisions={{ state: "reading" }} />);
    const line = container.querySelector<HTMLElement>("[data-session-line]")!;
    expect(line).toHaveAttribute("data-session-line", "closed");
    expect(line).toHaveTextContent(/^NYSE closed · the vault refuses trades until Mon 09:30 ET$/);
    expect(line.querySelector("[data-hatch-swatch]")).not.toBeNull();
    rerender(<MarketWeek nowSec={MONDAY_SESSION} line={{ tone: "open", text: "NYSE open until 16:00 ET", live: true }} decisions={{ state: "reading" }} />);
    expect(container.querySelector("[data-session-line]")).toHaveAttribute("data-session-line", "open");
    expect(container.querySelector("[data-hatch-swatch]")).toBeNull();
    rerender(<MarketWeek nowSec={MONDAY_SESSION} line={null} decisions={{ state: "reading" }} />);
    expect(container.querySelector("[data-session-line]")).toBeNull();
    // The box that holds the line keeps its height, so the week below it does not move when a reading lands.
    expect(container.querySelector("[data-session-line-box]")).not.toBeNull();
  });

  it("has no clock, no date, no now line and no tick in the static HTML: the week is drawn in the browser", () => {
    const html = renderToString(<MarketWeek nowSec={null} line={null} decisions={{ state: "reading" }} />);
    expect(html).toContain('data-market-week="waiting"');
    expect(html).not.toContain("data-now-marker");
    expect(html).not.toContain("data-tick");
    expect(html).not.toContain("data-session-line=");
    expect(html).not.toMatch(/\d{1,2} (Nov|Dec)/);
    // Seven unlit rows hold the week's place, each named by its weekday alone.
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect([...doc.querySelectorAll("[data-week-days] > li")].map((li) => li.textContent?.trim())).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });
});

/** The agent journal as readJournal returns it once GitHub has served one day file of `lines`. */
const journalOf = (lines: readonly string[]): JournalRead => ({
  state: "read",
  files: ["2026-11-24.jsonl"],
  ...verifyJournal([{ name: "2026-11-24.jsonl", text: lines.map((l) => `${l}\n`).join("") }]),
});

describe("AgentNote", () => {
  it("renders nothing at all while the agent-journal branch does not exist, while it reads, and when the read fails", async () => {
    for (const r of [{ state: "absent" }, { state: "error", message: "GitHub answered HTTP 500 for journal/index.json" }] as JournalRead[]) {
      const read = vi.fn(async () => r);
      const { container, unmount } = render(<AgentNote read={read} />);
      expect(container).toBeEmptyDOMElement();
      await waitFor(() => expect(read).toHaveBeenCalledOnce());
      await Promise.resolve();
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it("shows the newest run summary verbatim, with its ET time, its commit and the file and line it came from", async () => {
    const { container } = render(<AgentNote read={async () => journalOf(JOURNAL_LINES)} />);
    const tile = await waitFor(() => {
      const t = container.querySelector<HTMLElement>("[data-agent-note]");
      expect(t).not.toBeNull();
      return t!;
    });
    expect(tile.querySelector("[data-agent-note-head]")).toHaveTextContent(/^Latest note from Maat's agent · Tue 24 Nov 11:59 ET · journal 0123456 ↗$/);
    expect(tile.querySelector("blockquote")).toHaveTextContent(/^One buy proposed\.$/);
    expect(within(tile).getByRole("link", { name: "Agent commit 0123456 on GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/duongnq2798/maat/commit/0123456789abcdef0123456789abcdef01234567",
    );
    expect(tile).toHaveTextContent("journal/2026-11-24.jsonl, line 1");
    expect(tile).toHaveTextContent("A dry-run round: it sent nothing.");
  });

  it("writes a summary as text, never as markup", async () => {
    const run = {
      kind: "run",
      ts: "2026-11-26T15:00:00.000Z",
      runId: "1795705200000-c0ffee00",
      commit: "0123456789abcdef0123456789abcdef01234567",
      mode: "live",
      ok: true,
      summary: "Closed for <b>Thanksgiving</b> & quiet.",
      prev: JOURNAL_HASHES[1]!,
    };
    const hash = keccak256(toBytes(canon(run)));
    const { container } = render(<AgentNote read={async () => journalOf([...JOURNAL_LINES, canon({ ...run, hash })])} />);
    await waitFor(() => expect(container.querySelector("blockquote")).not.toBeNull());
    expect(container.querySelector("blockquote")).toHaveTextContent(/^Closed for <b>Thanksgiving<\/b> & quiet\.$/);
    expect(container.querySelector("blockquote b")).toBeNull();
    expect(container).not.toHaveTextContent("dry-run");
  });
});

// The board, end to end in jsdom: the live read sets the line, the ledger's loader the ticks.

const BLOCK = BigInt(fixture.expected.blockNumber);
const isMulticall = (tx: { to: Hex }) => tx.to.toLowerCase() === MULTICALL3.toLowerCase();

/** A reader that answers the recorded multicall at block time `ts`, and a MarketCalendar like the repo calendar. */
function readerAt(ts: number): LiveReader {
  const r: CallResult[] = decodeAggregate3(fixture.response as Hex);
  r[0] = { success: true, returnData: `0x${word(BLOCK)}` };
  r[1] = { success: true, returnData: `0x${word(BigInt(ts))}` };
  return {
    call: async (tx) => ({
      data: isMulticall(tx) ? encodeAggregate3Result(r) : `0x${word(regularSession(ts).open ? 1n : 0n)}`,
      endpoint: LIVE_RPCS[0]!,
    }),
  };
}

const OWNER: Address = "0x00000000000000000000000000000000000000a1";
const DEPLOY = 61_698_517n;
const noRationales: RationaleSource = { name: "none", lookup: async () => new Map() };

/** A fake chain holding one owner-sent refusal on Thanksgiving, Thu 26 Nov 10:00 ET. */
function ledgerChain(): FakeChain {
  const block = DEPLOY + 100n;
  const rationaleHash = keccak256(toBytes("x"));
  return {
    head: DEPLOY + 200n,
    logs: [decisionLog(1, block, { reason: "MARKET_CLOSED", rationaleHash })],
    times: { [String(block)]: utc(2026, 11, 26, 15, 0), [String(DEPLOY + 200n)]: utc(2026, 11, 28, 15, 0) },
    gas: { [hash32(1)]: 110_000n },
    txs: { [hash32(1)]: { from: OWNER, to: FAKE_VAULT, input: executeCalldata({ rationaleHash }) } },
    owner: OWNER,
    deployTx: { hash: hash32(42), block: DEPLOY },
  };
}

/** /ledger's loader on that chain. */
function ledgerDeps(): LedgerDeps {
  return {
    client: fakeLedgerClient(ledgerChain()),
    fetchDeployments: async () => ({ vault: FAKE_VAULT, deployTx: hash32(42) as Hash }),
    fetchSnapshot: async () => null,
    rationaleSource: noRationales,
    storage: memoryStorage(),
    endpoints: ["https://rpc.test"],
    refreshMs: 3_600_000,
  };
}

describe("NowBoard's market week", () => {
  it("shows the closed line from a weekend reading, and the vault's Decision as a tick on Thanksgiving", async () => {
    const { container } = render(
      <NowBoard reader={readerAt(SATURDAY)} clock={() => SATURDAY + 5} ledger={ledgerDeps()} journal={async () => ({ state: "absent" })} />,
    );
    await waitFor(() => expect(container.querySelector("[data-session-line]")).toHaveTextContent("NYSE closed · the vault refuses trades until Mon 09:30 ET"));
    // The ledger loader is a lazy chunk: its first import in a test worker takes a moment.
    await waitFor(() => expect(container.querySelector("[data-week-count]")).toHaveTextContent("1 Decision this week"), { timeout: 10_000 });
    const thursday = container.querySelector<HTMLElement>('[data-day="2026-11-26"]')!;
    expect(thursday.querySelectorAll('[data-tick][data-verdict="refused"]')).toHaveLength(1);
    expect(container.querySelector("[data-week-decisions] > li")).toHaveTextContent(
      "Weighing № 1 · Thu 26 Nov 10:00 ET · Refused · Market closed (MARKET_CLOSED) · BUY NVDAc · $20.00 · owner, by hand",
    );
    expect(container.querySelector("[data-agent-note]")).toBeNull();
  });

  it("shows the open line from a reading in session, and no closed line", async () => {
    const { container } = render(
      <NowBoard reader={readerAt(MONDAY_SESSION)} clock={() => MONDAY_SESSION + 5} ledger={ledgerDeps()} journal={async () => ({ state: "absent" })} />,
    );
    await waitFor(() => expect(container.querySelector("[data-session-line]")).toHaveAttribute("data-session-line", "open"));
    expect(container.querySelector("[data-session-line]")).toHaveTextContent("NYSE open until 16:00 ET");
    expect(container).not.toHaveTextContent("NYSE closed");
  });

  it("shows the agent's latest note under the week once the journal has one", async () => {
    const { container } = render(
      <NowBoard reader={readerAt(SATURDAY)} clock={() => SATURDAY + 5} ledger={ledgerDeps()} journal={async () => journalOf(JOURNAL_LINES)} />,
    );
    await waitFor(() => expect(container.querySelector("[data-agent-note] blockquote")).toHaveTextContent("One buy proposed."));
  });
});

// The read itself (NowDecisions): what it reports to the week as /ledger's loader reads, and keeps.

describe("NowDecisions", () => {
  /** Mounts the reader on `client` and records every view it reports. */
  function mount(client: ReturnType<typeof fakeLedgerClient>, over: Partial<LedgerDeps> = {}) {
    const views: WeekDecisionsView[] = [];
    render(<NowDecisions deps={{ ...ledgerDeps(), client, ...over }} onView={(v) => views.push(v)} />);
    return views;
  }

  it("keeps the last whole read when a refresh misses a chunk of new blocks", async () => {
    const chain = ledgerChain();
    const client = fakeLedgerClient(chain);
    const views = mount(client, { refreshMs: 200 });
    await waitFor(() => expect(views.at(-1)?.state).toBe("read"));
    const whole = views.at(-1);
    // Base moves on, and the next refresh cannot read the new blocks.
    chain.head += 200n;
    chain.times = { ...chain.times, [String(chain.head)]: utc(2026, 11, 28, 15, 10) };
    chain.failLogs = true;
    const asked = client.logCalls.length;
    await waitFor(() => expect(client.logCalls.length).toBeGreaterThan(asked), { timeout: 3_000 });
    await new Promise((r) => setTimeout(r, 300));
    expect(views.filter((v) => v.state === "error")).toEqual([]);
    expect(views.at(-1)).toBe(whole);
  });

  it("says when the first read takes the oldest logs from the committed snapshot, and the block it was taken at", async () => {
    const views = mount(fakeLedgerClient(snapshotChain()), { fetchDeployments: async () => ({ vault: FAKE_VAULT, deployTx: SNAP_DEPLOY_TX }), fetchSnapshot: async () => snapshotFixture as unknown });
    await waitFor(() => expect(views.at(-1)?.state).toBe("read"));
    const read = views.at(-1);
    if (read?.state !== "read") throw new Error("not read");
    expect(read.decisions).toHaveLength(4);
    expect(read.snapshot).toEqual({ url: "/data/decisions-snapshot.json", block: SNAP_BLOCK, logsTo: SNAP_BLOCK - SNAPSHOT_REORG_WINDOW - 1n });
  });

  it("says no snapshot when every block from the deploy was scanned", async () => {
    const views = mount(fakeLedgerClient(ledgerChain()));
    await waitFor(() => expect(views.at(-1)?.state).toBe("read"));
    const read = views.at(-1);
    expect(read?.state === "read" && read.snapshot).toBeNull();
  });
});

describe("MarketWeek's source line", () => {
  it("names the committed snapshot and its block when the read started from it, and the scan from the deploy when not", () => {
    const { container, rerender } = render(
      <MarketWeek nowSec={SATURDAY} line={null} decisions={{ state: "read", decisions: RECORDED, snapshot: { url: "/data/decisions-snapshot.json", block: 62_220_629n, logsTo: 62_220_478n } }} />,
    );
    const source = container.querySelector<HTMLElement>("[data-week-source]")!;
    expect(source).toHaveTextContent(
      "Logs up to block 62,220,478 are from the committed snapshot of block 62,220,629: Base gave the same hash for that block and the same logs in their transaction receipts. The blocks after it were scanned with eth_getLogs.",
    );
    expect(within(source).getByRole("link", { name: "committed snapshot" })).toHaveAttribute("href", "/data/decisions-snapshot.json");
    rerender(<MarketWeek nowSec={SATURDAY} line={null} decisions={{ state: "read", decisions: RECORDED, snapshot: null }} />);
    expect(container.querySelector("[data-week-source]")).toHaveTextContent("Every block from the deploy to the head was scanned with eth_getLogs.");
    expect(container.querySelector("[data-week-source]")).not.toHaveTextContent("snapshot");
  });
});
