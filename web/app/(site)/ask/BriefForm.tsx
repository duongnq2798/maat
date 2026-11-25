"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Address, Hash } from "viem";
import { formatInt } from "@/content/format";
import { basescanTx } from "@/lib/chain/basescan";
import { briefIdsIn, checkBrief, MAX_BRIEF_BYTES, waitForReceipt, type InboxDeployment } from "@/lib/chain/inbox";
import type { LedgerClient } from "@/lib/chain/load";
import { baseAccountProvider } from "@/lib/wallet/base-account";
import { readBuilderCode, type BuilderCodeRead } from "@/lib/wallet/builder-code";
import { watchWallets, type Eip1193Provider, type InjectedWallet } from "@/lib/wallet/eip6963";
import { suffixIn } from "@/lib/wallet/suffix";
import { bundleTxHash, ensureBase, requestAccount, sendBriefBaseAccount, sendBriefInjected, walletErrorText } from "@/lib/wallet/send";

type SuffixCheck = ReturnType<typeof suffixIn> | "unread";

type Status =
  | { step: "idle" }
  | { step: "working"; text: string }
  | { step: "sent"; hash: Hash; text: string }
  | { step: "done"; hash: Hash; text: string; suffix?: SuffixCheck }
  | { step: "error"; text: string; hash?: Hash };

/** What the page found in the included transaction's calldata, in one sentence. */
const SUFFIX_CHECK: Record<SuffixCheck, string> = {
  end: "Its calldata ends with the Builder Code suffix.",
  inside: "Its calldata carries the Builder Code suffix inside the wallet's call.",
  none: "Its calldata does not carry the Builder Code suffix.",
  unread: "Its calldata could not be read to check the Builder Code suffix.",
};

type Via = { kind: "injected"; wallet: InjectedWallet } | { kind: "base-account" };

export interface BriefFormDeps {
  /** The wallets to offer; by default the EIP-6963 announcements on window. */
  watch?: (onChange: (wallets: InjectedWallet[]) => void) => () => void;
  baseAccount?: () => Promise<Eip1193Provider>;
}

function TxLink({ hash }: { hash: Hash }) {
  return (
    <a href={basescanTx(hash)} target="_blank" rel="noopener noreferrer" className="font-mono text-[13px]">
      View the transaction on Basescan
    </a>
  );
}

/** One line on the Builder Code: read from the vault's first Decision, or why not, in which case the brief goes without. */
function CodeLine({ code }: { code: BuilderCodeRead | null }) {
  if (code === null) return <p className="m-0 text-[13px] text-ink-2">Reading the Builder Code from the vault&apos;s first Decision…</p>;
  if (code.state === "unavailable") {
    return (
      <p data-builder-code="none" className="m-0 text-[13px] text-ink-2">
        The Builder Code could not be read: {code.why}. Briefs are sent without it.
      </p>
    );
  }
  return (
    <p data-builder-code={code.code} className="m-0 text-[13px] text-ink-2">
      Builder Code <span className="font-mono text-ink">{code.code}</span>, read from the vault&apos;s first Decision. A browser wallet puts it at
      the end of the brief&apos;s calldata (ERC-8021). Base Account is asked to add it through the dataSuffix capability, and may leave it
      out. Once the brief is included, the page checks the calldata.
    </p>
  );
}

export function BriefForm({
  inbox,
  vault,
  deployTx,
  client,
  onIncluded,
  deps = {},
}: {
  inbox: InboxDeployment;
  vault: Address;
  deployTx: Hash | null;
  client: LedgerClient;
  onIncluded: () => void;
  deps?: BriefFormDeps;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [wallets, setWallets] = useState<InjectedWallet[]>([]);
  const [code, setCode] = useState<BuilderCodeRead | null>(null);
  const [status, setStatus] = useState<Status>({ step: "idle" });
  const codeRead = useRef<Promise<BuilderCodeRead> | null>(null);
  const depsRef = useRef(deps);
  const runs = useRef(0);
  const check = checkBrief(text);
  const busy = status.step === "working" || status.step === "sent";

  useEffect(() => {
    const watch = depsRef.current.watch ?? ((onChange) => watchWallets(window, onChange));
    return watch(setWallets);
  }, []);

  useEffect(() => {
    let live = true;
    const read = readBuilderCode(client, { vault, deployTx }).catch((): BuilderCodeRead => ({ state: "unavailable", why: "the read failed" }));
    codeRead.current = read;
    void read.then((r) => live && setCode(r));
    return () => {
      live = false;
    };
  }, [client, vault, deployTx]);

  const send = async (via: Via) => {
    // The box is read-only from here until the brief is included or fails, so `sent` stays the text the page shows.
    const sent = text;
    const run = ++runs.current;
    if (!check.ok) {
      setStatus({ step: "error", text: check.problem });
      return;
    }
    const name = via.kind === "injected" ? via.wallet.info.name : "Base Account";
    try {
      setStatus({ step: "working", text: `Connecting to ${name}…` });
      const provider = via.kind === "injected" ? via.wallet.provider : await (depsRef.current.baseAccount ?? baseAccountProvider)();
      const account = await requestAccount(provider);
      const read = await (codeRead.current ?? Promise.resolve<BuilderCodeRead>({ state: "unavailable", why: "the read did not start" }));
      const suffix = read.state === "read" ? read.suffix : null;
      let hash: Hash | null;
      if (via.kind === "injected") {
        setStatus({ step: "working", text: `Checking that ${name} is on Base…` });
        await ensureBase(provider);
        setStatus({ step: "working", text: `Confirm the brief in ${name}.` });
        hash = await sendBriefInjected({ provider, account, inbox: inbox.inbox, text: sent, suffix });
      } else {
        setStatus({ step: "working", text: "Confirm the brief in Base Account." });
        const bundle = await sendBriefBaseAccount({ provider, account, inbox: inbox.inbox, text: sent, suffix });
        setStatus({ step: "working", text: "Base Account took the call. Waiting for its transaction…" });
        hash = await bundleTxHash(provider, bundle.id);
        if (!hash) {
          setStatus({ step: "error", text: "Base Account did not report a transaction for the call. Check it in your wallet." });
          return;
        }
      }
      setStatus({ step: "sent", hash, text: "Sent. Waiting for Base to include it…" });
      const receipt = await waitForReceipt(client, hash);
      if (receipt === null) {
        setStatus({ step: "done", hash, text: "Sent, but Base has not included it yet. Reload the page in a minute." });
        return;
      }
      const block = formatInt(Number(receipt.blockNumber));
      if (receipt.status === "reverted") {
        setStatus({ step: "error", hash, text: `The transaction reverted in block ${block}.` });
        return;
      }
      // A smart wallet's transaction can succeed while the brief's call inside it fails: only a Brief log shows it landed.
      const [briefId] = briefIdsIn(receipt.logs, inbox.inbox);
      if (briefId === undefined) {
        setStatus({ step: "error", hash, text: `Included in block ${block}, but the transaction emitted no Brief from the inbox, so the brief is not in the feed.` });
        return;
      }
      const line = `Included in block ${block} as brief #${briefId}. It is in the feed below.`;
      setStatus({ step: "done", hash, text: line });
      setText((t) => (t === sent ? "" : t));
      onIncluded();
      if (suffix) {
        const input = await client.getTransaction({ hash }).then((t) => t.input, () => null);
        // Skipped when another brief was sent meanwhile: the status line is that brief's.
        if (runs.current === run) setStatus({ step: "done", hash, text: line, suffix: input === null ? "unread" : suffixIn(input, suffix) });
      }
    } catch (e) {
      setStatus({ step: "error", text: walletErrorText(e) });
    }
  };

  return (
    <div className="card flex flex-col gap-5 p-5 sm:p-6">
      <label htmlFor={`${id}-text`} className="flex flex-col gap-1.5">
        <span className="font-mono text-[11px] text-ink-2">Your brief</span>
        <textarea
          id={`${id}-text`}
          rows={4}
          value={text}
          readOnly={busy}
          onChange={(e) => setText(e.target.value)}
          aria-describedby={`${id}-bytes`}
          className="min-h-28 w-full min-w-0 resize-y rounded-[10px] border border-line-strong bg-white p-3 text-[15px] leading-relaxed text-ink"
          placeholder="Sell all the NVDAc now, before the close."
        />
      </label>
      <p id={`${id}-bytes`} data-brief-bytes={check.bytes} className={`m-0 font-mono text-[12px] ${check.ok || check.bytes === 0 ? "text-ink-2" : "text-refuse"}`}>
        {check.bytes} / {MAX_BRIEF_BYTES} bytes{check.ok || check.bytes === 0 ? "" : `: ${check.problem}`}
      </p>
      <CodeLine code={code} />
      <div className="flex flex-wrap gap-2">
        {wallets.map((w) => (
          <button
            key={w.info.uuid}
            type="button"
            disabled={busy || !check.ok}
            onClick={() => void send({ kind: "injected", wallet: w })}
            className="pill-dark cursor-pointer border-0 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send with {w.info.name}
          </button>
        ))}
        <button
          type="button"
          disabled={busy || !check.ok}
          onClick={() => void send({ kind: "base-account" })}
          className="pill-line cursor-pointer bg-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send with Base Account
        </button>
      </div>
      {wallets.length === 0 ? (
        <p className="m-0 text-[13px] text-ink-2">No browser wallet announced itself on this page. Base Account works without an extension.</p>
      ) : null}
      <div role="status" aria-live="polite" className="min-h-6">
        {status.step === "working" ? <p className="m-0 text-[15px] text-ink-2">{status.text}</p> : null}
        {status.step === "error" ? (
          <p className="m-0 text-[15px] text-refuse [overflow-wrap:anywhere]">
            {status.text}
            {status.hash ? (
              <>
                {" "}
                <TxLink hash={status.hash} />
              </>
            ) : null}
          </p>
        ) : null}
        {status.step === "sent" || status.step === "done" ? (
          <p data-sent-tx={status.hash} className="m-0 text-[15px] text-ink [overflow-wrap:anywhere]">
            {status.text} <TxLink hash={status.hash} />
          </p>
        ) : null}
        {status.step === "done" && status.suffix ? (
          <p data-suffix-check={status.suffix} className="m-0 mt-1 text-[13px] text-ink-2">
            {SUFFIX_CHECK[status.suffix]}
          </p>
        ) : null}
      </div>
    </div>
  );
}
