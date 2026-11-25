"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Address, Hash } from "viem";
import { basescanTx } from "@/lib/chain/basescan";
import { checkBrief, MAX_BRIEF_BYTES, waitForReceipt, type InboxDeployment } from "@/lib/chain/inbox";
import type { LedgerClient } from "@/lib/chain/load";
import { baseAccountProvider } from "@/lib/wallet/base-account";
import { readBuilderCode, type BuilderCodeRead } from "@/lib/wallet/builder-code";
import { watchWallets, type Eip1193Provider, type InjectedWallet } from "@/lib/wallet/eip6963";
import { bundleTxHash, ensureBase, requestAccount, sendBriefBaseAccount, sendBriefInjected, walletErrorText } from "@/lib/wallet/send";

type Status =
  | { step: "idle" }
  | { step: "working"; text: string }
  | { step: "sent"; hash: Hash; text: string }
  | { step: "done"; hash: Hash; text: string }
  | { step: "error"; text: string };

type Via = { kind: "injected"; wallet: InjectedWallet } | { kind: "base-account" };

export interface BriefFormDeps {
  /** The wallets to offer; by default the EIP-6963 announcements on window. */
  watch?: (onChange: (wallets: InjectedWallet[]) => void) => () => void;
  baseAccount?: () => Promise<Eip1193Provider>;
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
      Builder Code <span className="font-mono text-ink">{code.code}</span>, read from the vault&apos;s first Decision, goes at the end of the
      brief&apos;s calldata (ERC-8021).
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
        hash = await sendBriefInjected({ provider, account, inbox: inbox.inbox, text, suffix });
      } else {
        setStatus({ step: "working", text: "Confirm the brief in Base Account." });
        const bundle = await sendBriefBaseAccount({ provider, account, inbox: inbox.inbox, text, suffix });
        setStatus({ step: "working", text: "Base Account took the call. Waiting for its transaction…" });
        hash = await bundleTxHash(provider, bundle.id);
        if (!hash) {
          setStatus({ step: "error", text: "Base Account did not report a transaction for the call. Check it in your wallet." });
          return;
        }
      }
      setStatus({ step: "sent", hash, text: "Sent. Waiting for Base to include it…" });
      const receipt = await waitForReceipt(client, hash);
      if (receipt === null) setStatus({ step: "done", hash, text: "Sent, but Base has not included it yet. Reload the page in a minute." });
      else if (receipt.status === "reverted") setStatus({ step: "error", text: `The transaction reverted in block ${receipt.blockNumber}.` });
      else {
        setStatus({ step: "done", hash, text: `Included in block ${receipt.blockNumber}. It is in the feed below.` });
        setText("");
        onIncluded();
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
        {status.step === "error" ? <p className="m-0 text-[15px] text-refuse">{status.text}</p> : null}
        {status.step === "sent" || status.step === "done" ? (
          <p data-sent-tx={status.hash} className="m-0 text-[15px] text-ink [overflow-wrap:anywhere]">
            {status.text}{" "}
            <a href={basescanTx(status.hash)} target="_blank" rel="noopener noreferrer" className="font-mono text-[13px]">
              View the transaction on Basescan
            </a>
          </p>
        ) : null}
      </div>
    </div>
  );
}
