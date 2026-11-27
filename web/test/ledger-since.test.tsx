import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { DecisionTimeline } from "@/components/ledger/DecisionTimeline";
import { LedgerApp } from "@/components/ledger/LedgerApp";
import type { LedgerState } from "@/components/ledger/useLedger";
import { SCAN_FLOOR_BLOCK } from "@/lib/chain/config";
import { loadLedger, type LedgerSnapshot } from "@/lib/chain/load";
import { LOOK_KEY, type LastLook, type Since } from "@/lib/chain/since";
import { decisionLog, FAKE_VAULT, fakeLedgerClient, hash32, memoryStorage } from "./helpers/fake-ledger";

const hook = vi.hoisted(() => ({ state: { mode: "waiting" } as LedgerState, retry: vi.fn() }));
vi.mock("@/components/ledger/useLedger", () => ({ useLedger: () => ({ ...hook.state, retry: hook.retry }) }));

const DEPLOY = SCAN_FLOOR_BLOCK + 10_000n;
const HEAD = DEPLOY + 120_000n;
const T0 = 1_795_707_000; // Thu 26 Nov 2026 15:30 UTC
const LOOK_AT = Date.UTC(2026, 10, 26, 15, 41); // Thu 26 Nov 2026 10:41 ET
const NOW = Date.UTC(2026, 10, 27, 14, 5); // Fri 27 Nov 2026 09:05 ET
const key = (n: number) => `${hash32(n)}:0`;

let snapshot: LedgerSnapshot;
beforeAll(async () => {
  const client = fakeLedgerClient({
    head: HEAD,
    logs: [
      decisionLog(1, DEPLOY + 5n),
      decisionLog(2, DEPLOY + 60_000n, { reason: "MARKET_CLOSED", amount: 10_000_000n }),
      decisionLog(3, HEAD - 10n, { reason: "SIZE_LIMIT", amount: 90_000_000n }),
    ],
    times: { [String(DEPLOY + 5n)]: T0, [String(DEPLOY + 60_000n)]: T0 + 3600, [String(HEAD - 10n)]: T0 + 7200, [String(HEAD)]: T0 + 7300 },
    deployTx: { hash: hash32(42), block: DEPLOY },
  });
  snapshot = await loadLedger({
    client,
    vault: FAKE_VAULT,
    deployTx: hash32(42),
    storage: memoryStorage(),
    rationaleSource: { name: "test", lookup: async () => new Map() },
    now: () => (T0 + 7300) * 1000,
  });
});

const timeline = (since: Since | null | undefined) =>
  render(
    <DecisionTimeline
      decisions={snapshot.decisions}
      rationales={snapshot.rationales}
      rationaleState={snapshot.rationaleState}
      trails={snapshot.trails}
      txState={snapshot.txState}
      journal={{ state: "absent" }}
      reason={null}
      onReason={() => {}}
      scanning={false}
      since={since}
    />,
  );
const rows = () => within(screen.getByRole("list", { name: "Mainnet decisions" })).getAllByRole("listitem");
/** The row of Decision n: rows are newest first. */
const rowOf = (n: number) => rows()[3 - n]!;
const marks = (container: HTMLElement) => [...container.querySelectorAll("[data-since-new]")];
const line = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-since-line]")!;

describe("DecisionTimeline since the viewer's last look", () => {
  it("says above the list how many Decisions are new and when that look was, as polite live text", () => {
    const { container } = timeline({ fresh: new Set([key(3)]), count: 1, at: LOOK_AT });
    const l = line(container);
    expect(l).toHaveTextContent(/^1 new since your last look · Thu 26 Nov 10:41 ET$/);
    expect(l).toHaveAttribute("aria-live", "polite");
    expect(l).not.toHaveAttribute("role", "alert");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(l.querySelector("time")).toHaveAttribute("datetime", new Date(LOOK_AT).toISOString());
    // Text, not a control: nothing in it takes focus.
    expect(l.querySelector("a, button, [tabindex]")).toBeNull();
    const list = screen.getByRole("list", { name: "Mainnet decisions" });
    expect(l.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("marks only the new rows, with words a screen reader says, and prints each of them in", () => {
    const { container } = timeline({ fresh: new Set([key(3), key(2)]), count: 2, at: LOOK_AT });
    expect(line(container)).toHaveTextContent("2 new since your last look · Thu 26 Nov 10:41 ET");
    for (const n of [3, 2]) {
      expect(within(rowOf(n)).getByText("New").closest("[data-since-new]")).toHaveTextContent("New since your last look");
      expect(rowOf(n)).toHaveAttribute("data-fresh", "");
      expect(rowOf(n)).toHaveAttribute("data-tape-row", "");
    }
    expect(rowOf(1).querySelector("[data-since-new]")).toBeNull();
    expect(rowOf(1)).not.toHaveAttribute("data-fresh");
    expect(rows().map((r) => r.getAttribute("data-verdict"))).toEqual(["refused", "refused", "allowed"]);
    expect(marks(container)).toHaveLength(2);
  });

  it("prints a new row in once: once its print ends, a filter or a tab change never prints it again", () => {
    const { container } = timeline({ fresh: new Set([key(3)]), count: 1, at: LOOK_AT });
    fireEvent.animationEnd(rowOf(3));
    expect(rowOf(3)).not.toHaveAttribute("data-fresh");
    expect(rowOf(3).querySelector("[data-since-new]")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Allowed" }));
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(rowOf(3)).not.toHaveAttribute("data-fresh");
    expect(marks(container)).toHaveLength(1);
  });

  it("ignores the end of an animation inside a row", () => {
    timeline({ fresh: new Set([key(3)]), count: 1, at: LOOK_AT });
    fireEvent.animationEnd(rowOf(3).querySelector("a")!);
    expect(rowOf(3)).toHaveAttribute("data-fresh", "");
  });

  it("says Nothing new when no Decision came after the last look, and marks none", () => {
    const { container } = timeline({ fresh: new Set(), count: 0, at: LOOK_AT });
    expect(line(container)).toHaveTextContent(/^Nothing new since your last look · Thu 26 Nov 10:41 ET$/);
    expect(marks(container)).toEqual([]);
    expect(container.querySelector("[data-fresh]")).toBeNull();
  });

  it("shows no line and no mark on a first visit, as the page was before", () => {
    for (const since of [null, undefined]) {
      const { container, unmount } = timeline(since);
      expect(line(container)).toHaveTextContent(/^$/);
      expect(marks(container)).toEqual([]);
      expect(container.querySelector("[data-fresh]")).toBeNull();
      expect(rows()).toHaveLength(3);
      unmount();
    }
  });

  it("marks the new rows it has while blocks after the look are still being read, and counts once they are", () => {
    const { container, rerender } = timeline({ fresh: new Set([key(3)]), count: null, at: LOOK_AT });
    expect(line(container)).toHaveTextContent(/^$/);
    expect(marks(container)).toHaveLength(1);
    rerender(
      <DecisionTimeline
        decisions={snapshot.decisions}
        rationales={snapshot.rationales}
        rationaleState={snapshot.rationaleState}
        trails={snapshot.trails}
        txState={snapshot.txState}
        journal={{ state: "absent" }}
        reason={null}
        onReason={() => {}}
        scanning={false}
        since={{ fresh: new Set([key(3)]), count: 1, at: LOOK_AT }}
      />,
    );
    expect(line(container)).toHaveTextContent("1 new since your last look · Thu 26 Nov 10:41 ET");
  });
});

const mainnet = (loading = false): LedgerState => ({ mode: "mainnet", snapshot, endpoints: ["https://base-rpc.publicnode.com"], loading, refreshError: null });
const lookOf = (n: number, block: bigint, at = LOOK_AT): LastLook => ({ v: 1, vault: FAKE_VAULT, at, newest: { block: block.toString(), logIndex: 0, txHash: hash32(n) } });
const stored = (storage: Storage) => JSON.parse(storage.getItem(LOOK_KEY) ?? "null") as LastLook | null;

describe("/ledger remembers the viewer's last look in this browser only", () => {
  it("shows nothing on a first visit, then remembers the newest Decision and when it was shown", () => {
    const storage = memoryStorage();
    hook.state = mainnet();
    const { container } = render(<LedgerApp initial="loading" look={{ storage, now: () => NOW }} />);
    expect(line(container)).toHaveTextContent(/^$/);
    expect(marks(container)).toEqual([]);
    expect(stored(storage)).toEqual(lookOf(3, HEAD - 10n, NOW));
    expect(storage.length).toBe(1);
  });

  it("on the next visit marks what came after that look, and keeps that look's time on screen while it remembers this one", () => {
    const storage = memoryStorage();
    storage.setItem(LOOK_KEY, JSON.stringify(lookOf(2, DEPLOY + 60_000n)));
    hook.state = mainnet();
    const { container } = render(<LedgerApp initial="loading" look={{ storage, now: () => NOW }} />);
    expect(line(container)).toHaveTextContent("1 new since your last look · Thu 26 Nov 10:41 ET");
    expect(marks(container)).toHaveLength(1);
    expect(rowOf(3).querySelector("[data-since-new]")).not.toBeNull();
    expect(stored(storage)).toEqual(lookOf(3, HEAD - 10n, NOW));
  });

  it("says Nothing new when the viewer comes back to the same ledger", () => {
    const storage = memoryStorage();
    storage.setItem(LOOK_KEY, JSON.stringify(lookOf(3, HEAD - 10n)));
    hook.state = mainnet();
    const { container } = render(<LedgerApp initial="loading" look={{ storage, now: () => NOW }} />);
    expect(line(container)).toHaveTextContent("Nothing new since your last look · Thu 26 Nov 10:41 ET");
    expect(marks(container)).toEqual([]);
  });

  it("remembers nothing while the first read is still under way", () => {
    const storage = memoryStorage();
    hook.state = mainnet(true);
    render(<LedgerApp initial="loading" look={{ storage, now: () => NOW }} />);
    expect(storage.length).toBe(0);
  });

  it("shows the page as before when the browser blocks storage", () => {
    const no = () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    };
    const storage: Storage = { length: 0, clear: no, getItem: no, key: no, removeItem: no, setItem: no };
    hook.state = mainnet();
    const { container } = render(<LedgerApp initial="loading" look={{ storage, now: () => NOW }} />);
    expect(line(container)).toHaveTextContent(/^$/);
    expect(marks(container)).toEqual([]);
    expect(rows()).toHaveLength(3);
  });

  it("shows the page as before when there is no storage at all", () => {
    hook.state = mainnet();
    const { container } = render(<LedgerApp initial="loading" look={{ storage: null, now: () => NOW }} />);
    expect(line(container)).toHaveTextContent(/^$/);
    expect(marks(container)).toEqual([]);
  });
});
