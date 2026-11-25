import { decodeFunctionData, getAddress, keccak256, size, slice, toBytes, type Address, type Hex } from "viem";
import { mandateVaultAbi } from "../abi/index.js";
import { verifyJournal } from "../ledger/journal.js";
import type { OnchainIntent } from "../types.js";
import { BLOB_PREFIX, GENESIS } from "./blob.js";
import { decodeExecuteInput, EXECUTE_BYTES, senderLabel, type DecodedExecute, type SenderLabel } from "./calldata.js";

// Re-derives what a Decision commits to from its transaction input alone (docs/superpowers/specs/
// 2026-11-25-maat-v1-rationale-blob-design.md §1, §2.6, §3.6): the blob between the call and the Builder Code, its
// keccak256 against the intent's rationaleHash, and, given the journal, the hash chain and the row `j` names.

export type CheckName = "calldata" | "blob" | "hash" | "decision" | "journal" | "anchor";
export type CheckStatus = "pass" | "fail" | "pending";
export interface Check {
  name: CheckName;
  status: CheckStatus;
  detail: string;
}

export interface VerifyRequest {
  /** The transaction input, as `cast tx <hash> input` prints it. */
  input: Hex;
  /** The transaction's hash: finds the journal's sent or reconcile row for it. Without it, the row carrying the blob. */
  txHash?: Hex;
  /** The receipt's Decision rationaleHash for this intent; null when the receipt holds no Decision for it. */
  decisionHash?: Hex | null;
  /** The text a Decision with no blob commits to (the rationales export holds it). */
  rationale?: string;
  /** Journal files in order: the published day files, or the agent's local journal.jsonl. */
  journal?: readonly { name: string; text: string }[];
  /** tx.from and the vault's owner(), for the sender label (§4). */
  from?: Address;
  owner?: Address;
  /** tx.to and the vault it must be: §1 decodes only a tx to the vault, so the calldata check fails when they differ. */
  to?: Address;
  vault?: Address;
}

export interface DecisionReport {
  verdict: "PASS" | "FAIL" | "PENDING";
  checks: Check[];
  intentId: Hex | null;
  rationaleHash: Hex | null;
  label?: SenderLabel;
}

type Line = { at: string; row: Record<string, unknown> | null };

/** Splits journal files into lines as verifyJournal counts them, each with its `file:line` location. */
function linesOf(files: readonly { name: string; text: string }[]): { text: string; at: (n: number) => string; rows: Line[] } {
  const locs: string[] = [];
  const parts: string[] = [];
  for (const f of files) {
    const body = f.text.endsWith("\n") || f.text === "" ? f.text : `${f.text}\n`;
    const lines = body.split("\n");
    lines.pop(); // the empty string after the last LF
    lines.forEach((_, i) => locs.push(`${f.name}:${i + 1}`));
    parts.push(body);
  }
  const text = parts.join("");
  const rows: Line[] = text
    .split("\n")
    .slice(0, locs.length)
    .map((l, i) => {
      const line = l.replace(/\r$/, "");
      let row: Record<string, unknown> | null = null;
      if (line.trim() !== "") {
        try {
          const v: unknown = JSON.parse(line);
          if (v !== null && typeof v === "object" && !Array.isArray(v)) row = v as Record<string, unknown>;
        } catch {
          row = null;
        }
      }
      return { at: locs[i]!, row };
    });
  return { text, at: (n) => locs[n - 1] ?? `line ${n}`, rows };
}

/** §3.6 step 4: the journal row for this Decision, and whether `j` names a row before it. */
function anchorCheck(d: DecodedExecute, j: Hex, rows: Line[], txHash: Hex | undefined): Check {
  const byTx = txHash !== undefined;
  const idx = rows.findIndex(({ row }) =>
    row === null
      ? false
      : byTx
        ? (row.kind === "sent" || row.kind === "reconcile") && typeof row.txHash === "string" && row.txHash.toLowerCase() === txHash.toLowerCase()
        : (row.kind === "sent" || row.kind === "intent") && row.blob === d.blob,
  );
  if (idx < 0) {
    return {
      name: "anchor",
      status: "pending",
      detail: byTx ? `no sent or reconcile row has tx ${txHash} yet: the journal has not caught up` : "no intent or sent row carries this blob yet: the journal has not caught up",
    };
  }
  const found = rows[idx]!;
  const what = byTx ? `the ${String(found.row!.kind)} row for tx ${txHash}` : `the ${String(found.row!.kind)} row carrying this blob`;
  if (found.row!.kind === "sent" && found.row!.blob !== d.blob) return { name: "anchor", status: "fail", detail: `broken: the blob on ${found.at} is not the onchain blob` };
  const before = rows.slice(0, idx).filter((l) => typeof l.row?.hash === "string");
  if (j === GENESIS) {
    if (before.length === 0) return { name: "anchor", status: "pass", detail: `j is GENESIS and no chained row comes before ${found.at} (${what})` };
    return { name: "anchor", status: "fail", detail: `broken: j is GENESIS but ${before[0]!.at} is a chained row before ${found.at}` };
  }
  const named = before.find((l) => l.row!.hash === j);
  if (!named) return { name: "anchor", status: "fail", detail: `broken: j ${j} is not the hash of any row before ${found.at}` };
  return { name: "anchor", status: "pass", detail: `j ${j} is the hash of ${named.at}, before ${found.at} (${what})` };
}

function done(checks: Check[], o: { intentId: Hex | null; rationaleHash: Hex | null; label?: SenderLabel }): DecisionReport {
  const verdict = checks.some((c) => c.status === "fail") ? "FAIL" : checks.some((c) => c.status === "pending") ? "PENDING" : "PASS";
  return { verdict, checks, intentId: o.intentId, rationaleHash: o.rationaleHash, ...(o.label ? { label: o.label } : {}) };
}

/** Every check §1 to §3.6 allows from the input, and from the receipt and the journal when they are given. */
export function verifyDecision(v: VerifyRequest): DecisionReport {
  const checks: Check[] = [];
  const d = decodeExecuteInput(v.input);
  const target = v.to !== undefined && v.vault !== undefined ? { to: getAddress(v.to), vault: getAddress(v.vault) } : undefined;
  const elsewhere = target !== undefined && target.to !== target.vault;
  // A tx to another contract says nothing about who sent a vault Decision, so it gets no sender label.
  const label = v.from !== undefined && v.owner !== undefined && !elsewhere ? senderLabel({ from: v.from, owner: v.owner, decoded: d }) : undefined;
  if (elsewhere) checks.push({ name: "calldata", status: "fail", detail: `the tx calls ${target.to}, not the vault ${target.vault}` });
  if (d === null) {
    const n = size(v.input);
    checks.push({ name: "calldata", status: "fail", detail: `not a direct execute call: ${n} bytes${n >= 4 ? `, selector ${slice(v.input, 0, 4)}` : ""}` });
    return done(checks, { intentId: null, rationaleHash: null, ...(label ? { label } : {}) });
  }
  const intent = decodeFunctionData({ abi: mandateVaultAbi, data: slice(v.input, 0, EXECUTE_BYTES) }).args![0] as OnchainIntent;
  const codes = d.codes === null ? "no ERC-8021 suffix" : `suffix codes ${d.codes.join(",")}`;
  const to = target === undefined ? "" : ` to the vault ${target.vault}`;
  if (!elsewhere) checks.push({ name: "calldata", status: "pass", detail: `${EXECUTE_BYTES}-byte execute call${to}, ${d.blobBytes}-byte blob, ${codes}` });

  if (d.status === "none") {
    if (v.rationale === undefined) {
      checks.push({ name: "blob", status: "fail", detail: "none: no blob after the call; give its text with --rationale to check the hash" });
    } else {
      checks.push({ name: "blob", status: "pass", detail: "none: no blob after the call; the hash is checked against the given text" });
      const h = keccak256(toBytes(v.rationale));
      checks.push(
        h === d.rationaleHash
          ? { name: "hash", status: "pass", detail: `keccak256(text) = rationaleHash ${d.rationaleHash}` }
          : { name: "hash", status: "fail", detail: `keccak256(text) ${h} is not the rationaleHash ${d.rationaleHash}` },
      );
    }
  } else {
    if (d.status === "v1") {
      const f = d.fields!;
      const who = f.k !== undefined ? `k ${f.k}` : `m ${f.m}${f.q ? `, q ${f.q.join(",")}` : ""}`;
      checks.push({ name: "blob", status: "pass", detail: `maat:v1, ${d.blobBytes} bytes: block ${f.b}, run ${f.r}, ${who}, commit ${f.c}, j ${f.j}` });
    } else if (d.status === "invalid") {
      checks.push({ name: "blob", status: "fail", detail: `invalid: ${d.problem}` });
    } else {
      checks.push({ name: "blob", status: "fail", detail: `foreign: ${d.blobBytes} bytes after the call that do not start with ${BLOB_PREFIX}` });
    }
    checks.push(
      d.hashTick
        ? { name: "hash", status: "pass", detail: `keccak256(blob) = rationaleHash ${d.rationaleHash}` }
        : { name: "hash", status: "fail", detail: `keccak256(blob) ${d.blobHash} is not the rationaleHash ${d.rationaleHash}` },
    );
  }

  if (v.decisionHash !== undefined) {
    checks.push(
      v.decisionHash === null
        ? { name: "decision", status: "fail", detail: "no Decision log for this intent in the receipt" }
        : v.decisionHash.toLowerCase() === d.rationaleHash.toLowerCase()
          ? { name: "decision", status: "pass", detail: "the Decision log's rationaleHash is the intent's" }
          : { name: "decision", status: "fail", detail: `the Decision log's rationaleHash ${v.decisionHash} is not the intent's ${d.rationaleHash}` },
    );
  }

  if (v.journal !== undefined) {
    const j = linesOf(v.journal);
    const chain = verifyJournal(j.text);
    if (!chain.ok) {
      checks.push({ name: "journal", status: "fail", detail: `${j.at(chain.line)}: ${chain.problem}` });
    } else {
      const extra = [chain.legacy ? `${chain.legacy} legacy` : "", chain.skipped ? `${chain.skipped} cut short` : ""].filter(Boolean).join(", ");
      checks.push({ name: "journal", status: "pass", detail: `${chain.rows} chained rows${extra ? ` (and ${extra})` : ""}, head ${chain.head}` });
      if (d.status === "v1") checks.push(anchorCheck(d, d.fields!.j as Hex, j.rows, v.txHash));
    }
  }
  return done(checks, { intentId: intent.id, rationaleHash: d.rationaleHash, ...(label ? { label } : {}) });
}
