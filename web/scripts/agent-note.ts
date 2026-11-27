// Writes content/generated/agent-note.json: the newest round summary of Maat's agent on the public agent-journal branch,
// as /now shows it (lib/live/journal-note.ts), after the whole hash chain of the branch verified. The landing's hero
// quotes it under the vault card, so it reads no journal of its own on page load: nothing reaches GitHub until a
// visitor clicks a link. The build never runs this script: a data PR commits the file it writes.
//
// Usage (in web/): npm run agent-note [-- --git <ref>]
// By default it reads raw.githubusercontent.com, as /now does. --git reads the same files from a local ref instead,
// for example origin/agent-journal after a git fetch.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readJournal } from "../lib/chain/ledger";
import { latestNote } from "../lib/live/journal-note";

const OUT = fileURLToPath(new URL("../content/generated/agent-note.json", import.meta.url));

/** A fetch that answers from `ref`'s journal/ folder, as raw.githubusercontent.com would. */
function gitFetch(ref: string): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const file = url.slice(url.lastIndexOf("/") + 1);
    try {
      const text = execFileSync("git", ["show", `${ref}:journal/${file}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      return new Response(text, { status: 200 });
    } catch {
      return new Response("", { status: 404 });
    }
  }) as typeof fetch;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { git: { type: "string" } } });
  const read = await readJournal(values.git === undefined ? undefined : gitFetch(values.git), values.git === undefined ? undefined : "git/");
  if (read.state !== "read") {
    console.error(`agent-note: the journal was not read: ${read.state === "error" ? read.message : "the branch has no index.json"}`);
    process.exit(1);
  }
  if (read.failure !== null) {
    console.error(`agent-note: journal/${read.failure.file} line ${read.failure.line}: ${read.failure.problem}`);
    process.exit(1);
  }
  const note = latestNote(read);
  if (note === null) {
    console.error("agent-note: no round on the branch has a summary");
    process.exit(1);
  }
  writeFileSync(OUT, `${JSON.stringify({ head: read.head, rows: read.rows.length, note }, null, 2)}\n`);
  console.log(`content/generated/agent-note.json: journal/${note.file} line ${note.line}, ${note.when}, ${read.rows.length} rows verified`);
}

await main();
