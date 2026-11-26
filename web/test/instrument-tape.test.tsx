import { readFileSync } from "node:fs";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Tape, TapeRow } from "@/components/instrument/Tape";

// Read from web/, where vitest runs: under jsdom, import.meta.url is not a file URL.
const css = readFileSync("app/globals.css", "utf8");

describe("Tape (components/instrument/Tape.tsx)", () => {
  it("is an ordered list of rows, never a table", () => {
    const { container } = render(
      <Tape label="Vault decisions" className="mt-4">
        <TapeRow verdict="allowed">BUY NVDAc · allowed</TapeRow>
        <TapeRow verdict="refused">BUY NVDAc · refused · MARKET_CLOSED</TapeRow>
      </Tape>,
    );
    const tape = container.firstElementChild as HTMLElement;
    expect(tape.tagName).toBe("OL");
    expect(tape).toHaveAttribute("data-tape", "");
    expect(tape).toHaveAttribute("aria-label", "Vault decisions");
    expect(tape.className).toBe("tape mt-4");
    expect(container.querySelector("table")).toBeNull();
    const rows = [...tape.children] as HTMLElement[];
    expect(rows.map((r) => r.tagName)).toEqual(["LI", "LI"]);
    expect(rows.map((r) => r.getAttribute("data-verdict"))).toEqual(["allowed", "refused"]);
    expect(rows.map((r) => r.textContent)).toEqual(["BUY NVDAc · allowed", "BUY NVDAc · refused · MARKET_CLOSED"]);
  });

  it("has no accessible name unless given one", () => {
    const { container } = render(
      <Tape>
        <TapeRow verdict="allowed">row</TapeRow>
      </Tape>,
    );
    expect(container.firstElementChild).not.toHaveAttribute("aria-label");
  });

  it("marks only a fresh row to print in; a row from the static HTML is at its final frame", () => {
    const { container } = render(
      <Tape>
        <TapeRow verdict="allowed">old</TapeRow>
        <TapeRow verdict="refused" fresh className="py-2">
          new
        </TapeRow>
      </Tape>,
    );
    const [old, fresh] = [...container.querySelectorAll("li")];
    expect(old).not.toHaveAttribute("data-fresh");
    expect(old?.className).toBe("tape-row");
    expect(fresh).toHaveAttribute("data-fresh", "");
    expect(fresh?.className).toBe("tape-row py-2");
  });

  it("says when its own print-in ends, never when an animation inside it does", () => {
    const onPrinted = vi.fn();
    const { container } = render(
      <Tape>
        <TapeRow verdict="refused" fresh onPrinted={onPrinted}>
          <span data-inner="">new</span>
        </TapeRow>
      </Tape>,
    );
    fireEvent.animationEnd(container.querySelector("[data-inner]")!);
    expect(onPrinted).not.toHaveBeenCalled();
    fireEvent.animationEnd(container.querySelector("li")!);
    expect(onPrinted).toHaveBeenCalledTimes(1);
  });

  it("prints a fresh row in once over 260 ms with clip-path, from nothing to the whole row", () => {
    expect(css).toMatch(/\.tape-row\[data-fresh\]\s*\{\s*animation:\s*print 260ms var\(--ease-instrument\) both;\s*\}/);
    expect(css).toMatch(
      /@keyframes print\s*\{\s*from\s*\{\s*clip-path:\s*inset\(0 0 100% 0\);\s*\}\s*to\s*\{\s*clip-path:\s*inset\(0\);\s*\}\s*\}/,
    );
    expect(css).toMatch(/\.tape\s*\{\s*margin:\s*0;\s*padding:\s*0;\s*list-style:\s*none;\s*\}/);
    expect(css).toMatch(/\.tape-row\[data-verdict="refused"\]\s*\{\s*border-left-color:\s*var\(--color-lamp-refuse\);\s*\}/);
  });
});
