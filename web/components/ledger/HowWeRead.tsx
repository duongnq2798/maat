import { FACTS } from "@/content/facts";
import { rpcUrls } from "@/lib/chain/rpc";
import { repoFileUrl } from "@/lib/site";
import { hostOf } from "./format";

/** How the page gets its numbers, so a reader can check each one without trusting the site. */
export function HowWeRead() {
  return (
    <section id="how-we-read" aria-labelledby="how-we-read-title" className="border-t border-line">
      <div className="wrap grid gap-8 py-16 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:py-24">
        <div className="flex flex-col gap-3">
          <span className="eyebrow">No server in between</span>
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
            What it has read stays in this browser&apos;s storage, so a return visit only reads new blocks. The newest
            blocks are always read again, in case of a reorg.
          </li>
          <li>
            The vault stores a hash of each rationale, not the text. The text comes from the agent&apos;s journal export at{" "}
            <a href="/data/rationales.json">/data/rationales.json</a>; the page hashes it and shows &quot;Hash
            verified&quot; only when it matches the rationaleHash in the Decision event.
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
