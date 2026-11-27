import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HoldKey, KEY_CLASS } from "@/components/instrument/HoldKey";
import { LiveSnapshotProvider } from "@/components/live/LiveSnapshotProvider";
import { REFRESH_MS } from "@/lib/live/freshness";
import { advance, fakeReader, installLiveClocks, SAT } from "./helpers/fake-reader";

installLiveClocks();

// Read from web/, where vitest runs: under jsdom, import.meta.url is not a file URL.
const css = readFileSync("app/globals.css", "utf8");

async function mount() {
  vi.setSystemTime((SAT + 14) * 1000);
  const fake = fakeReader({ timestamp: SAT });
  render(
    <LiveSnapshotProvider reader={fake.reader}>
      <HoldKey className="ml-2" />
    </LiveSnapshotProvider>,
  );
  await advance(0);
  return fake;
}

describe("HoldKey (spec 2026-11-23 section 5.1, WCAG 2.2.2)", () => {
  it("is a toggle button named Pause, not pressed at first (spec 2026-11-27 section 4: HOLD became Pause)", async () => {
    await mount();
    const key = screen.getByRole("button", { name: "Pause" });
    expect(key.tagName).toBe("BUTTON");
    expect(key).toHaveAttribute("type", "button");
    expect(key).toHaveAttribute("aria-pressed", "false");
    expect(key).toHaveAttribute("data-hold-key");
    expect(key.className).toBe(`${KEY_CLASS} ml-2`);
  });

  it("holds the page's reading while pressed, with no read and no timer, and a second press reads on", async () => {
    const fake = await mount();
    const key = screen.getByRole("button", { name: "Pause" });
    fireEvent.click(key);
    expect(key).toHaveAttribute("aria-pressed", "true");
    expect(vi.getTimerCount()).toBe(0);
    await advance(REFRESH_MS * 2);
    expect(fake.multicalls()).toBe(1);
    fireEvent.click(key);
    expect(key).toHaveAttribute("aria-pressed", "false");
    await advance(0);
    expect(fake.multicalls()).toBe(2);
  });

  it("needs the page's provider: it never starts a read loop of its own", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => render(<HoldKey />)).toThrow("useLive needs a LiveSnapshotProvider above it");
    } finally {
      quiet.mockRestore();
    }
  });

  it("is a 24 px key with a 44 px target, lit pass-lit while pressed, and travels 1 px when pressed", () => {
    for (const cls of ["readout-key", "min-h-6", "text-lcd-2", "aria-pressed:border-pass-lit", "aria-pressed:text-pass-lit"]) {
      expect(KEY_CLASS.split(" ")).toContain(cls);
    }
    expect(css).toMatch(
      /\.readout-key\s*\{\s*position:\s*relative;\s*transition:\s*translate 60ms var\(--ease-instrument\), color var\(--t-tick\) var\(--ease-instrument\), border-color var\(--t-tick\) var\(--ease-instrument\);\s*\}/,
    );
    expect(css).toMatch(/\.readout-key::before\s*\{\s*content:\s*"";\s*position:\s*absolute;\s*inset:\s*-10px -4px;\s*\}/);
    expect(css).toMatch(/\.readout-key:active\s*\{\s*translate:\s*0 1px;\s*\}/);
  });
});
