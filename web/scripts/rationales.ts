// Writes content/generated/rationales.json from the agent's journal, so /ledger can show each decision's rationale
// and check it against the rationaleHash in the vault's Decision log.
//
// Usage (in web/): npm run rationales -- <path to agent journal.jsonl>
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { exportRationales } from "../lib/rationales-export";

const journal = process.argv[2];
if (!journal) {
  console.error("usage: npm run rationales -- <path to journal.jsonl>");
  process.exit(1);
}

const lines = readFileSync(journal, "utf8")
  .split("\n")
  .filter((l) => l.trim().length > 0)
  .map((l) => JSON.parse(l) as unknown);
const entries = exportRationales(lines);
const out = fileURLToPath(new URL("../content/generated/rationales.json", import.meta.url));
writeFileSync(out, `${JSON.stringify(entries, null, 2)}\n`);
console.log(`wrote ${entries.length} ${entries.length === 1 ? "rationale" : "rationales"} to content/generated/rationales.json`);
