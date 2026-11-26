// @vitest-environment node
import type { Address, Hash } from "viem";
import { describe, expect, it } from "vitest";
import { memoryStorage } from "@/lib/chain/cache";
import { LOOK_KEY, nextLook, readLook, saveLook, sinceLastLook, type LastLook, type LookInput } from "@/lib/chain/since";

const VAULT: Address = "0x00000000000000000000000000000000000000f1";
const OTHER: Address = "0x00000000000000000000000000000000000000aa";
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hash;
/** A Decision as the model reads it: its key is "txHash:logIndex", as toMainnetDecisions writes it. */
const d = (n: number, block: number, logIndex = 0) => ({ key: `${tx(n)}:${logIndex}`, blockNumber: BigInt(block), txHash: tx(n) });
const AT = Date.UTC(2026, 10, 26, 15, 41); // Thu 26 Nov 2026 10:41 ET
const DONE = { done: true, scannedFrom: 100n };

/** The ledger as one read left it, newest Decision first. */
const view = (decisions: ReturnType<typeof d>[], scan: LookInput["scan"] = DONE, vault: Address = VAULT): LookInput => ({ vault, decisions, scan });
const look = (newest: { n: number; block: number; logIndex?: number } | null, vault: Address = VAULT): LastLook => ({
  v: 1,
  vault,
  at: AT,
  newest: newest ? { block: String(newest.block), logIndex: newest.logIndex ?? 0, txHash: tx(newest.n) } : null,
});

/** A Storage whose every call throws, as a browser that blocks site data has it. */
function blockedStorage(): Storage {
  const no = () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  return { length: 0, clear: no, getItem: no, key: no, removeItem: no, setItem: no };
}

describe("the last look (lib/chain/since.ts)", () => {
  it("is a first visit when this browser has no look: no line, no marks", () => {
    const storage = memoryStorage();
    expect(readLook(storage)).toBeNull();
    expect(readLook(null)).toBeNull();
    expect(sinceLastLook(null, view([d(3, 300), d(2, 200), d(1, 100)]))).toBeNull();
  });

  it("is a first visit for this vault when the look this browser keeps was of another vault", () => {
    expect(sinceLastLook(look({ n: 3, block: 300 }, OTHER), view([d(3, 300)]))).toBeNull();
  });

  it("finds nothing new when the newest Decision is the one the viewer saw: 0, never a missing count", () => {
    const since = sinceLastLook(look({ n: 3, block: 300 }), view([d(3, 300), d(2, 200), d(1, 100)]));
    expect(since).toEqual({ fresh: new Set(), count: 0, at: AT });
  });

  it("counts exactly the Decisions after the one the viewer saw, by block and then log index", () => {
    const decisions = [d(6, 410), d(5, 400, 7), d(4, 300, 2), d(3, 300, 1), d(2, 200), d(1, 100)];
    const since = sinceLastLook(look({ n: 3, block: 300, logIndex: 1 }), view(decisions))!;
    expect(since.count).toBe(3);
    expect([...since.fresh]).toEqual([d(6, 410).key, d(5, 400, 7).key, d(4, 300, 2).key]);
    expect(since.at).toBe(AT);
  });

  it("marks every Decision new when the viewer last saw a vault that had recorded none", () => {
    const since = sinceLastLook(look(null), view([d(2, 200), d(1, 100)]))!;
    expect(since.count).toBe(2);
    expect(since.fresh).toEqual(new Set([d(2, 200).key, d(1, 100).key]));
    expect(sinceLastLook(look(null), view([]))).toEqual({ fresh: new Set(), count: 0, at: AT });
  });

  describe("when a reorg takes away the Decision the viewer saw", () => {
    it("counts from its place, so only the Decisions after it are new", () => {
      // The look's Decision (tx 9, block 250) is gone; 300 is after its place and 200 before it.
      const since = sinceLastLook(look({ n: 9, block: 250 }), view([d(3, 300), d(2, 200), d(1, 100)]))!;
      expect(since.count).toBe(1);
      expect([...since.fresh]).toEqual([d(3, 300).key]);
    });

    it("never calls the same transaction new when the reorg mined it again in a later block", () => {
      const since = sinceLastLook(look({ n: 9, block: 250 }), view([d(4, 320), d(9, 260, 3), d(2, 200)]))!;
      expect(since.count).toBe(1);
      expect([...since.fresh]).toEqual([d(4, 320).key]);
    });

    it("finds nothing new, never a negative count, when the chain now ends before it", () => {
      expect(sinceLastLook(look({ n: 9, block: 900 }), view([d(3, 300), d(2, 200)]))).toEqual({ fresh: new Set(), count: 0, at: AT });
    });
  });

  describe("while the page is still reading blocks", () => {
    it("marks the new rows it has, but gives a count only once every block after the look is read", () => {
      const decisions = [d(4, 400), d(3, 300)];
      const reading = sinceLastLook(look({ n: 2, block: 250 }), view(decisions, { done: false, scannedFrom: 260n }))!;
      expect(reading.fresh).toEqual(new Set([d(4, 400).key, d(3, 300).key]));
      expect(reading.count).toBeNull();
      const covered = sinceLastLook(look({ n: 2, block: 250 }), view(decisions, { done: false, scannedFrom: 250n }))!;
      expect(covered.count).toBe(2);
      expect(sinceLastLook(look({ n: 2, block: 250 }), view(decisions, { done: false, scannedFrom: null }))!.count).toBeNull();
    });

    it("waits for the whole history when the viewer last saw no Decision", () => {
      expect(sinceLastLook(look(null), view([d(4, 400)], { done: false, scannedFrom: 100n }))!.count).toBeNull();
    });
  });

  describe("the look to remember after a read", () => {
    it("is the newest Decision and the time of the read", () => {
      expect(nextLook(view([d(4, 400, 5), d(3, 300)]), AT)).toEqual({
        v: 1,
        vault: VAULT,
        at: AT,
        newest: { block: "400", logIndex: 5, txHash: tx(4) },
      });
    });

    it("remembers that the vault had recorded no Decision yet", () => {
      expect(nextLook(view([]), AT)).toEqual({ v: 1, vault: VAULT, at: AT, newest: null });
    });

    it("waits until the newest Decision is known: every block from it to the head read", () => {
      expect(nextLook(view([d(4, 400)], { done: false, scannedFrom: 380n }), AT)?.newest?.block).toBe("400");
      expect(nextLook(view([d(4, 400)], { done: false, scannedFrom: 420n }), AT)).toBeNull();
      expect(nextLook(view([d(4, 400)], { done: false, scannedFrom: null }), AT)).toBeNull();
      expect(nextLook(view([], { done: false, scannedFrom: 100n }), AT)).toBeNull();
    });
  });

  describe("in this browser's storage", () => {
    it("round-trips under one key and holds nothing but the look", () => {
      const storage = memoryStorage();
      expect(saveLook(storage, look({ n: 3, block: 300, logIndex: 2 }))).toBe(true);
      expect(storage.length).toBe(1);
      expect(storage.key(0)).toBe(LOOK_KEY);
      expect(JSON.parse(storage.getItem(LOOK_KEY)!)).toEqual({
        v: 1,
        vault: VAULT,
        at: AT,
        newest: { block: "300", logIndex: 2, txHash: tx(3) },
      });
      expect(readLook(storage)).toEqual(look({ n: 3, block: 300, logIndex: 2 }));
    });

    it("reads a malformed or foreign entry as no look", () => {
      const storage = memoryStorage();
      for (const raw of ["not json", "null", '{"v":2}', JSON.stringify({ ...look(null), at: "yesterday" }), JSON.stringify({ ...look(null), vault: "0x12" })]) {
        storage.setItem(LOOK_KEY, raw);
        expect(readLook(storage)).toBeNull();
      }
    });

    it("never throws when the browser blocks storage: no look is read and none is kept", () => {
      const storage = blockedStorage();
      expect(readLook(storage)).toBeNull();
      expect(saveLook(storage, look({ n: 3, block: 300 }))).toBe(false);
      expect(saveLook(null, look({ n: 3, block: 300 }))).toBe(false);
    });
  });
});
