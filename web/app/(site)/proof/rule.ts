// The /proof counting rule: section 5 of the MaatInbox design spec, word for word, as Markdown. test/proof-rule.test.tsx
// compares it with the spec, so a change to the rule is a change to the spec first. RuleText renders it.

/** The spec this text is section 5 of, from the repository root. */
export const RULE_SPEC = "docs/superpowers/specs/2026-11-25-maat-inbox-design.md";

// The first line is cut inside its code span for the /ask page: test/ask-page.test.tsx takes a quoted /ask path in code
// for a link that could open that page early, and this one is text.
export const PROOF_RULE = [
  "Merged at least 24 h before `/" + "ask` opens. `scripts/recount.mjs` rebuilds every number from public logs over a keyless RPC.",
  "",
  "**Lines kept apart.** No line is ever added to another. Each Decision gets one label, first match wins: owner by hand, probe, brief-driven, agent. The order and the blob fields `k` and `q` are those of §4 (Sender labels) of the maat:v1 rationale blob spec, `docs/superpowers/specs/2026-11-25-maat-v1-rationale-blob-design.md`.",
  "",
  "| Line | Counts |",
  "|---|---|",
  "| Owner by hand | Transactions the owner signed (`tx.from == owner()`, checked first): deploys, funding, mandate changes, the first decisions |",
  '| Agent | Every other executor Decision: not sent by the owner, not a probe (blob `k == "probe"`), not brief-driven (blob `q` present) |',
  '| Probe | The agent\'s labeled probe Decisions (blob `k == "probe"`) |',
  "| Outside briefs | `Brief` events from senders outside the team set: briefs, distinct wallets, and how many of those wallets hold a Verified Account |",
  "| Brief-driven Decisions | Executor Decisions, not probes, whose blob `q` cites brief ids: vault allowed, vault refused |",
  "| Team briefs | `Brief` events from the team set, never added to outside briefs |",
  "| Hidden briefs | Outside briefs the owner hid from the feed. They stay in the outside count and are also listed here, so hiding never changes a number |",
  "| Bounty claimants | §6 |",
  "",
  "**Team set (for owner approval).**",
  "- The owner, `0x3c3a66f713DAE7e4A03Bbd81dB79FF65F42C1D6a`: on 2026-11-25 it is the vault's `owner()`, `executor()` and only payee, and it sent the four deploy transactions in `deployments/README.md`.",
  "- The CDP executor, once `setExecutor` hands it the role.",
  "- The deployer of every Maat contract, `MaatInbox` included, and every address on the vault's `payees()`.",
  "- Any wallet a team wallet funded within 2 hops: hop 1 received ETH or a token from a team wallet, hop 2 from a hop-1 wallet. Hops stop at the vault, pools, routers and exchange addresses, which the recount lists with a source. Token funding comes from `Transfer` logs; ETH funding, which leaves no log, comes from a committed list of each team wallet's sent transactions, checked against its nonce.",
  "",
  "**Verified Account column.** For each counted outside wallet: whether it holds a Coinbase Verified Account attestation, with its EAS UID. The UID comes from a free `eth_call` to the Coinbase attestation indexer `0x2c7eE1E5f416dfF40054c27A62f7B357C4E8619C`, `getAttestationUid(wallet, 0xf8b05c79f090979bf4a80270aba232dff11a10d9ca55c4f88de95317970f0de9)`; the EAS schema registry `0x4200000000000000000000000000000000000020` lists that schema as `bool verifiedAccount` (both read on 2026-11-25). A UID counts only if EAS (`0x4200000000000000000000000000000000000021`) `getAttestation(uid)` shows it unrevoked, unexpired and issued to that wallet. The column informs the reader; it removes no one from the count.",
  "",
  "**Never a user:** owner, agent, probe or team transactions. Briefs are never paid, rewarded or reciprocated, and outreach never asks anyone to send a brief to help a count.",
].join("\n");

/** The Markdown the rule uses: paragraphs, one pipe table and one bullet list. */
export type RuleBlock =
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] };

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

/** The blocks of `md`, split at blank lines; a block's lines that start with "- " are a list after its paragraph. */
export function parseRule(md: string): RuleBlock[] {
  const out: RuleBlock[] = [];
  for (const chunk of md.split(/\n{2,}/)) {
    const lines = chunk.split("\n");
    if (lines[0]!.startsWith("|")) {
      if (!/^\|[-| ]+\|$/.test(lines[1] ?? "")) throw new Error(`the rule's table has no separator row: ${lines[0]}`);
      out.push({ kind: "table", head: cells(lines[0]!), rows: lines.slice(2).map(cells) });
      continue;
    }
    const first = lines.findIndex((l) => l.startsWith("- "));
    const text = (first < 0 ? lines : lines.slice(0, first)).join(" ");
    if (text !== "") out.push({ kind: "p", text });
    if (first >= 0) {
      const items = lines.slice(first);
      if (items.some((l) => !l.startsWith("- "))) throw new Error(`the rule's list has a line that is not an item: ${chunk}`);
      out.push({ kind: "list", items: items.map((l) => l.slice(2)) });
    }
  }
  return out;
}

/** An inline piece of a line: plain text, `code` or **bold**. */
export type Inline = { kind: "text" | "code" | "strong"; text: string };

export function inlines(text: string): Inline[] {
  return text
    .split(/(`[^`]+`|\*\*[^*]+\*\*)/)
    .filter((s) => s !== "")
    .map((s) =>
      s.startsWith("`") ? { kind: "code", text: s.slice(1, -1) } : s.startsWith("**") ? { kind: "strong", text: s.slice(2, -2) } : { kind: "text", text: s },
    );
}

/** A line as a reader sees it, without its marks. */
export const inlineText = (text: string) =>
  inlines(text)
    .map((i) => i.text)
    .join("");
