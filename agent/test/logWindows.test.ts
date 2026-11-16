import { describe, expect, it } from "vitest";
import { logWindows, MAX_LOG_RANGE } from "../src/chain/logWindows.js";

const all = (from: bigint, to: bigint, size?: bigint) => [...logWindows(from, to, size)];

describe("logWindows", () => {
  it("stays under the ~10,000-block eth_getLogs cap of free RPCs", () => {
    expect(MAX_LOG_RANGE).toBe(9_000n);
  });

  it("gives one window when the range fits, bounds inclusive", () => {
    expect(all(100n, 100n)).toEqual([{ fromBlock: 100n, toBlock: 100n }]);
    expect(all(100n, 9_099n)).toEqual([{ fromBlock: 100n, toBlock: 9_099n }]);
  });

  it("starts a new window after exactly 9,000 blocks", () => {
    expect(all(100n, 9_100n)).toEqual([
      { fromBlock: 100n, toBlock: 9_099n },
      { fromBlock: 9_100n, toBlock: 9_100n },
    ]);
  });

  it("covers a long range in order, with no gap and no overlap", () => {
    const w = all(53_556_127n, 53_600_000n);
    expect(w[0]?.fromBlock).toBe(53_556_127n);
    expect(w.at(-1)?.toBlock).toBe(53_600_000n);
    w.forEach((x, i) => {
      expect(x.toBlock - x.fromBlock + 1n).toBeLessThanOrEqual(MAX_LOG_RANGE);
      if (i > 0) expect(x.fromBlock).toBe(w[i - 1]!.toBlock + 1n);
    });
    expect(w).toHaveLength(5); // 43,874 blocks
  });

  it("takes a smaller size", () => {
    expect(all(0n, 4n, 2n)).toEqual([
      { fromBlock: 0n, toBlock: 1n },
      { fromBlock: 2n, toBlock: 3n },
      { fromBlock: 4n, toBlock: 4n },
    ]);
  });

  it("gives nothing for an empty range and refuses a size below one block", () => {
    expect(all(101n, 100n)).toEqual([]);
    expect(() => all(0n, 10n, 0n)).toThrow(/at least one block/);
  });
});
