import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BlockLink, LivePill, NotLiveWhy, ReadButton } from "@/components/live/LiveStatus";
import { CHASSIS_TONE, TONE, VerdictLine } from "@/components/live/VerdictLine";
import { classify } from "@/lib/live/freshness";
import { readingAt, SAT } from "./helpers/fake-reader";

const PILL = "mr-1 inline-flex items-center gap-1.5 rounded-full px-2 align-[1px] font-mono text-[11px] font-semibold leading-4";
// NowBoard's classes before P1: the faceplate palette keeps every one of them, byte for byte.
const FACEPLATE_READ_BUTTON =
  "cursor-pointer rounded-full border border-line-strong bg-transparent align-middle font-medium text-ink hover:border-ink aria-disabled:cursor-wait aria-disabled:text-ink-2 aria-disabled:hover:border-line-strong";
const CHASSIS_READ_BUTTON =
  "cursor-pointer rounded-full border border-chassis-line bg-transparent align-middle font-medium text-lcd hover:border-lcd-2 aria-disabled:cursor-wait aria-disabled:text-lcd-2 aria-disabled:hover:border-chassis-line";

/** Read at SAT + 14 s; the refresh after it failed; looked at 30 s later. */
function staleState() {
  const s = classify(readingAt(SAT, { readAtMs: 0, wallAtReadSec: SAT + 14 }), true, 30_000, SAT + 44);
  if (s.status !== "stale") throw new Error(`expected a stale state, not ${s.status}`);
  return s;
}

describe("the live pieces on the faceplate and on the chassis (spec 2026-11-23 section 5.2)", () => {
  it("keeps NowBoard's faceplate classes and markup byte for byte by default", () => {
    render(
      <>
        <LivePill live />
        <LivePill live={false} />
        <BlockLink n={60_013_066n}>Base block 60,013,066</BlockLink>
        <ReadButton refreshing={false} onClick={() => {}} idle="Refresh" busy="Refreshing…" className="h-6 px-2.5" />
        <VerdictLine headline={{ kind: "refuse-all", reason: "MARKET_CLOSED" }} />
      </>,
    );
    const live = screen.getByText("LIVE");
    expect(live.className).toBe(`${PILL} bg-accent-tint py-px text-accent`);
    expect(live.firstElementChild!.className).toBe("anim-live size-1.5 rounded-full bg-accent");
    expect(screen.getByText("NOT LIVE").className).toBe(`${PILL} border border-ink-2 text-ink-2`);
    const link = screen.getByRole("link", { name: "Base block 60,013,066" });
    expect(link.className).toBe("whitespace-nowrap font-mono text-[12px]");
    expect(link).not.toHaveAttribute("aria-label");
    expect(screen.getByRole("button", { name: "Refresh" }).className).toBe(`${FACEPLATE_READ_BUTTON} h-6 px-2.5`);
    const line = document.querySelector("[data-verdict-line]")!;
    expect(line.className).toBe("text-ink");
    expect(line).toHaveAttribute("data-tone", "ink");
    expect(TONE).toEqual({ ink: "text-ink", muted: "text-ink-2 [&_[data-reason-tag]>span]:text-ink-2" });
  });

  it("draws the chassis pill and the Retry key in lcd and pass-lit", () => {
    render(
      <>
        <LivePill live palette="chassis" />
        <LivePill live={false} palette="chassis" />
        <ReadButton palette="chassis" refreshing onClick={() => {}} idle="Retry" busy="Retrying…" className="h-6 px-2.5" />
      </>,
    );
    const live = screen.getByText("LIVE");
    expect(live.className).toBe(`${PILL} readout-lit border border-pass-lit text-pass-lit`);
    expect(live.firstElementChild!.className).toBe("anim-live size-1.5 rounded-full bg-pass-lit");
    expect(screen.getByText("NOT LIVE").className).toBe(`${PILL} border border-lcd-2 text-lcd-2`);
    const retry = screen.getByRole("button", { name: "Retrying…" });
    expect(retry.className).toBe(`${CHASSIS_READ_BUTTON} h-6 px-2.5`);
    expect(retry).toHaveAttribute("aria-disabled", "true");
  });

  it("names a chassis block link by its label, whatever its content", () => {
    render(
      <BlockLink n={60_013_066n} label="Base block 60,013,066" palette="chassis">
        <span>60,013,066</span>
      </BlockLink>,
    );
    const link = screen.getByRole("link", { name: "Base block 60,013,066" });
    expect(link).toHaveAttribute("href", "https://basescan.org/block/60013066");
    expect(link.className).toBe("whitespace-nowrap font-mono text-[12px] text-pass-lit");
  });

  it("says why a reading is not live in the same words on either surface", () => {
    const state = staleState();
    const { unmount } = render(<NotLiveWhy state={state} />);
    const words = "last read block 60,013,066, 30 s ago · the RPC did not answer since";
    expect(document.body).toHaveTextContent(words);
    expect(screen.getByRole("link", { name: "60,013,066" }).className).toBe("whitespace-nowrap font-mono text-[12px]");
    unmount();
    render(<NotLiveWhy state={state} palette="chassis" />);
    expect(document.body).toHaveTextContent(words);
    expect(screen.getByRole("link", { name: "60,013,066" }).className).toBe("whitespace-nowrap font-mono text-[12px] text-pass-lit");
  });

  it("keeps data-tone and the sentence on the chassis, with its own tones", () => {
    expect(CHASSIS_TONE).toEqual({
      ink: "text-lcd [&_a]:text-pass-lit [&_[data-reason-tag]>span]:text-lcd [&_[data-reason-tag]>span+span]:text-lcd-2",
      muted: "text-lcd-2 [&_a]:text-pass-lit [&_[data-reason-tag]>span]:text-lcd-2",
    });
    const h = { kind: "refuse-all", reason: "MARKET_CLOSED" } as const;
    render(
      <>
        <VerdictLine headline={h} palette="chassis" />
        <VerdictLine headline={h} tone="muted" palette="chassis" className="block" />
      </>,
    );
    const [ink, muted] = [...document.querySelectorAll("[data-verdict-line]")];
    expect(ink!.className).toBe(CHASSIS_TONE.ink);
    expect(ink).toHaveAttribute("data-tone", "ink");
    expect(muted!.className).toBe(`${CHASSIS_TONE.muted} block`);
    expect(muted).toHaveAttribute("data-tone", "muted");
    expect(ink!.textContent).toBe(muted!.textContent);
  });
});
