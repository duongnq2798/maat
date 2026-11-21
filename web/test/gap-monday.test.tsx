// What a data-only rerun after Monday's last window ends commits: edition-0.json with every pending window measured.
// The synthetic copy is built from the committed file, never written to disk, and the page, the file checks and the
// export check all run on it, so that PR cannot fail on a test that pinned the pending state.
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Page from "@/app/(site)/gap-index/page";
import { PUBLISHED } from "@/content/gap-index";
import { checkGapIndexPage } from "@/lib/check-out";
import type { EditionFile } from "@/lib/gap/schema";
import { SITE } from "@/lib/site";
import { editionFileChecks, withPendingWindowsMeasured } from "./helpers/gap-edition";

vi.mock("@/content/gap-index/edition-0.json", async (importActual) => {
  const real = await importActual<{ default: EditionFile }>();
  const { withPendingWindowsMeasured: measured } = await import("./helpers/gap-edition");
  return { default: measured(real.default) };
});

describe("the committed edition with every pending window measured", () => {
  it("has no pending window left, so the tests below do run on the synthetic copy", () => {
    const windows = PUBLISHED.flatMap((e) => e.windows);
    expect(windows.length).toBeGreaterThan(0);
    expect(windows.filter((w) => w.status === "pending")).toEqual([]);
  });

  it("leaves a file with nothing pending as it is", () => {
    const real = PUBLISHED[0]!;
    expect(withPendingWindowsMeasured(real)).toBe(real);
  });

  it("passes the export check", () => {
    const html = [
      `<!DOCTYPE html><html lang="en"><head><title>Weekend Gap Index · ${SITE.name}</title>`,
      '<link rel="canonical" href="https://maat.example/gap-index"/></head><body>',
      renderToString(<Page />),
      "</body></html>",
    ].join("");
    expect(checkGapIndexPage(html)).toEqual([]);
  });
});

// The same checks as the committed files get.
editionFileChecks("edition-0.json", PUBLISHED[0]);

// And every test of the page, run again against the synthetic copy.
await import("./gap-page.test");
