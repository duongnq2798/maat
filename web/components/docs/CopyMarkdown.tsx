"use client";

import { useEffect, useRef, useState } from "react";

type State = "idle" | "copying" | "copied" | "error";

const LABEL: Record<State, string> = {
  idle: "Copy page as Markdown",
  copying: "Copying...",
  copied: "Copied",
  error: "Copy failed. Try again",
};

/** Copies the page's static Markdown file (/md/...md) to the clipboard. */
export function CopyMarkdown({ href, className }: { href: string; className?: string }) {
  const [state, setState] = useState<State>("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    window.clearTimeout(timer.current);
    setState("copying");
    try {
      // The fetch goes inside the ClipboardItem: Safari only allows the write while the click is still current.
      const blob = fetch(href).then(async (res) => {
        if (!res.ok) throw new Error(`${href}: HTTP ${res.status}`);
        return new Blob([await res.text()], { type: "text/plain" });
      });
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
      setState("copied");
    } catch {
      setState("error");
    }
    timer.current = window.setTimeout(() => setState("idle"), 2500);
  }

  return (
    <button type="button" onClick={copy} disabled={state === "copying"} data-state={state} className={className}>
      <span aria-live="polite">{LABEL[state]}</span>
    </button>
  );
}
