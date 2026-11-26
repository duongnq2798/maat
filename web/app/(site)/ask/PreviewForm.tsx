"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { getAddress, isAddress, type Address } from "viem";
import { ReasonTag } from "@/components/ui/ReasonTag";
import { ACTIONS, type ActionName } from "@/content/decisions";
import { formatInt } from "@/content/format";
import type { ReasonCode } from "@/content/reasons";
import type { LedgerClient } from "@/lib/chain/load";
import { errorText } from "@/lib/chain/load";
import { amountUnit, parseAmount, previewIntent, previewTokens, tokenDecimals, vaultPayees } from "@/lib/chain/preview";
import { reasonDisplay } from "@/lib/chain/reason";
import { shortAddress } from "@/lib/chain/tokens";

type Answer =
  | { state: "idle" }
  | { state: "asking" }
  | { state: "answer"; reason: ReasonCode; blockNumber: bigint; asked: string }
  | { state: "error"; message: string };

const FIELD = "min-h-10 w-full min-w-0 rounded-[10px] border border-line-strong bg-white px-3 font-mono text-sm text-ink";

/** A free previewIntent of one intent against the live vault: one eth_call over the site's public RPCs. */
export function PreviewForm({ vault, client }: { vault: Address | null; client: LedgerClient }) {
  const tokens = previewTokens();
  const id = useId();
  const [action, setAction] = useState<ActionName>("BUY");
  const [token, setToken] = useState<Address>(tokens[0]!.address);
  const [amount, setAmount] = useState("20");
  const [answer, setAnswer] = useState<Answer>({ state: "idle" });
  const [payee, setPayee] = useState("");
  const [payeeNote, setPayeeNote] = useState<string | null>(null);
  const payeesRead = useRef(false);
  const unit = amountUnit(action);
  const symbol = tokens.find((t) => t.address === token)?.symbol ?? token;
  const expense = action === "PAY_EXPENSE";

  // PAY_EXPENSE needs a payee the vault allowlists, so the first time it is picked the field gets the vault's first one.
  useEffect(() => {
    if (!expense || !vault || payeesRead.current) return;
    payeesRead.current = true;
    vaultPayees(client, vault).then(
      (list) => {
        const first = list[0];
        if (first === undefined) return setPayeeNote("The vault lists no payee, so it refuses every expense.");
        setPayee((p) => (p === "" ? first : p));
        setPayeeNote("Filled with the vault's first payee, from payees().");
      },
      () => setPayeeNote("The vault's payees() could not be read."),
    );
  }, [expense, vault, client]);

  const ask = async (e: FormEvent) => {
    e.preventDefault();
    if (!vault) return;
    const to = payee.trim();
    if (expense && !isAddress(to, { strict: false })) {
      setAnswer({ state: "error", message: "Enter the payee as a 0x address of 40 hex digits." });
      return;
    }
    const payeeAddress = expense ? getAddress(to) : undefined;
    setAnswer({ state: "asking" });
    try {
      const decimals = unit === "usdc" ? 6 : await tokenDecimals(client, token);
      const units = parseAmount(amount, decimals);
      if (units === null) {
        setAnswer({ state: "error", message: `Enter an amount such as 20 or 0.5, with at most ${decimals} decimals.` });
        return;
      }
      const r = await previewIntent(client, vault, { action, token, amount: units, payee: payeeAddress });
      const asked = `${action} ${symbol}, ${amount.trim()} ${unit === "usdc" ? "USDC" : symbol}${payeeAddress ? ` to ${shortAddress(payeeAddress)}` : ""}`;
      setAnswer({ state: "answer", reason: r.reason, blockNumber: r.blockNumber, asked });
    } catch (err) {
      setAnswer({ state: "error", message: `The vault could not be asked: ${errorText(err)}` });
    }
  };

  if (!vault) return <p className="m-0 text-[15px] text-ink-2">The vault is not recorded in deployments/README.md yet, so there is nothing to ask.</p>;

  return (
    <form onSubmit={ask} className="card flex flex-col gap-5 p-5 sm:p-6" aria-label="Ask the real vault">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex min-w-0 flex-col gap-1.5" htmlFor={`${id}-action`}>
          <span className="font-mono text-[11px] text-ink-2">Action</span>
          <select id={`${id}-action`} className={FIELD} value={action} onChange={(e) => setAction(e.target.value as ActionName)}>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1.5" htmlFor={`${id}-token`}>
          <span className="font-mono text-[11px] text-ink-2">Token</span>
          <select id={`${id}-token`} className={FIELD} value={token} onChange={(e) => setToken(e.target.value as Address)}>
            {tokens.map((t) => (
              <option key={t.address} value={t.address}>
                {t.symbol}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1.5" htmlFor={`${id}-amount`}>
          <span className="font-mono text-[11px] text-ink-2">Amount ({unit === "usdc" ? "USDC" : `${symbol} units`})</span>
          <input id={`${id}-amount`} className={FIELD} inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
      </div>
      {expense ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          <label className="flex min-w-0 flex-col gap-1.5" htmlFor={`${id}-payee`}>
            <span className="font-mono text-[11px] text-ink-2">Payee</span>
            <input
              id={`${id}-payee`}
              className={FIELD}
              autoComplete="off"
              spellCheck={false}
              placeholder="0x…"
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
              aria-describedby={payeeNote ? `${id}-payee-note` : undefined}
            />
          </label>
          {payeeNote ? (
            <span id={`${id}-payee-note`} className="text-[13px] text-ink-2">
              {payeeNote}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="pill-dark cursor-pointer border-0 disabled:cursor-not-allowed disabled:opacity-50" disabled={answer.state === "asking"}>
          Ask the vault
        </button>
        <span className="text-[13px] text-ink-2">Free: an eth_call from your browser. Nothing is signed or sent.</span>
      </div>
      <div role="status" aria-live="polite" className="min-h-6">
        {answer.state === "asking" ? <p className="m-0 text-[15px] text-ink-2">Asking the vault on Base…</p> : null}
        {answer.state === "error" ? <p className="m-0 text-[15px] text-refuse">{answer.message}</p> : null}
        {answer.state === "answer" ? <PreviewAnswer {...answer} /> : null}
      </div>
    </form>
  );
}

function PreviewAnswer({ reason, blockNumber, asked }: { reason: ReasonCode; blockNumber: bigint; asked: string }) {
  const d = reasonDisplay(reason);
  return (
    <div data-preview-reason={reason} className="flex flex-col gap-2">
      <p className="m-0 text-[15px] text-ink-2">
        {asked}, at block {formatInt(Number(blockNumber))}: the vault {reason === "OK" ? "would allow it" : "would refuse it"}.
      </p>
      <ReasonTag code={reason} tone={reason === "OK" ? "neutral" : "refuse"} layout="inline" className="text-[17px] font-semibold" />
      <p className="m-0 text-[15px] leading-relaxed text-ink-body">{d.meaning}</p>
    </div>
  );
}
