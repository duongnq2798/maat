import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GapIndexPage from "@/app/(site)/gap-index/page";
import { DockedPlate } from "@/components/instrument/DockedPlate";

const classes = (el: Element) => el.getAttribute("class")!.split(" ");

describe("the docked plate, unlit (spec 2026-11-23 section 7.5, amendment A6)", () => {
  it("links /now with an unlit lamp and the words Live on / and /now", () => {
    render(<DockedPlate />);
    const plate = screen.getByRole("link", { name: "Live on / and /now" });
    expect(plate).toHaveAttribute("href", "/now");
    expect(plate).toHaveAttribute("data-docked-plate", "unlit");
    expect(classes(plate)).toEqual(expect.arrayContaining(["inline-flex", "min-h-11", "text-label"]));
    const lamp = plate.querySelector("[data-lamp]")!;
    expect(lamp).toHaveAttribute("data-lamp", "reading");
    expect(lamp.textContent).toBe("");
  });

  it("takes the display classes it is given in place of inline-flex", () => {
    render(<DockedPlate className="mr-2 hidden md:inline-flex" />);
    const c = classes(screen.getByRole("link", { name: "Live on / and /now" }));
    expect(c).toEqual(expect.arrayContaining(["mr-2", "hidden", "md:inline-flex"]));
    expect(c).not.toContain("inline-flex");
  });

  it("sits in the /gap-index Header before the first nav link, unlit, in the static HTML", { timeout: 60_000 }, () => {
    const html = renderToString(<GapIndexPage />);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const nav = doc.querySelector('header nav[aria-label="Main"]')!;
    const plate = nav.querySelector("[data-docked-plate]")!;
    expect(plate.getAttribute("href")).toBe("/now");
    expect(plate.nextElementSibling?.getAttribute("href")).toBe("/#how");
    expect(html.match(/data-docked-plate=/g)).toHaveLength(1);
    expect(html).not.toMatch(/data-lamp="(pass|refuse)"/);
    expect(html).not.toContain("data-live-strip");
  });
});
