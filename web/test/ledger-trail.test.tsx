import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { keccak256, toBytes, type Address, type Hash, type Hex } from "viem";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import LedgerPage from "@/app/(site)/ledger/page";
import { BlobView } from "@/components/ledger/AgentTrail";
import { DecisionTimeline } from "@/components/ledger/DecisionTimeline";
import { LedgerApp } from "@/components/ledger/LedgerApp";
import { RoundsPanel } from "@/components/ledger/RoundsPanel";
import type { LedgerState } from "@/components/ledger/useLedger";
import { AGENT_DECISION, VerifyByHand } from "@/components/ledger/VerifyByHand";
import { FACTS } from "@/content/facts";
import { SCAN_FLOOR_BLOCK } from "@/lib/chain/config";
import { briefMap, JOURNAL_RAW_URL, verifyJournal } from "@/lib/chain/ledger";
import { loadLedger, type LedgerSnapshot } from "@/lib/chain/load";
import { canon, decodeExecuteInput, GENESIS } from "@/lib/chain/rationale";
import { decisionLog, FAKE_VAULT, fakeLedgerClient, hash32, memoryStorage, type FakeChain } from "./helpers/fake-ledger";
import { AGENT_TEST_CODE, erc8021Suffix, executeCalldata, JOURNAL_HASHES, JOURNAL_LINES, SPEC_CODE, txInput, VECTORS } from "./helpers/maat-v1";

const hook = vi.hoisted(() => ({ state: { mode: "waiting" } as LedgerState, retry: vi.fn() }));
vi.mock("@/components/ledger/useLedger", () => ({ useLedger: () => ({ ...hook.state, retry: hook.retry }) }));

const DEPLOY = SCAN_FLOOR_BLOCK + 10_000n;
const HEAD = DEPLOY + 1_000n;
const T0 = 1_795_707_000; // Thu 26 Nov 2026 15:30 UTC
const OWNER: Address = "0x00000000000000000000000000000000000000A1";
const AGENT: Address = "0x00000000000000000000000000000000000000B2";
const OWNER_TEXT = "Owner-sent first decision: BUY 5 USD of NVDAc";
const OTHER: Address = "0x00000000000000000000000000000000000c0ffe";
/** The commit in the spec's vectors. */
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

/** Decisions oldest first: n is the tx hash32(n), its block DEPLOY + n, and what its transaction carries. */
const ROWS: { n: number; from: Address; input: Hex; rationaleHash: Hash; to?: Address }[] = [
  // The owner's first Decision: no blob, the spec's code. Its text comes from the rationale export.
  { n: 1, from: OWNER, input: `${executeCalldata({ rationaleHash: keccak256(toBytes(OWNER_TEXT)) })}${erc8021Suffix([SPEC_CODE]).slice(2)}` as Hex, rationaleHash: keccak256(toBytes(OWNER_TEXT)) },
  { n: 2, from: AGENT, input: txInput(VECTORS.V1.blob), rationaleHash: VECTORS.V1.hash },
  { n: 3, from: AGENT, input: txInput(VECTORS.V4.blob, { code: AGENT_TEST_CODE }), rationaleHash: VECTORS.V4.hash },
  { n: 4, from: AGENT, input: txInput(VECTORS.V5.blob, { code: null }), rationaleHash: VECTORS.V5.hash },
  // The event's rationaleHash is V1's, so V2's bytes fail the tick.
  { n: 5, from: AGENT, input: txInput(VECTORS.V2.blob, { rationaleHash: VECTORS.V1.hash }), rationaleHash: VECTORS.V1.hash },
  { n: 6, from: AGENT, input: txInput("maat:v1:{broken"), rationaleHash: keccak256(toBytes("maat:v1:{broken")) },
  // Through another contract: not a direct execute call, so nothing is decoded from its input.
  { n: 7, from: AGENT, to: OTHER, input: txInput(VECTORS.V1.blob), rationaleHash: VECTORS.V1.hash },
];

const chain = (over: Partial<FakeChain> = {}): FakeChain => ({
  head: HEAD,
  owner: OWNER,
  logs: ROWS.map((r) => decisionLog(r.n, DEPLOY + BigInt(r.n), { rationaleHash: r.rationaleHash })),
  times: Object.fromEntries([...ROWS.map((r) => [String(DEPLOY + BigInt(r.n)), T0 + r.n * 60]), [String(HEAD), T0 + 9000]]),
  deployTx: { hash: hash32(42), block: DEPLOY },
  txs: Object.fromEntries(ROWS.map((r) => [hash32(r.n), { from: r.from, to: r.to ?? FAKE_VAULT, input: r.input }])),
  ...over,
});

const load = (c: FakeChain = chain()) =>
  loadLedger({
    client: fakeLedgerClient(c),
    vault: FAKE_VAULT,
    deployTx: hash32(42),
    storage: memoryStorage(),
    rationaleSource: { name: "test", lookup: async (ids) => new Map(ids.filter((id) => id === hash32(1001)).map((id) => [id, OWNER_TEXT] as const)) },
    now: () => (T0 + 9000) * 1000,
  });

let snapshot: LedgerSnapshot;
beforeAll(async () => {
  snapshot = await load();
});

const trailOf = (n: number) => snapshot.trails.get(`${hash32(n)}:0`)!;
const timeline = (s: LedgerSnapshot = snapshot, journal: Parameters<typeof DecisionTimeline>[0]["journal"] = { state: "absent" }) =>
  render(
    <DecisionTimeline
      decisions={s.decisions}
      rationales={s.rationales}
      rationaleState={s.rationaleState}
      trails={s.trails}
      txState={s.txState}
      journal={journal}
      reason={null}
      onReason={() => {}}
      scanning={false}
    />,
  );
/** The row of Decision n: rows are newest first. */
const rowOf = (n: number) => {
  const items = within(screen.getByRole("list", { name: "Mainnet decisions" })).getAllByRole("listitem");
  expect(items).toHaveLength(ROWS.length);
  return items[ROWS.length - n]!;
};

describe("loadLedger reads each Decision's transaction", () => {
  it("reads every Decision transaction once, by lowercased hash", () => {
    expect(snapshot.txState).toBe("read");
    expect([...snapshot.txs.keys()].sort()).toEqual(ROWS.map((r) => hash32(r.n).toLowerCase()).sort());
  });

  it("labels each sender as the spec says, first match wins, and leaves a call through another contract unlabeled", () => {
    // tx.from is the executor only for a direct execute call (spec §4); through another contract it can be anyone.
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => trailOf(n).label)).toEqual(["owner, by hand", "agent", "probe", "brief-driven", "agent", "agent", null]);
  });

  it("ticks the blob hash in the browser: keccak256 of the blob against the Decision's rationaleHash", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => trailOf(n).blobHashOk)).toEqual([null, true, true, true, false, true, null]);
    expect(trailOf(6).call?.blob.status).toBe("invalid");
    expect(trailOf(7).call).toBeNull();
  });

  it("checks each Builder Code against the code on the vault's first Decision, which the owner sent", () => {
    expect(trailOf(1).builderCode).toEqual({ state: "reference", codes: [SPEC_CODE], reference: SPEC_CODE });
    expect(trailOf(2).builderCode).toEqual({ state: "match", codes: [SPEC_CODE], reference: SPEC_CODE });
    expect(trailOf(3).builderCode).toEqual({ state: "differs", codes: [AGENT_TEST_CODE], reference: SPEC_CODE });
    expect(trailOf(4).builderCode).toEqual({ state: "none" });
  });

  it("has no reference while the first Decision was not sent by the owner", async () => {
    const s = await load(chain({ owner: "0x00000000000000000000000000000000000000C3" }));
    expect(s.trails.get(`${hash32(2)}:0`)!.builderCode).toEqual({ state: "no-reference", codes: [SPEC_CODE], reference: null });
    expect(s.trails.get(`${hash32(1)}:0`)!.label).toBe("agent");
  });

  it("leaves the label unknown when the owner cannot be read, and the row out when its transaction cannot", async () => {
    const s = await load(chain({ failTreasury: true, txs: { [hash32(2)]: { from: AGENT, to: FAKE_VAULT, input: txInput(VECTORS.V1.blob) } } }));
    expect(s.trails.get(`${hash32(2)}:0`)!.label).toBeNull();
    expect(s.trails.has(`${hash32(3)}:0`)).toBe(false);
    expect(s.txState).toBe("read");
  });

  it("asks only for transactions it has not read when given the map of an earlier load", async () => {
    const client = fakeLedgerClient(chain());
    const spy = vi.spyOn(client, "getTransaction");
    const txs = new Map(snapshot.txs);
    await loadLedger({ client, vault: FAKE_VAULT, deployTx: hash32(42), storage: memoryStorage(), rationaleSource: { name: "none", lookup: async () => new Map() }, txs });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("the agent trail on each Decision row", () => {
  it("shows the owner's Decision with its label, no blob, the exported text and the reference code", () => {
    timeline();
    const row = rowOf(1);
    expect(within(row).getByText("owner, by hand")).toBeInTheDocument();
    expect(within(row).getByText("no blob")).toBeInTheDocument();
    expect(within(row).getByText("Hash verified")).toBeInTheDocument();
    expect(within(row).getByText(OWNER_TEXT)).toBeInTheDocument();
    expect(row).toHaveTextContent(`Builder Code ${SPEC_CODE}: the vault's first Decision`);
  });

  it("shows an agent blob: tick, Claude's words, model, run, commit link, journal head and sources", () => {
    timeline();
    const row = rowOf(2);
    expect(within(row).getByText("agent")).toBeInTheDocument();
    expect(within(row).getByText("maat:v1 blob")).toBeInTheDocument();
    expect(within(row).getByText("Hash verified").getAttribute("title")).toMatch(/Your browser hashed the blob/);
    expect(within(row).getByText("Fixture rationale: NVDAc is under its target weight and the feed is fresh, so buy 5 USD.")).toBeInTheDocument();
    const fields = row.querySelector<HTMLElement>("dl[data-blob-fields]")!;
    expect(fields).toHaveTextContent("Modelclaude-sonnet-5-5");
    expect(fields).toHaveTextContent("State block61,745,836");
    expect(fields).toHaveTextContent("Run1795539542000-a1b2c3d4");
    expect(within(row).getByRole("link", { name: "Agent commit 0123456 on GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/duongnq2798/maat/commit/0123456789abcdef0123456789abcdef01234567",
    );
    expect(fields).toHaveTextContent("Journal head0x892d2dce…84ff · no journal published yet");
    // Judge rehearsal 2026-11-27, m6: the dd wraps by word, so "journal" never splits on a phone; only the hash may
    // break anywhere, in its own span.
    const head = [...fields.querySelectorAll("dt")].find((dt) => dt.textContent === "Journal head")!.nextElementSibling!;
    expect(head.tagName).toBe("DD");
    expect(head.className.split(" ")).toContain("break-words");
    expect(head.className.split(" ")).not.toContain("break-all");
    const breakAll = [...head.querySelectorAll(".break-all")];
    expect(breakAll.map((el) => el.textContent)).toEqual(["0x892d2dce…84ff"]);
    const sources = [...within(row).getByRole("group", { name: "Sources" }).querySelectorAll("[data-source]")];
    expect(sources.map((s) => s.textContent)).toEqual([
      expect.stringMatching(/^NVDAcround 36893488147419105055updated Tue 24 Nov 11:\d\d ETpremium \+19 bps$/),
      expect.stringMatching(/^GOOGLcround 36893488147419104206updated .* ETpremium \+15 bps$/),
      expect.stringMatching(/^AAPLcround 36893488147419103860updated .* ETpremium \+23 bps$/),
    ]);
    expect(row).toHaveTextContent(`✓ Builder Code ${SPEC_CODE}, the code on the vault's first Decision`);
  });

  it("shows a -dirty or unknown commit as it is, with no commit link, since it does not pin the code (spec §2.1)", () => {
    const withCommit = (c: string) => {
      const b = decodeExecuteInput(txInput(`maat:v1:${canon({ ...JSON.parse(VECTORS.V1.blob.slice(8)), c })}`))!.blob;
      if (b.status !== "v1") throw new Error(b.status);
      return b;
    };
    const { unmount } = render(<BlobView blob={withCommit(`${COMMIT}-dirty`)} hashOk anchor="absent" />);
    expect(screen.getByText("0123456-dirty").getAttribute("title")).toBe(
      `${COMMIT}-dirty: tracked files under agent/ differed from this commit, so it does not pin the code that ran.`,
    );
    expect(screen.queryByRole("link", { name: /Agent commit/ })).toBeNull();
    unmount();
    render(<BlobView blob={withCommit("unknown")} hashOk anchor="absent" />);
    expect(screen.getByText("unknown").getAttribute("title")).toMatch(/git could not tell which commit the agent ran/);
    expect(screen.queryByRole("link", { name: /Agent commit/ })).toBeNull();
  });

  it("labels a probe and a brief-driven intent, and says when the Builder Code differs or is missing", () => {
    timeline();
    expect(within(rowOf(3)).getByText("probe")).toBeInTheDocument();
    expect(rowOf(3)).toHaveTextContent("Kindprobe: a fixed-time check, not a Claude proposal");
    expect(rowOf(3)).toHaveTextContent(`✗ Builder Code ${AGENT_TEST_CODE}, not ${SPEC_CODE}`);
    expect(within(rowOf(4)).getByText("brief-driven")).toBeInTheDocument();
    expect(rowOf(4)).toHaveTextContent("Briefs#7");
    expect(rowOf(4)).toHaveTextContent("No Builder Code: the calldata ends with no ERC-8021 suffix.");
  });

  it("shows no text for a blob whose hash is not the Decision's, and decodes nothing from an invalid blob", () => {
    timeline();
    expect(within(rowOf(5)).getByText("Hash mismatch")).toBeInTheDocument();
    expect(rowOf(5)).not.toHaveTextContent("Fixture - premium check");
    expect(within(rowOf(6)).getByText("invalid maat:v1 blob")).toBeInTheDocument();
    expect(within(rowOf(6)).getByText("Blob not decoded")).toBeInTheDocument();
    expect(rowOf(6)).toHaveTextContent("the text after maat:v1: is not JSON");
    expect(rowOf(6)).not.toHaveTextContent("{broken");
  });

  it("reads nothing from a call through another contract, and falls back to the exported text", () => {
    timeline();
    expect(within(rowOf(7)).getByText("not a direct execute call")).toBeInTheDocument();
    expect(within(rowOf(7)).getByText("sender not labeled").getAttribute("title")).toMatch(/not a direct execute call to the vault/);
    expect(within(rowOf(7)).getByText("Rationale not exported yet")).toBeInTheDocument();
    expect(rowOf(7)).not.toHaveTextContent("Builder Code");
  });

  it("says when the calldata is still being read, or could not be", () => {
    const { unmount } = timeline({ ...snapshot, trails: new Map(), txState: "checking" });
    expect(screen.getAllByText("Reading the calldata…")).toHaveLength(ROWS.length);
    unmount();
    timeline({ ...snapshot, trails: new Map(), txState: "read" });
    expect(screen.getAllByText("Calldata not read")).toHaveLength(ROWS.length);
    // The exported text still shows: the owner's row keeps its tick.
    expect(screen.getByText(OWNER_TEXT)).toBeInTheDocument();
  });

  it("shows where a blob stands in the journal once it is read", () => {
    const sent = (() => {
      const fields = { kind: "sent", ts: "2026-11-24T16:59:12.000Z", runId: "r", txHash: hash32(2), blob: VECTORS.V1.blob };
      const h = keccak256(toBytes(canon({ ...fields, prev: JOURNAL_HASHES[1] })));
      return canon({ ...fields, prev: JOURNAL_HASHES[1], hash: h });
    })();
    const chainOk = verifyJournal([{ name: "d.jsonl", text: [...JOURNAL_LINES, sent].map((l) => `${l}\n`).join("") }]);
    timeline(snapshot, { state: "read", files: ["d.jsonl"], ...chainOk });
    expect(rowOf(2)).toHaveTextContent("· found in the published journal");
    expect(rowOf(3)).toHaveTextContent("· not in the published journal yet");
  });

  it("says the journal's chain is broken, not that a blob is missing, when the chain breaks before its sent row", () => {
    const fields = { kind: "sent", ts: "2026-11-24T16:59:12.000Z", runId: "r", txHash: hash32(2), blob: VECTORS.V1.blob };
    const sent = canon({ ...fields, prev: JOURNAL_HASHES[1], hash: keccak256(toBytes(canon({ ...fields, prev: JOURNAL_HASHES[1] }))) });
    // The second line repeats the first, so the chain breaks at line 2 and the sent row after it is never verified.
    const broken = verifyJournal([{ name: "d.jsonl", text: [JOURNAL_LINES[0], JOURNAL_LINES[0], sent].map((l) => `${l}\n`).join("") }]);
    expect(broken.failure?.line).toBe(2);
    timeline(snapshot, { state: "read", files: ["d.jsonl"], ...broken });
    expect(rowOf(2)).toHaveTextContent("· not checked: the published journal's chain is broken");
    expect(rowOf(2)).not.toHaveTextContent("not in the published journal yet");
  });
});

describe("the Rounds tab", () => {
  it("says plainly when the agent-journal branch does not exist yet", () => {
    render(<RoundsPanel journal={{ state: "absent" }} onReload={() => {}} />);
    expect(screen.getByText("No journal has been published yet.")).toBeInTheDocument();
    expect(screen.getByText(/The agent-journal branch does not exist yet, or holds no journal\/index.json: GitHub answered 404/)).toBeInTheDocument();
    expect(screen.getByText(`${JOURNAL_RAW_URL}index.json`)).toBeInTheDocument();
  });

  it("reports the verified chain, its head, and the rows newest first", () => {
    const chainOk = verifyJournal([{ name: "2026-11-24.jsonl", text: JOURNAL_LINES.map((l) => `${l}\n`).join("") }]);
    render(<RoundsPanel journal={{ state: "read", files: ["2026-11-24.jsonl"], ...chainOk }} onReload={() => {}} />);
    expect(screen.getByText(/Chain verified in your browser: 2 rows in 1 day file/)).toHaveTextContent(JOURNAL_HASHES[1]!);
    const rows = within(screen.getByRole("list", { name: "Journal rows, newest first" })).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("intent BUY NVDAc $5.00 · preview OK · gate dry-run: would execute");
    expect(rows[1]).toHaveTextContent("run dry-run · ok · block 61745836 · proposals 1 · suggestions 1 · One buy proposed.");
    expect(within(rows[1]!).getByRole("link", { name: "Agent commit 0123456 on GitHub" })).toBeInTheDocument();
  });

  it("shows a row's -dirty commit as it is, with no commit link", () => {
    const fields = { kind: "run", ts: "2026-11-24T16:59:02.000Z", runId: "r", commit: `${COMMIT}-dirty`, mode: "live", ok: true };
    const line = canon({ ...fields, prev: GENESIS, hash: keccak256(toBytes(canon({ ...fields, prev: GENESIS }))) });
    const chainOk = verifyJournal([{ name: "2026-11-24.jsonl", text: `${line}\n` }]);
    expect(chainOk.failure).toBeNull();
    render(<RoundsPanel journal={{ state: "read", files: ["2026-11-24.jsonl"], ...chainOk }} onReload={() => {}} />);
    const [row] = within(screen.getByRole("list", { name: "Journal rows, newest first" })).getAllByRole("listitem");
    expect(within(row!).getByText("0123456-dirty")).toBeInTheDocument();
    expect(within(row!).queryByRole("link", { name: /Agent commit/ })).toBeNull();
  });

  it("says when the daily LLM cap stopped a round, from the run row's capped flag (spec §3.2)", () => {
    // A capped round has no summary: the publisher leaves the field out, never "(no text)".
    const fields = { kind: "run", ts: "2026-11-27T15:00:00.000Z", runId: "r", mode: "live", ok: false, capped: true, block: "61800000", proposals: 0, suggestions: 2 };
    const line = canon({ ...fields, prev: GENESIS, hash: keccak256(toBytes(canon({ ...fields, prev: GENESIS }))) });
    const chainOk = verifyJournal([{ name: "2026-11-27.jsonl", text: `${line}\n` }]);
    render(<RoundsPanel journal={{ state: "read", files: ["2026-11-27.jsonl"], ...chainOk }} onReload={() => {}} />);
    const [row] = within(screen.getByRole("list", { name: "Journal rows, newest first" })).getAllByRole("listitem");
    expect(row).toHaveTextContent("run live · not ok · daily LLM cap reached, Claude not called · block 61800000 · proposals 0 · suggestions 2");
  });

  it("opens a row's vault execute tx on Basescan's Logs tab, where its Decision shows, and any other tx on its plain page", () => {
    let prev: Hex = GENESIS;
    const ts = "2026-11-27T02:14:46.000Z";
    const lines = [
      { kind: "sent", ts, runId: "r", action: "BUY", symbol: "GOOGLc", amountUsd6: "4680721", txHash: hash32(2) },
      { kind: "intent", ts, runId: "r", action: "BUY", symbol: "GOOGLc", amountUsd6: "4680721", txHash: hash32(2), decision: { allowed: false, reason: "MARKET_CLOSED" } },
      { kind: "reconcile", ts, runId: "r", action: "BUY", txHash: hash32(3), outcome: "applied", decision: { allowed: true, reason: "OK" } },
      { kind: "housekeeping", ts, runId: "r", call: "syncMultiplier", txHash: hash32(4) },
      { kind: "brief", ts, runId: "r", briefId: 1, txHash: hash32(5), outcome: "adopted" },
    ].map((fields) => {
      const hash = keccak256(toBytes(canon({ ...fields, prev })));
      const line = canon({ ...fields, prev, hash });
      prev = hash;
      return line;
    });
    const chainOk = verifyJournal([{ name: "2026-11-27.jsonl", text: lines.map((l) => `${l}\n`).join("") }]);
    expect(chainOk.failure).toBeNull();
    render(<RoundsPanel journal={{ state: "read", files: ["2026-11-27.jsonl"], ...chainOk }} onReload={() => {}} />);
    const rows = within(screen.getByRole("list", { name: "Journal rows, newest first" })).getAllByRole("listitem");
    const href = (row: HTMLElement) => within(row).getByRole("link", { name: /on Basescan/ }).getAttribute("href");
    // Newest first: brief, housekeeping, reconcile, intent, sent.
    expect(rows.map(href)).toEqual([
      `https://basescan.org/tx/${hash32(5)}`,
      `https://basescan.org/tx/${hash32(4)}`,
      `https://basescan.org/tx/${hash32(3)}#eventlog`,
      `https://basescan.org/tx/${hash32(2)}#eventlog`,
      `https://basescan.org/tx/${hash32(2)}#eventlog`,
    ]);
  });

  it("names the first line that broke the chain", () => {
    const broken = verifyJournal([{ name: "2026-11-24.jsonl", text: `${JOURNAL_LINES[0]}\n${JOURNAL_LINES[0]}\n` }]);
    render(<RoundsPanel journal={{ state: "read", files: ["2026-11-24.jsonl"], ...broken }} onReload={() => {}} />);
    expect(screen.getByText(/Chain broken at journal\/2026-11-24.jsonl, line 2: prev is not the hash of the line before it/)).toHaveTextContent(
      "The 1 row before it verified.",
    );
  });

  it("offers to read again once the journal has been read, for rows pushed since", () => {
    const onReload = vi.fn();
    const chainOk = verifyJournal([{ name: "2026-11-24.jsonl", text: JOURNAL_LINES.map((l) => `${l}\n`).join("") }]);
    render(<RoundsPanel journal={{ state: "read", files: ["2026-11-24.jsonl"], ...chainOk }} onReload={onReload} />);
    fireEvent.click(screen.getByRole("button", { name: "Read again" }));
    expect(onReload).toHaveBeenCalledOnce();
  });

  it("offers to read again after an error", () => {
    const onReload = vi.fn();
    render(<RoundsPanel journal={{ state: "error", message: "GitHub answered HTTP 500 for journal/index.json" }} onReload={onReload} />);
    expect(screen.getByText("The journal could not be read: GitHub answered HTTP 500 for journal/index.json.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Read again" }));
    expect(onReload).toHaveBeenCalledOnce();
  });
});

describe("/ledger with the agent trail", () => {
  beforeEach(() => {
    hook.state = { mode: "mainnet", snapshot, endpoints: ["https://base-rpc.publicnode.com"], loading: false, refreshError: null };
  });

  it("opens on the Decisions tab and reads the journal for the blobs it shows", async () => {
    const fetchMock = vi.fn(async () => new Response("404: Not Found", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LedgerApp initial="loading" />);
    expect(screen.getByRole("tab", { name: "Decisions" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("list", { name: "Mainnet decisions" })).toBeVisible();
    await waitFor(() => expect(within(rowOf(2)).getByText(/no journal published yet/)).toBeInTheDocument());
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(`${JOURNAL_RAW_URL}index.json`);
  });

  it("reads the journal again when a refresh brings more Decisions with a blob, and not when it brings none", async () => {
    const fetchMock = vi.fn(async () => new Response("404: Not Found", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const indexReads = () => fetchMock.mock.calls.filter((c) => String((c as unknown[])[0]) === `${JOURNAL_RAW_URL}index.json`).length;
    const mainnet = (trails: LedgerSnapshot["trails"]): LedgerState => ({ mode: "mainnet", snapshot: { ...snapshot, trails }, endpoints: [], loading: false, refreshError: null });
    // The first load holds the blob of Decision 2 only.
    hook.state = mainnet(new Map([...snapshot.trails].filter(([key, t]) => t.call?.blob.status !== "v1" || key === `${hash32(2)}:0`)));
    const { rerender } = render(<LedgerApp initial="loading" />);
    await waitFor(() => expect(indexReads()).toBe(1));
    hook.state = mainnet(snapshot.trails);
    rerender(<LedgerApp initial="loading" />);
    await waitFor(() => expect(indexReads()).toBe(2));
    hook.state = mainnet(new Map(snapshot.trails));
    rerender(<LedgerApp initial="loading" />);
    await waitFor(() => expect(within(rowOf(4)).getByText(/no journal published yet/)).toBeInTheDocument());
    expect(indexReads()).toBe(2);
  });

  it("does not call GitHub when no Decision carries a blob and the Rounds tab stays closed", () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const noBlobs = new Map([...snapshot.trails].filter(([, t]) => t.call?.blob.status !== "v1"));
    hook.state = { mode: "mainnet", snapshot: { ...snapshot, trails: noBlobs }, endpoints: [], loading: false, refreshError: null };
    render(<LedgerApp initial="loading" />);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("switches to the Rounds tab, by click or arrow key, and says the branch does not exist yet", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("404: Not Found", { status: 404 })));
    const noBlobs = new Map([...snapshot.trails].filter(([, t]) => t.call?.blob.status !== "v1"));
    hook.state = { mode: "mainnet", snapshot: { ...snapshot, trails: noBlobs }, endpoints: [], loading: false, refreshError: null };
    render(<LedgerApp initial="loading" />);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Decisions" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Rounds" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Rounds" })).toHaveFocus();
    expect(await screen.findByText("No journal has been published yet.")).toBeVisible();
    expect(screen.getByRole("list", { name: "Mainnet decisions", hidden: true })).not.toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Decisions" }));
    expect(screen.getByRole("list", { name: "Mainnet decisions" })).toBeVisible();
  });
});

describe("the brief-to-Decision map", () => {
  // V5 with q = [3, 7]: Decision 8 adopts briefs 3 and 7 and is refused. Decision 9 carries V5 too, but the event's
  // rationaleHash is V1's, so its blob fails the tick and the brief it names does not count.
  const BRIEFS_3_7 = VECTORS.V5.blob.replace('"q":[7]', '"q":[3,7]');
  const EXTRA = [
    { n: 8, input: txInput(BRIEFS_3_7), rationaleHash: keccak256(toBytes(BRIEFS_3_7)), reason: "MARKET_CLOSED" },
    { n: 9, input: txInput(VECTORS.V5.blob, { rationaleHash: VECTORS.V1.hash }), rationaleHash: VECTORS.V1.hash, reason: "OK" },
  ];
  let withBriefs: LedgerSnapshot;
  beforeAll(async () => {
    const base = chain();
    withBriefs = await load(
      chain({
        logs: [...base.logs, ...EXTRA.map((e) => decisionLog(e.n, DEPLOY + BigInt(e.n), { rationaleHash: e.rationaleHash, reason: e.reason }))],
        times: { ...base.times, ...Object.fromEntries(EXTRA.map((e) => [String(DEPLOY + BigInt(e.n)), T0 + e.n * 60])) },
        txs: { ...base.txs, ...Object.fromEntries(EXTRA.map((e) => [hash32(e.n), { from: AGENT, to: FAKE_VAULT, input: e.input }])) },
      }),
    );
  });

  it("maps each brief id a verified blob names in q to the Decisions that adopted it, both newest first", () => {
    expect(withBriefs.trails.get(`${hash32(8)}:0`)!.label).toBe("brief-driven");
    expect(withBriefs.trails.get(`${hash32(9)}:0`)!.blobHashOk).toBe(false);
    const map = briefMap(withBriefs.decisions, withBriefs.trails);
    expect(map.map((b) => [b.id, b.decisions.map((d) => d.txHash)])).toEqual([
      [7, [hash32(8), hash32(4)]],
      [3, [hash32(8)]],
    ]);
  });

  it("is empty when no Decision's verified blob names a brief", () => {
    expect(briefMap(snapshot.decisions, new Map([...snapshot.trails].filter(([key]) => key !== `${hash32(4)}:0`)))).toEqual([]);
    expect(briefMap(snapshot.decisions, new Map())).toEqual([]);
  });

  it("lists each brief on the Rounds tab with the Decisions that adopted it: when, what, the verdict and Basescan", () => {
    render(<RoundsPanel journal={{ state: "absent" }} onReload={() => {}} briefs={briefMap(withBriefs.decisions, withBriefs.trails)} />);
    const briefs = within(screen.getByRole("list", { name: "Inbox briefs, newest first" })).getAllByRole("listitem");
    expect(briefs.map((b) => b.querySelector("[data-brief-id]")?.textContent)).toEqual(["Brief #7", "Brief #3"]);
    const adopted = [...briefs[0]!.querySelectorAll("[data-adopted]")];
    expect(adopted).toHaveLength(2);
    expect(adopted[0]).toHaveTextContent(/^Thu 26 Nov 10:38 ETBUY · NVDAc · \$20\.00Refused · Market closedMARKET_CLOSEDBasescan ↗$/);
    expect(adopted[1]).toHaveTextContent(/^Thu 26 Nov 10:34 ETBUY · NVDAc · \$20\.00Allowed · All checks passedOKBasescan ↗$/);
    expect(within(briefs[0]!).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      `https://basescan.org/tx/${hash32(8)}#eventlog`,
      `https://basescan.org/tx/${hash32(4)}#eventlog`,
    ]);
    expect(screen.getByText(/the brief ids each Decision's maat:v1 blob names in its q field/)).toBeInTheDocument();
  });

  it("says plainly when no Decision has adopted a brief yet", () => {
    render(<RoundsPanel journal={{ state: "absent" }} onReload={() => {}} briefs={[]} />);
    expect(screen.getByText("No Decision has adopted an inbox brief yet.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Inbox briefs, newest first" })).toBeNull();
  });

  it("is on the Rounds tab of /ledger, built from the Decisions the page read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("404: Not Found", { status: 404 })));
    hook.state = { mode: "mainnet", snapshot, endpoints: [], loading: false, refreshError: null };
    render(<LedgerApp initial="loading" />);
    fireEvent.click(screen.getByRole("tab", { name: "Rounds" }));
    const briefs = within(screen.getByRole("list", { name: "Inbox briefs, newest first" })).getAllByRole("listitem");
    expect(briefs).toHaveLength(1);
    expect(briefs[0]).toHaveTextContent("Brief #7");
    expect(briefs[0]).toHaveTextContent("BUY · NVDAc · $20.00");
    await waitFor(() => expect(screen.getByText("No journal has been published yet.")).toBeVisible());
  });
});

describe("Verify it by hand", () => {
  it("is on the page, with the six read-only steps against the recorded vault", () => {
    hook.state = { mode: "loading-config" };
    render(<LedgerPage />);
    const panel = screen.getByRole("region", { name: "Verify it by hand" });
    const steps = within(within(panel).getByRole("list", { name: "Six read-only steps" })).getAllByRole("listitem");
    expect(steps).toHaveLength(6);
    expect(steps.map((s) => s.querySelector("h3")?.textContent)).toEqual([
      "1. Check which contract the recorded deploy created",
      "2. Read the owner, the executor and the mandate",
      "3. Read the owner's two smoke-test Decisions",
      "4. Ask the calendar at each Decision's block",
      "5. Hash the rationale text",
      "6. The agent's first Decision",
    ]);
    expect(within(panel).getByRole("region", { name: "Set the RPC and the addresses" })).toHaveTextContent(
      "export VAULT=0x3F956072d18ddD20d5eFb74e9CCabf8Deade699b",
    );
    expect(within(panel).getByRole("region", { name: "Command 1" })).toHaveTextContent(
      'cast receipt 0xf5a532fe5d8b2ddf7fce312f524537e614f4988b425972dd1098f3d56631c9c1 contractAddress --rpc-url "$RPC"',
    );
    expect(within(panel).getByRole("region", { name: "Output of command 1" })).toHaveTextContent("0x3F956072d18ddD20d5eFb74e9CCabf8Deade699b");
    expect(within(panel).getByRole("region", { name: "Command 5" })).toHaveTextContent("printf '%s' 'Owner-sent first decision: BUY 5 USD of NVDAc' | cast keccak");
    expect(within(panel).getByRole("region", { name: "Output of command 5" })).toHaveTextContent("0x0baa4c52…57f6");
  });

  it("checks the agent's first Decision: who sent it, the refusal it logged and the hash of its blob", () => {
    render(<VerifyByHand targets={{ vault: FAKE_VAULT, deployTx: hash32(42), calendar: OTHER }} />);
    const agent = FACTS.mainnetDecisions.value.find((l) => l.sender === "agent")!;
    expect(AGENT_DECISION).toEqual({ tx: agent.transactionHash, block: agent.blockNumber });
    const command = screen.getByRole("region", { name: "Command 6" }).textContent ?? "";
    expect(command.split("\n")).toEqual([
      `TX=${agent.transactionHash}`,
      'cast tx "$TX" from --rpc-url "$RPC"',
      'cast call "$VAULT" "executor()(address)" --rpc-url "$RPC"',
      `cast logs --rpc-url "$RPC" --address "$VAULT" --from-block ${agent.blockNumber} --to-block ${agent.blockNumber} "$DECISION" | grep -A 9 transactionHash`,
      String.raw`cast tx "$TX" input --rpc-url "$RPC" | sed 's/^0x//' | xxd -r -p | grep -ao 'maat:v1:.*}' | tr -d '\n' | cast keccak`,
    ]);
    // The output: the executor twice, then the refusal, then the blob's keccak256, which is the log's rationaleHash.
    const output = (screen.getByRole("region", { name: "Output of command 6" }).textContent ?? "").split("\n");
    const rationaleHash = `0x${agent.data.slice(2 + 4 * 64)}`;
    const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-4)}`;
    expect(output[0]).toBe("0x9bC6E49d…115A");
    expect(output[1]).toBe(output[0]);
    expect(output).toContain(`  transactionHash: ${short(agent.transactionHash)}`);
    expect(output).toContain("  \tallowed: false");
    expect(output).toContain("  \treason: 6");
    expect(output).toContain(`  \trationaleHash: ${short(rationaleHash)}`);
    expect(output.at(-1)).toBe(short(rationaleHash));
  });

  it("uses only read-only cast commands: no send, no wallet, no broadcast", () => {
    const { container } = render(<VerifyByHand targets={{ vault: FAKE_VAULT, deployTx: hash32(42), calendar: OTHER }} />);
    const commands = [...container.querySelectorAll("[aria-label^='Command']")].map((c) => c.textContent ?? "");
    expect(commands).toHaveLength(6);
    for (const c of commands) {
      expect(c).not.toMatch(/cast (send|wallet|mktx|publish)|--broadcast|--private-key|--account/);
      expect(c).toMatch(/\bcast (receipt|call|logs|block|keccak)\b/);
    }
  });
});
