"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { LedgerClient } from "@/lib/chain/load";
import { createLedgerClient } from "@/lib/chain/rpc";
import { BriefForm, type BriefFormDeps } from "./BriefForm";
import { BriefsPanel } from "./BriefsPanel";
import { fetchAskConfig, type AskConfig } from "./config";
import { PreviewForm } from "./PreviewForm";

/** The notice the inbox spec (§4) gives /ask, word for word. */
export const ASK_NOTICE =
  "Nobody trades through Maat; the vault trades only its own funds. Tokenized stocks are only available in eligible jurisdictions outside of the U.S.";

export interface AskDeps extends BriefFormDeps {
  client?: LedgerClient;
  fetchConfig?: () => Promise<AskConfig>;
}

function Section({ id, title, lead, children }: { id: string; title: string; lead: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-5">
      <div className="flex max-w-[720px] flex-col gap-2">
        <h2 id={id} className="m-0 text-[24px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          {title}
        </h2>
        <p className="m-0 text-[15px] leading-relaxed text-ink-body">{lead}</p>
      </div>
      {children}
    </section>
  );
}

/** What the page shows instead of the form until deployments/README.md records the inbox. */
function NotOpen() {
  return (
    <div data-ask-state="not-open" className="card flex flex-col gap-2 p-5 sm:p-6">
      <p className="m-0 text-[17px] font-semibold text-ink">The inbox is not open yet.</p>
      <p className="m-0 text-[15px] leading-relaxed text-ink-body">
        Briefs open once the MaatInbox contract is deployed on Base and its address is recorded in deployments/README.md. Until
        then you can still ask the real vault below: it is free, and nothing is signed.
      </p>
    </div>
  );
}

/**
 * /ask: send a brief to the agent through MaatInbox, ask the live vault for free, and read the briefs. `initial` is the
 * build's deployments table, so the static HTML shows the state the page settles on; the page then reads
 * /data/deployments.json, and keeps `initial` when that read fails.
 */
export function AskApp({ initial, deps = {} }: { initial: AskConfig; deps?: AskDeps }) {
  const [config, setConfig] = useState(initial);
  const [client] = useState<LedgerClient>(() => deps.client ?? createLedgerClient());
  const [reloadKey, setReloadKey] = useState(0);
  const [fetchConfig] = useState(() => deps.fetchConfig ?? (() => fetchAskConfig()));

  useEffect(() => {
    let live = true;
    fetchConfig()
      .then((c) => live && setConfig(c))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [fetchConfig]);

  const open = config.inbox !== null && config.vault !== null;
  return (
    <div className="wrap flex flex-col gap-14 py-12 md:py-20">
      <header className="flex max-w-[820px] flex-col gap-4">
        <span className="eyebrow">Base mainnet</span>
        <h1 className="h2">Brief the agent</h1>
        <p className="lead">
          Try to talk Maat&apos;s agent into a trade. A brief is a short public message to the agent, sent from your wallet as
          one zero-value transaction on Base: you pay only its gas. Claude may be persuaded; the vault checks every intent
          against its mandate and has the last word.
        </p>
        <p data-ask-notice="" role="note" className="m-0 border-l-2 border-ink pl-4 text-[15px] font-medium leading-relaxed text-ink">
          {ASK_NOTICE}
        </p>
      </header>

      <Section
        id="send-title"
        title="Send a brief"
        lead="1 to 280 bytes of text. A brief is public and stays onchain for good, so put nothing private in it. The agent reads it as untrusted data."
      >
        {open && config.inbox && config.vault ? (
          <BriefForm inbox={config.inbox} vault={config.vault} deployTx={config.deployTx} client={client} onIncluded={() => setReloadKey((n) => n + 1)} deps={deps} />
        ) : (
          <NotOpen />
        )}
      </Section>

      <Section
        id="preview-title"
        title="Ask the real vault"
        lead="Pick an intent and the live vault answers with previewIntent, which runs the same checks as execute, at the latest block."
      >
        <PreviewForm vault={config.vault} client={client} />
      </Section>

      {open && config.inbox ? (
        <Section id="feed-title" title="Briefs" lead="Every brief sent to the inbox, newest first, read from its logs on Base. Shown as plain text, with no links.">
          <BriefsPanel inbox={config.inbox} client={client} reloadKey={reloadKey} />
        </Section>
      ) : null}
    </div>
  );
}
