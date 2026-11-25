import { render } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { Ghost } from "@/components/instrument/Ghost";
import { READOUT_CLASS, Readout, ReadoutKeys } from "@/components/instrument/Readout";
import { READING } from "@/components/live/LiveStatus";

describe("Readout (components/instrument/Readout.tsx)", () => {
  it("is one chassis-2 window, full width, with the reserved height after its own classes", () => {
    const { container } = render(
      <Readout reserve="h-[132px] md:h-[112px]" className="mt-6">
        <p>x</p>
      </Readout>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(container.children).toHaveLength(1);
    expect(root.tagName).toBe("DIV");
    expect(root).toHaveAttribute("data-readout", "");
    expect(root.className).toBe(`${READOUT_CLASS} h-[132px] md:h-[112px] mt-6`);
    for (const c of ["w-full", "rounded-[14px]", "border-chassis-line", "bg-chassis-2", "text-lcd"]) {
      expect(root.classList.contains(c), c).toBe(true);
    }
  });

  it("passes the live strip's ref, tabIndex and data-live-strip through to that one element", () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(
      <Readout ref={ref} reserve="h-[120px]" tabIndex={-1} data-live-strip="live" aria-label="Live reading">
        <p>x</p>
      </Readout>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(ref.current).toBe(root);
    expect(root).toHaveAttribute("tabindex", "-1");
    expect(root).toHaveAttribute("data-live-strip", "live");
    expect(root).toHaveAttribute("aria-label", "Live reading");
    ref.current?.focus();
    expect(document.activeElement).toBe(root);
  });

  it("keeps the strip's children as its direct children, in order: span, one p, the keys div, noscript", () => {
    const { container } = render(
      <Readout reserve="h-[120px]" data-live-strip="reading">
        <span className="sr-only" role="status" aria-live="polite" />
        <p className="m-0">
          <Ghost pattern="88,888,888" />
          {READING}
        </p>
        <ReadoutKeys>
          <button type="button">Hold</button>
        </ReadoutKeys>
        <noscript>Live data needs JavaScript.</noscript>
      </Readout>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect([...root.children].map((c) => c.tagName)).toEqual(["SPAN", "P", "DIV", "NOSCRIPT"]);
    expect(root.querySelectorAll(":scope > p")).toHaveLength(1);
    expect(root.querySelector(":scope > p")?.textContent).toBe(READING);
    expect(root.querySelector(":scope > [data-readout-keys]")?.tagName).toBe("DIV");
  });

  it("adds no live region of its own: the strip's announcer stays the only one", () => {
    const { container } = render(
      <Readout reserve="h-[120px]">
        <span role="status" aria-live="polite" />
        <p>x</p>
      </Readout>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root).not.toHaveAttribute("aria-live");
    expect(root).not.toHaveAttribute("role");
    expect(root.querySelectorAll("[aria-live]")).toHaveLength(1);
  });
});

describe("ReadoutKeys (components/instrument/Readout.tsx)", () => {
  it("is a div of small lcd-2 mono keys, never a p", () => {
    const { container } = render(
      <ReadoutKeys className="justify-end">
        <button type="button">Retry</button>
      </ReadoutKeys>,
    );
    const keys = container.firstElementChild as HTMLElement;
    expect(keys.tagName).toBe("DIV");
    expect(keys).toHaveAttribute("data-readout-keys", "");
    expect(keys.className).toBe("flex flex-wrap items-center gap-2 font-mono text-[11px] text-lcd-2 justify-end");
    expect(container.querySelector("p")).toBeNull();
  });
});
