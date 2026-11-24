import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useLiveSnapshot } from "@/components/live/useLiveSnapshot";
import { type LiveState, REFRESH_MS } from "@/lib/live/freshness";
import { advance, BLOCK, fakeReader, hideTab, installLiveClocks, SAT, showTab } from "./helpers/fake-reader";

installLiveClocks();

/** The hook on a fake Base, with the visitor's clock 14 s after the block, the first read answered. */
async function mount(active = true) {
  vi.setSystemTime((SAT + 14) * 1000);
  const fake = fakeReader({ timestamp: SAT });
  const hook = renderHook(({ on }: { on: boolean }) => useLiveSnapshot({ reader: fake.reader, active: on }), {
    initialProps: { on: active },
  });
  await advance(0);
  return { fake, hook };
}

const blockOf = (s: LiveState) => ("reading" in s ? s.reading.snapshot.block : null);

describe("useLiveSnapshot's active option (HOLD)", () => {
  it("reads at mount and every REFRESH_MS while active, as before", async () => {
    const { fake, hook } = await mount();
    expect(fake.multicalls()).toBe(1);
    expect(hook.result.current.state.status).toBe("live");
    // The refresh timer and the 5 s reclassify interval.
    expect(vi.getTimerCount()).toBe(2);
    await advance(REFRESH_MS);
    expect(fake.multicalls()).toBe(2);
  });

  it("while held runs no timer, starts no read and keeps the frame on screen", async () => {
    const { fake, hook } = await mount();
    hook.rerender({ on: false });
    const frame = hook.result.current.state;
    expect(vi.getTimerCount()).toBe(0);
    await advance(REFRESH_MS * 4);
    expect(fake.multicalls()).toBe(1);
    expect(hook.result.current.state).toEqual(frame);
    expect(hook.result.current.state.status).toBe("live");
  });

  it("on release shows a reading that aged past the live limit as stale at once, and reads at once", async () => {
    const { fake, hook } = await mount();
    hook.rerender({ on: false });
    await advance(100_000);
    fake.hold();
    hook.rerender({ on: true });
    expect(hook.result.current.state.status).toBe("stale");
    expect(fake.multicalls()).toBe(2);
    fake.release({ timestamp: SAT + 105 });
    await advance(0);
    expect(hook.result.current.state.status).toBe("live");
    expect(vi.getTimerCount()).toBe(2);
  });

  it("on release after a short hold keeps the 30 s schedule from the last read", async () => {
    const { fake, hook } = await mount();
    hook.rerender({ on: false });
    await advance(10_000);
    hook.rerender({ on: true });
    expect(fake.multicalls()).toBe(1);
    await advance(REFRESH_MS - 10_000 - 1);
    expect(fake.multicalls()).toBe(1);
    await advance(1);
    expect(fake.multicalls()).toBe(2);
  });

  it("keeps exactly one loop when the hold starts and ends while a read is in flight", async () => {
    const { fake, hook } = await mount();
    fake.hold();
    await advance(REFRESH_MS);
    expect(fake.multicalls()).toBe(2);
    hook.rerender({ on: false });
    hook.rerender({ on: true });
    fake.release({ timestamp: SAT + 30 });
    await advance(0);
    expect(hook.result.current.state.status).toBe("live");
    expect(vi.getTimerCount()).toBe(2);
    await advance(REFRESH_MS);
    expect(fake.multicalls()).toBe(3);
  });

  it("shows a read that lands while held only when the hold ends", async () => {
    const { fake, hook } = await mount();
    fake.hold();
    await advance(REFRESH_MS);
    hook.rerender({ on: false });
    fake.release({ timestamp: SAT + 30, block: BLOCK + 5n });
    await advance(0);
    expect(blockOf(hook.result.current.state)).toBe(BLOCK);
    expect(vi.getTimerCount()).toBe(0);
    hook.rerender({ on: true });
    expect(blockOf(hook.result.current.state)).toBe(BLOCK + 5n);
    expect(hook.result.current.state.status).toBe("live");
  });

  it("answers Refresh while held, at once, and still runs no timer", async () => {
    const { fake, hook } = await mount();
    hook.rerender({ on: false });
    fake.set({ timestamp: SAT, block: BLOCK + 5n });
    act(() => hook.result.current.refresh());
    expect(hook.result.current.refreshing).toBe(true);
    await advance(0);
    const s = hook.result.current.state;
    expect(blockOf(s)).toBe(BLOCK + 5n);
    expect("ageMs" in s ? s.ageMs : null).toBe(0);
    expect(hook.result.current.refreshing).toBe(false);
    expect(fake.multicalls()).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("starts no read while it mounts held, and reads as soon as the hold ends", async () => {
    const { fake, hook } = await mount(false);
    expect(fake.multicalls()).toBe(0);
    expect(hook.result.current.state.status).toBe("reading");
    expect(vi.getTimerCount()).toBe(0);
    hook.rerender({ on: true });
    await advance(0);
    expect(fake.multicalls()).toBe(1);
    expect(hook.result.current.state.status).toBe("live");
  });

  it("reads nothing when a tab or page comes back while held", async () => {
    const { fake, hook } = await mount();
    hook.rerender({ on: false });
    hideTab();
    await advance(REFRESH_MS * 2);
    await act(async () => {
      showTab();
      window.dispatchEvent(new Event("pageshow"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fake.multicalls()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
