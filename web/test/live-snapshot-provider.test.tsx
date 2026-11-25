import { fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LiveSnapshotProvider, useLive, useLiveIfAny } from "@/components/live/LiveSnapshotProvider";
import { LiveStrip } from "@/components/live/LiveStrip";
import { REFRESH_MS } from "@/lib/live/freshness";
import { advance, fakeReader, installLiveClocks, SAT } from "./helpers/fake-reader";

installLiveClocks();

/** A subscriber that shows the shared status and holds or releases the reading. */
function Probe({ name }: { name: string }) {
  const { state, hold, setHold } = useLive();
  return (
    <button type="button" aria-pressed={hold} onClick={() => setHold(!hold)}>
      {`${name}: ${state.status}`}
    </button>
  );
}

function Orphan() {
  return <span data-orphan="">{useLiveIfAny() === null ? "no provider" : "provider"}</span>;
}

async function mount(children: React.ReactNode) {
  vi.setSystemTime((SAT + 14) * 1000);
  const fake = fakeReader({ timestamp: SAT });
  render(<LiveSnapshotProvider reader={fake.reader}>{children}</LiveSnapshotProvider>);
  await advance(0);
  return fake;
}

describe("LiveSnapshotProvider", () => {
  it("runs one read loop for every subscriber on the page", async () => {
    const fake = await mount(
      <>
        <Probe name="a" />
        <Probe name="b" />
        <LiveStrip />
      </>,
    );
    expect(fake.multicalls()).toBe(1);
    expect(screen.getByRole("button", { name: "a: live" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "b: live" })).toBeInTheDocument();
    expect(document.querySelector("[data-live-strip]")).toHaveAttribute("data-live-strip", "live");
    // One refresh timer and one reclassify interval, not one pair per subscriber.
    expect(vi.getTimerCount()).toBe(2);
    await advance(REFRESH_MS);
    expect(fake.multicalls()).toBe(2);
  });

  it("holds every subscriber when one holds: no read, no timer, until it is released", async () => {
    const fake = await mount(
      <>
        <Probe name="a" />
        <Probe name="b" />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "a: live" }));
    expect(screen.getByRole("button", { name: "b: live" })).toHaveAttribute("aria-pressed", "true");
    expect(vi.getTimerCount()).toBe(0);
    await advance(REFRESH_MS * 3);
    expect(fake.multicalls()).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: /^b: / }));
    expect(screen.getByRole("button", { name: /^a: / })).toHaveAttribute("aria-pressed", "false");
    await advance(0);
    expect(fake.multicalls()).toBe(2);
    expect(screen.getByRole("button", { name: "a: live" })).toBeInTheDocument();
  });

  it("feeds a strip under it from the page's loop, never from the strip's own reader", async () => {
    const own = fakeReader({ timestamp: SAT });
    const fake = await mount(<LiveStrip reader={own.reader} />);
    expect(fake.multicalls()).toBe(1);
    expect(own.call).not.toHaveBeenCalled();
    expect(document.querySelector("[data-live-strip]")).toHaveAttribute("data-live-strip", "live");
  });

  it("holds the reading state only in the static HTML, and reads nothing on the server", () => {
    const fake = fakeReader({ timestamp: SAT });
    const html = renderToString(
      <LiveSnapshotProvider reader={fake.reader}>
        <Probe name="a" />
        <LiveStrip />
      </LiveSnapshotProvider>,
    );
    expect(html).toContain("a: reading");
    expect(html).toContain("Reading Base mainnet");
    for (const value of ["60,013,066", "60013066", ">LIVE<", "basescan.org/block/", "REFUSE", "data-verdict-line"]) {
      expect(html).not.toContain(value);
    }
    expect(fake.call).not.toHaveBeenCalled();
  });

  it("gives null to useLiveIfAny with no provider above", () => {
    render(<Orphan />);
    expect(screen.getByText("no provider")).toBeInTheDocument();
  });

  it("says which provider is missing when useLive has none", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => render(<Probe name="x" />)).toThrow("useLive needs a LiveSnapshotProvider above it");
    } finally {
      quiet.mockRestore();
    }
  });
});
