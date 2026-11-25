import { FACTS } from "@/content/facts";
import { formatInt } from "@/content/format";
import { rpcUrls } from "@/lib/chain/rpc";
import { SNAPSHOT_REORG_WINDOW, SNAPSHOT_URL } from "@/lib/chain/snapshot";
import { repoFileUrl } from "@/lib/site";
import { hostOf } from "./format";

/** How the page gets its numbers, so a reader can check each one without trusting the site. */
export function HowWeRead() {
  return (
    <section id="how-we-read" aria-labelledby="how-we-read-title" className="border-t border-line">
      <div className="wrap grid gap-8 py-16 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:py-24">
        <div className="flex flex-col gap-3">
          <span className="eyebrow">Checked against Base</span>
          <h2 id="how-we-read-title" className="text-2xl font-semibold tracking-[-0.02em] text-ink">
            How this page reads Base
          </h2>
        </div>
        <ol className="m-0 flex list-decimal [&_a]:underline [&_a]:underline-offset-2 flex-col gap-4 pl-5 text-[15px] leading-relaxed text-ink-body">
          <li>
            Your browser asks a public Base RPC ({rpcUrls().map(hostOf).join(", falling back to ")}) for the vault&apos;s
            logs since its deploy block and decodes them with the vault&apos;s own{" "}
            <a href="/data/abi/MandateVault.json">ABI</a>. The address comes from the{" "}
            <a href={repoFileUrl("deployments/README.md")}>deployments table</a>, served at{" "}
            <a href="/data/deployments.json">/data/deployments.json</a>.
          </li>
          <li>
            Balances, prices, the mandate and the health factor come from a few multicalls, all at the latest block. A
            read that fails is shown as unavailable, never as zero.
          </li>
          <li>
            A first visit starts from a snapshot the repository commits (<a href={SNAPSHOT_URL}>{SNAPSHOT_URL}</a>,
            written from Base by npm run snapshot). Once Base gives the same hash for the snapshot&apos;s block, the page
            takes from the file the logs more than {formatInt(Number(SNAPSHOT_REORG_WINDOW))} blocks below it and reads
            every block after those from Base. It shows one of those logs only once its transaction&apos;s receipt on Base
            holds the same log, and it reads each Decision&apos;s time, gas and transaction from Base, so the file can leave
            a log out but cannot add or change one. When the site serves another file, or none, this browser forgets what
            it took from the old one.
          </li>
          <li>
            What it has read stays in this browser&apos;s storage, so a return visit only reads new blocks. The newest
            blocks are always read again, in case of a reorg.
          </li>
          <li>
            The vault stores a hash of each rationale, not the text. When a Decision&apos;s calldata carries a maat:v1
            blob, the text is in the transaction itself: the page reads the transaction&apos;s input, cuts it as the{" "}
            <a href={repoFileUrl("docs/superpowers/specs/2026-11-25-maat-v1-rationale-blob-design.md")}>blob spec</a> lays
            out, hashes the blob and shows &quot;Hash verified&quot; only when it matches the rationaleHash in the Decision
            event. A Decision with no blob gets its text from <a href="/data/rationales.json">/data/rationales.json</a>,
            which the operator exports, and the page hashes that text the same way.
          </li>
          <li>
            The sender label compares the transaction&apos;s sender with the vault&apos;s owner. The Builder Code is read
            from the ERC-8021 suffix at the end of the calldata and compared with the code on the vault&apos;s first
            Decision, which the owner sent by hand.
          </li>
          <li>
            The Rounds tab reads the agent&apos;s journal from the repository&apos;s public agent-journal branch through
            raw.githubusercontent.com and recomputes the hash of every line and every link to the line before it. GitHub is asked only when the tab opens or a
            Decision carries a blob, whose journal head the page then looks for.
          </li>
          <li>
            Rule changes are read from their queue, cancel and apply events. Each waits {FACTS.timelockHours.value} hours
            in public before it can apply.
          </li>
        </ol>
      </div>
    </section>
  );
}
