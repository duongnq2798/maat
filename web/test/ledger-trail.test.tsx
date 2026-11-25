import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { keccak256, toBytes, type Address, type Hash, type Hex } from "viem";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import LedgerPage from "@/app/(site)/ledger/page";
import { DecisionTimeline } from "@/components/ledger/DecisionTimeline";
import { LedgerApp } from "@/components/ledger/LedgerApp";
import { RoundsPanel } from "@/components/ledger/RoundsPanel";
import type { LedgerState } from "@/components/ledger/useLedger";
import { VerifyByHand } from "@/components/ledger/VerifyByHand";
import { SCAN_FLOOR_BLOCK } from "@/lib/chain/config";
import { JOURNAL_RAW_URL, verifyJournal } from "@/lib/chain/ledger";
import { loadLedger, type LedgerSnapshot } from "@/lib/chain/load";
import { canon } from "@/lib/chain/rationale";
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
    const sources = [...within(row).getByRole("group", { name: "Sources" }).querySelectorAll("[data-source]")];
    expect(sources.map((s) => s.textContent)).toEqual([
      expect.stringMatching(/^NVDAcround 36893488147419105055updated Tue 24 Nov 11:\d\d ETpremium \+19 bps$/),
      expect.stringMatching(/^GOOGLcround 36893488147419104206updated .* ETpremium \+15 bps$/),
      expect.stringMatching(/^AAPLcround 36893488147419103860updated .* ETpremium \+23 bps$/),
    ]);
    expect(row).toHaveTextContent(`✓ Builder Code ${SPEC_CODE}, the code on the vault's first Decision`);
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

  it("names the first line that broke the chain", () => {
    const broken = verifyJournal([{ name: "2026-11-24.jsonl", text: `${JOURNAL_LINES[0]}\n${JOURNAL_LINES[0]}\n` }]);
    render(<RoundsPanel journal={{ state: "read", files: ["2026-11-24.jsonl"], ...broken }} onReload={() => {}} />);
    expect(screen.getByText(/Chain broken at journal\/2026-11-24.jsonl, line 2: prev is not the hash of the line before it/)).toHaveTextContent(
      "The 1 row before it verified.",
    );
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

describe("Verify it by hand", () => {
  it("is on the page, with the five read-only commands against the recorded vault", () => {
    hook.state = { mode: "loading-config" };
    render(<LedgerPage />);
    const panel = screen.getByRole("region", { name: "Verify it by hand" });
    const steps = within(within(panel).getByRole("list", { name: "Five read-only commands" })).getAllByRole("listitem");
    expect(steps).toHaveLength(5);
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

  it("uses only read-only cast commands: no send, no wallet, no broadcast", () => {
    const { container } = render(<VerifyByHand targets={{ vault: FAKE_VAULT, deployTx: hash32(42), calendar: OTHER }} />);
    const commands = [...container.querySelectorAll("[aria-label^='Command']")].map((c) => c.textContent ?? "");
    expect(commands).toHaveLength(5);
    for (const c of commands) {
      expect(c).not.toMatch(/cast (send|wallet|mktx|publish)|--broadcast|--private-key|--account/);
      expect(c).toMatch(/\bcast (receipt|call|logs|block|keccak)\b/);
    }
  });
});
