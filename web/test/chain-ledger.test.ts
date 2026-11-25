// @vitest-environment node
import { encodeAbiParameters, encodeEventTopics, getAddress, keccak256, type AbiEvent, type Address, type Hash, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { REASON_LABEL, REASON_MEANING, REASON_MEANING_DOCS, REASONS } from "@/content/reasons";
import { vaultAbi } from "@/lib/chain/abi";
import type { CachedLog } from "@/lib/chain/cache";
import { decodeVaultLogs } from "@/lib/chain/events";
import { GRACE_PERIOD_SEC, summarize, toMainnetDecisions } from "@/lib/chain/ledger";
import { reasonDisplay } from "@/lib/chain/reason";
import { symbolOf } from "@/lib/chain/tokens";
import { readRepo } from "./helpers/solidity";

const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const NVDAC: Address = "0xb20000000000000000000078ee7ce2fE4908108C";
const GOOGLC: Address = "0xb2000000000000000000002D0BA3164cc74f58B7";
const PAYEE: Address = getAddress("0x00000000000000000000000000000000000000ee");
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hash;
const id = (n: number) => `0x${(1000 + n).toString(16).padStart(64, "0")}` as Hex;
const ACTION = { BUY: 0, SELL: 1, SUPPLY: 2, PAY_EXPENSE: 6 } as const;
const reasonId = (code: string) => (code === "OK" ? 0 : REASONS.indexOf(code as (typeof REASONS)[number]) + 1);

const event = (name: string) => vaultAbi.find((x) => x.type === "event" && x.name === name) as AbiEvent;

function log(name: string, args: Record<string, unknown>, block: number, logIndex: number, hash: Hash): CachedLog {
  const ev = event(name);
  const topics = encodeEventTopics({ abi: [ev], eventName: name, args } as never) as Hex[];
  const data = encodeAbiParameters(
    ev.inputs.filter((i) => !i.indexed),
    ev.inputs.filter((i) => !i.indexed).map((i) => args[i.name!]),
  );
  return { blockNumber: String(block), logIndex, transactionHash: hash, topics, data };
}

const decision = (n: number, block: number, action: keyof typeof ACTION, token: Address, amount: bigint, reason: string) =>
  log(
    "Decision",
    { intentId: id(n), action: ACTION[action], token, amount, allowed: reason === "OK", reason: reasonId(reason), rationaleHash: id(n + 50) },
    block,
    0,
    tx(n),
  );

const MANDATE = {
  sessionMode: 0,
  maxPremiumBps: 100,
  maxSlippageBps: 100,
  maxStaleness: 3600,
  multiplierCooldown: 86_400,
  twapWindow: 1800,
  perTradeCapUsd: 50_000_000n,
  dailyCapUsd: 100_000_000n,
  calendar: "0x0000000000000000000000000000000000000c01",
  swapAdapter: "0x0000000000000000000000000000000000000c02",
  creditAdapter: "0x0000000000000000000000000000000000000c03",
  minHealthFactor: 1_500_000_000_000_000_000n,
  targetHealthFactor: 2_000_000_000_000_000_000n,
  deriskWindow: 28_800,
};
const CONFIG = { allowed: true, feed: "0x0000000000000000000000000000000000000f01", pool: "0x0000000000000000000000000000000000000f02", maxWeightBps: 4000 };

// Thu 26 Nov 2026 15:30 UTC = 10:30 ET; 04:30 UTC on 27 Nov is still 26 Nov in New York (23:30 ET).
const T_THU = Date.UTC(2026, 10, 26, 15, 30) / 1000;
const T_LATE = Date.UTC(2026, 10, 27, 4, 30) / 1000;
const T_SAT = Date.UTC(2026, 10, 28, 15, 0) / 1000;

const LOGS: CachedLog[] = [
  log("Funded", { amount: 20_000_000n }, 100, 0, tx(90)),
  decision(1, 200, "BUY", NVDAC, 20_000_000n, "OK"),
  decision(2, 300, "BUY", GOOGLC, 10_000_000n, "MARKET_CLOSED"),
  decision(3, 400, "PAY_EXPENSE", USDC, 1_500_000n, "OK"),
  decision(4, 500, "SUPPLY", NVDAC, 81_000_000_000_000_000n, "OK"),
  decision(5, 600, "BUY", NVDAC, 60_000_000n, "SIZE_LIMIT"),
  decision(6, 700, "BUY", GOOGLC, 5_000_000n, "MARKET_CLOSED"),
  log("RevenueReceived", { amount: 2_000_000n }, 710, 1, tx(91)),
  log("Withdrawn", { token: USDC, amount: 3_000_000n }, 720, 0, tx(92)),
  log("MandateChangeQueued", { changeHash: id(70), eta: BigInt(T_THU + 86_400), mandate: MANDATE }, 730, 0, tx(93)),
  log("ChangeCancelled", { changeHash: id(70) }, 740, 0, tx(94)),
  log("TokenConfigChangeQueued", { changeHash: id(71), eta: BigInt(T_SAT + 86_400), token: GOOGLC, config: CONFIG }, 750, 0, tx(95)),
  log("PayeeChangeQueued", { changeHash: id(72), eta: BigInt(T_THU), payee: PAYEE, allowed: true }, 760, 0, tx(96)),
  log("PayeeApplied", { payee: PAYEE, allowed: true }, 770, 0, tx(97)),
  { blockNumber: "780", logIndex: 0, transactionHash: tx(98), topics: [id(999)], data: "0x" },
];
const BLOCK_TIMES: Record<string, number> = { "200": T_THU, "300": T_SAT, "400": T_THU, "500": T_THU, "600": T_LATE, "700": T_SAT };

describe("decodeVaultLogs", () => {
  const events = decodeVaultLogs(LOGS);

  it("decodes the vault's events and skips a log it does not know", () => {
    expect(events.map((e) => e.name)).toEqual([
      "Funded",
      "Decision",
      "Decision",
      "Decision",
      "Decision",
      "Decision",
      "Decision",
      "RevenueReceived",
      "Withdrawn",
      "MandateChangeQueued",
      "ChangeCancelled",
      "TokenConfigChangeQueued",
      "PayeeChangeQueued",
      "PayeeApplied",
    ]);
  });

  it("names the action and the reason", () => {
    const d = events.find((e) => e.name === "Decision" && e.intentId === id(2));
    expect(d).toMatchObject({ action: "BUY", token: GOOGLC, amount: 10_000_000n, allowed: false, reason: "MARKET_CLOSED", rationaleHash: id(52), blockNumber: 300n, txHash: tx(2) });
  });
});

describe("toMainnetDecisions", () => {
  const rows = toMainnetDecisions(decodeVaultLogs(LOGS), {
    blockTimes: BLOCK_TIMES,
    gasUsed: { [tx(1)]: "758192" },
    decimals: { [NVDAC.toLowerCase()]: 18 },
    usdc: USDC,
  });

  it("lists decisions newest first, each with its transaction", () => {
    expect(rows.map((r) => r.intentId)).toEqual([id(6), id(5), id(4), id(3), id(2), id(1)]);
    expect(rows.every((r) => r.txHash.startsWith("0x"))).toBe(true);
  });

  it("labels the amount in the action's unit", () => {
    const by = (n: number) => rows.find((r) => r.intentId === id(n))!;
    expect(by(1).amountLabel).toBe("$20.00");
    expect(by(3).amountLabel).toBe("$1.50");
    expect(by(3).symbol).toBe("USDC");
    expect(by(4).amountLabel).toBe("0.081 NVDAc");
    expect(by(1).gasUsed).toBe(758_192n);
    expect(by(2).gasUsed).toBeNull();
  });

  it("gives the time in New York, or the block when the time is unknown", () => {
    const by = (n: number) => rows.find((r) => r.intentId === id(n))!;
    expect(by(1).timeLabel).toBe("Thu 26 Nov 10:30");
    expect(by(5).timeLabel).toBe("Thu 26 Nov 23:30");
    expect(by(5).etDay).toBe("2026-11-26");
    const undated = toMainnetDecisions(decodeVaultLogs(LOGS), { blockTimes: {}, gasUsed: {}, decimals: {}, usdc: USDC });
    expect(undated[0]!.timeLabel).toBe("block 700");
    expect(undated[0]!.etDay).toBeNull();
  });

  it("shows a raw amount when a stock's decimals are unknown", () => {
    const r = toMainnetDecisions(decodeVaultLogs(LOGS), { blockTimes: {}, gasUsed: {}, decimals: {}, usdc: USDC });
    expect(r.find((x) => x.intentId === id(4))!.amountLabel).toBe("81000000000000000 raw NVDAc");
  });
});

describe("summarize", () => {
  const s = summarize(decodeVaultLogs(LOGS), { blockTimes: BLOCK_TIMES, usdc: USDC, nowSec: T_SAT + 3600 });

  it("counts verdicts and sums the money that moved", () => {
    expect(s).toMatchObject({ allowed: 3, refused: 3, fundedUsd6: 20_000_000n, revenueUsd6: 2_000_000n, expensesUsd6: 1_500_000n, withdrawnUsdcUsd6: 3_000_000n });
  });

  it("buckets decisions by New York day, oldest first", () => {
    expect(s.perDay).toEqual([
      { day: "2026-11-26", label: "Thu 26 Nov", allowed: 3, refused: 1 },
      { day: "2026-11-28", label: "Sat 28 Nov", allowed: 0, refused: 2 },
    ]);
  });

  it("ranks refusals by count, then by the enum's order", () => {
    expect(s.byReason).toEqual([
      { code: "MARKET_CLOSED", count: 2 },
      { code: "SIZE_LIMIT", count: 1 },
    ]);
  });

  it("keeps only changes still waiting on the timelock or ready to apply", () => {
    expect(s.pending).toEqual([{ kind: "token", changeHash: id(71), eta: T_SAT + 86_400, subject: GOOGLC, status: "waiting" }]);
  });

  it("marks a change past its ETA as ready, and drops it after the grace period", () => {
    const ready = summarize(decodeVaultLogs(LOGS), { blockTimes: BLOCK_TIMES, usdc: USDC, nowSec: T_SAT + 86_400 + 1 });
    expect(ready.pending[0]!.status).toBe("ready");
    const gone = summarize(decodeVaultLogs(LOGS), { blockTimes: BLOCK_TIMES, usdc: USDC, nowSec: T_SAT + 86_400 + GRACE_PERIOD_SEC });
    expect(gone.pending).toEqual([]);
  });

  it("drops a mandate change once MandateApplied carries the same mandate", () => {
    const applied = log("MandateApplied", { mandateHash: keccak256(encodeAbiParameters([event("MandateChangeQueued").inputs[2]!], [MANDATE])) }, 800, 0, tx(99));
    const queued = log("MandateChangeQueued", { changeHash: id(73), eta: BigInt(T_SAT), mandate: MANDATE }, 790, 0, tx(100));
    expect(summarize(decodeVaultLogs([queued, applied]), { blockTimes: {}, usdc: USDC, nowSec: T_SAT }).pending).toEqual([]);
  });

  it("takes the grace period from MandateVault.GRACE_PERIOD", () => {
    expect(readRepo("contracts/src/MandateVault.sol")).toMatch(/GRACE_PERIOD = 7 days;/);
    expect(GRACE_PERIOD_SEC).toBe(7 * 86_400);
  });
});

describe("reasonDisplay", () => {
  it("labels each code with REASON_LABEL, keeps the code, and explains it with the docs' line, REASON_MEANING_DOCS", () => {
    expect(reasonDisplay("MARKET_CLOSED")).toEqual({ label: "Market closed", code: "MARKET_CLOSED", meaning: REASON_MEANING_DOCS.MARKET_CLOSED });
    for (const code of REASONS) expect(reasonDisplay(code).meaning).toBe(REASON_MEANING_DOCS[code]);
    // The vault's first refusal was sent on a Tuesday at 09:28 ET, before the open: "after hours" does not cover it.
    expect(reasonDisplay("MARKET_CLOSED").meaning).not.toContain("after hours");
    expect(reasonDisplay("MARKET_CLOSED").meaning).not.toBe(REASON_MEANING.MARKET_CLOSED);
    expect(reasonDisplay("OK")).toEqual({ label: REASON_LABEL.OK, code: "OK", meaning: `${REASON_LABEL.OK}.` });
  });
});

describe("symbolOf", () => {
  it("names the basket and USDC from BaseAddresses.sol, and shortens anything else", () => {
    expect(symbolOf(NVDAC)).toBe("NVDAc");
    expect(symbolOf(GOOGLC.toLowerCase() as Address)).toBe("GOOGLc");
    expect(symbolOf(USDC)).toBe("USDC");
    expect(symbolOf(PAYEE)).toBe(`${PAYEE.slice(0, 6)}…${PAYEE.slice(-4)}`);
  });
});
