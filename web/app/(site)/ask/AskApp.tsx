"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ASK_INVITATION } from "@/content/ask-card";
import type { JournalRead } from "@/lib/chain/ledger";
import type { LedgerClient } from "@/lib/chain/load";
import { createLedgerClient } from "@/lib/chain/rpc";
import { BriefForm, type BriefFormDeps } from "./BriefForm";
import { BriefsPanel } from "./BriefsPanel";
import { askIsOpen, fetchAskConfig, sameAskConfig, type AskConfig } from "./config";
import { PreviewForm } from "./PreviewForm";
import type { TeamReader } from "./team-set";

/** The notice the inbox spec (§4) gives /ask, word for word. */
export const ASK_NOTICE =
  "Nobody trades through Maat; the vault trades only its own funds. Tokenized stocks are only available in eligible jurisdictions outside of the U.S.";

export interface AskDeps extends BriefFormDeps {
  client?: LedgerClient;
  fetchConfig?: () => Promise<AskConfig>;
  /** Reads the published agent journal, for the agent's answers in the feed; readJournal when unset. */
  journal?: () => Promise<JournalRead>;
  /** Reads /proof's team set, for the "team" mark and the team's own line; /proof's own trace when unset. */
  team?: TeamReader;
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

/**
 * Why /ask is closed once the inbox is recorded: the running agent reads no briefs. A plan, not a promise: the owner
 * opens the page with content/ask-open.ts, in its own pull request, after the agent restarts on a release that reads
 * them and the /proof counting rule has been live for 24 hours (inbox spec §5).
 */
export const ASK_CLOSED_REASON =
  "Closed on purpose: the release of Maat's agent that runs now, agent-r2, reads no briefs. /ask is planned to open after the agent restarts on a release that does, after Sat 28 Nov 02:00 UTC, once the /proof counting rule has been live for 24 hours.";

/**
 * What the page shows above "Send a brief" until it is open, before the inbox is recorded and after, until the owner's
 * switch: that it is closed, and why.
 */
function NotOpen({ recorded }: { recorded: boolean }) {
  return (
    <div data-ask-state="not-open" className="card flex max-w-[820px] flex-col gap-2 p-5 sm:p-6">
      <p className="m-0 text-[17px] font-semibold text-ink">The inbox is not open yet.</p>
      <p className="m-0 text-[15px] leading-relaxed text-ink-body">
        {recorded
          ? "MaatInbox is recorded in deployments/README.md, but this page does not send briefs yet."
          : "Briefs open once the MaatInbox contract is deployed on Base and its address is recorded in deployments/README.md."}{" "}
        Until then you can still ask the real vault below: it is free, and nothing is signed.
      </p>
      {recorded ? (
        <p data-ask-closed-reason="" className="m-0 text-[15px] leading-relaxed text-ink-body">
          {ASK_CLOSED_REASON}
        </p>
      ) : null}
    </div>
  );
}

/**
 * /ask: send a brief to the agent through MaatInbox, ask the live vault for free, and read the briefs. `initial` is the
 * build's deployments table and the owner's switch, so the static HTML shows the state the page settles on; the page
 * then reads /data/deployments.json and /data/ask.json, and keeps `initial` when that read fails or gives the same
 * config, so the feed reads Base again only when the runtime files give another.
 */
export function AskApp({ initial, deps = {} }: { initial: AskConfig; deps?: AskDeps }) {
  const [config, setConfig] = useState(initial);
  const [client] = useState<LedgerClient>(() => deps.client ?? createLedgerClient());
  const [reloadKey, setReloadKey] = useState(0);
  const [fetchConfig] = useState(() => deps.fetchConfig ?? (() => fetchAskConfig()));

  useEffect(() => {
    let live = true;
    fetchConfig()
      .then((c) => live && setConfig((prev) => (sameAskConfig(prev, c) ? prev : c)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [fetchConfig]);

  const open = askIsOpen(config);
  return (
    <div className="wrap flex flex-col gap-14 py-12 md:py-20">
      <header className="flex max-w-[820px] flex-col gap-4">
        <span className="eyebrow">Base mainnet</span>
        <h1 className="h2">Brief the agent</h1>
        <p className="lead">
          {ASK_INVITATION} A brief is a short public message to Maat&apos;s agent, sent from your wallet as one zero-value
          transaction on Base: you pay only its gas. Claude may be persuaded; the vault checks every intent against its
          mandate.
        </p>
        <p data-ask-notice="" role="note" className="m-0 border-l-2 border-ink pl-4 text-[15px] font-medium leading-relaxed text-ink">
          {ASK_NOTICE}
        </p>
      </header>

      {open ? null : <NotOpen recorded={config.inbox !== null} />}

      <Section
        id="send-title"
        title="Send a brief"
        lead="1 to 280 bytes of text. A brief is public and stays onchain for good, so put nothing private in it. The agent reads it as untrusted data."
      >
        {open ? (
          <BriefForm inbox={config.inbox} vault={config.vault} deployTx={config.deployTx} client={client} onIncluded={() => setReloadKey((n) => n + 1)} deps={deps} />
        ) : (
          <p className="m-0 text-[15px] text-ink-2">The form appears here once the inbox opens.</p>
        )}
      </Section>

      <Section
        id="preview-title"
        title="Ask the real vault"
        lead="Pick an intent and the live vault answers with previewIntent, which runs the same checks as execute, at the latest block."
      >
        <PreviewForm vault={config.vault} client={client} />
      </Section>

      {open ? (
        <Section
          id="feed-title"
          title="Briefs"
          lead="Every brief sent to the inbox, newest first, as a weighing: the brief, what Maat's agent replied, whether Claude was persuaded, and the vault's verdict, read from its Decision on Base. Shown as plain text, with no links."
        >
          <BriefsPanel
            inbox={config.inbox}
            vault={config.vault}
            deployments={config.deployments}
            client={client}
            reloadKey={reloadKey}
            {...(deps.journal ? { journal: deps.journal } : {})}
            {...(deps.team ? { team: deps.team } : {})}
          />
        </Section>
      ) : null}
    </div>
  );
}
