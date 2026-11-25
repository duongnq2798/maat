import { render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";
import { ReasonTag, type ReasonTagLayout, type ReasonTagTone } from "@/components/ui/ReasonTag";
import { REASON_LABEL, type ReasonCode, REASONS } from "@/content/reasons";

const CODES: readonly ReasonCode[] = ["OK", ...REASONS];

/** Renders one tag and returns its root and its two children: the label, then the code. */
function setup(props: ComponentProps<typeof ReasonTag>) {
  const { container } = render(<ReasonTag {...props} />);
  const root = container.firstElementChild as HTMLElement;
  const [label, code] = [...root.children] as [HTMLElement, HTMLElement];
  return { root, label, code };
}

describe("ReasonTag", () => {
  it("renders the plain label, then the code", () => {
    const { root, label, code } = setup({ code: "MARKET_CLOSED" });
    expect(root.tagName).toBe("SPAN");
    expect(root.children).toHaveLength(2);
    expect(label.textContent).toBe("Market closed");
    expect(code.textContent).toBe("MARKET_CLOSED");
  });

  it("marks its root with the code it shows", () => {
    const { root } = setup({ code: "PREMIUM_TOO_HIGH" });
    expect(root).toHaveAttribute("data-reason-tag", "PREMIUM_TOO_HIGH");
  });

  it.each(CODES)("%s reads as its label and its code, with no other characters", (c) => {
    const { root } = setup({ code: c });
    expect(root.textContent).toBe(`${REASON_LABEL[c]}${c}`);
  });

  it("keeps the label and the code in the accessible text: nothing is aria-hidden", () => {
    const { root } = setup({ code: "MARKET_CLOSED", tone: "verdict" });
    expect(root).not.toHaveAttribute("aria-hidden");
    expect(root.querySelector("[aria-hidden]")).toBeNull();
  });

  it("defaults to the neutral tone, stacked", () => {
    const { root, label, code } = setup({ code: "SIZE_LIMIT" });
    expect(root.className).toBe("inline-flex flex-col gap-0.5");
    expect(label.className).toBe("text-ink");
    expect(code.className).toBe("font-mono text-[11px] text-ink-2");
  });

  it.each<[ReasonTagLayout, string]>([
    ["stacked", "inline-flex flex-col gap-0.5"],
    ["inline", "inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5"],
  ])("layout %s lays the root out as %j", (layout, rootClass) => {
    const { root } = setup({ code: "MARKET_CLOSED", layout });
    expect(root.className).toBe(rootClass);
  });

  it.each<[ReasonTagTone, string, string]>([
    ["verdict", "font-semibold", "font-mono text-[11px] opacity-80"],
    ["refuse", "text-refuse", "font-mono text-[11px] text-refuse"],
    ["neutral", "text-ink", "font-mono text-[11px] text-ink-2"],
  ])("tone %s gives the label %j and the code %j", (tone, labelClass, codeClass) => {
    const { label, code } = setup({ code: "MARKET_CLOSED", tone });
    expect(label.className).toBe(labelClass);
    expect(code.className).toBe(codeClass);
  });

  it("adds the caller's classes to the root", () => {
    const { root } = setup({ code: "OK", tone: "verdict", layout: "stacked", className: "text-right text-[15px]" });
    expect(root.className).toBe("inline-flex flex-col gap-0.5 text-right text-[15px]");
  });
});
