// @vitest-environment node
import { describe, expect, it } from "vitest";
import { docsFrontmatter, STATUS_LABEL } from "@/lib/docs/frontmatter";

const GOOD = {
  title: "The nine checks",
  description: "The ordered checks the vault runs on every proposed trade.",
  type: "concept",
  audience: ["newcomer"],
  status: "fork-tested",
  lastReviewed: "2026-11-07",
};

describe("docsFrontmatter", () => {
  it("accepts a page and fills the defaults", () => {
    expect(docsFrontmatter.parse(GOOD)).toMatchObject({ sources: [], next: [] });
    expect(docsFrontmatter.parse({ ...GOOD, next: ["concepts/nine-checks"] }).next).toEqual(["concepts/nine-checks"]);
  });

  it.each([
    ["an unknown type", { type: "tutorial" }],
    ["no audience", { audience: [] }],
    ["an unknown status", { status: "beta" }],
    ["a date that is not ISO", { lastReviewed: "7 Nov 2026" }],
    ["an empty next", { next: [] }],
    ["four next pages", { next: ["a", "b", "c", "d"] }],
    ["a next URL instead of a slug", { next: ["/docs/concepts/nine-checks"] }],
  ])("rejects %s", (_name, patch) => {
    expect(docsFrontmatter.safeParse({ ...GOOD, ...patch }).success).toBe(false);
  });

  it("labels every status", () => {
    expect(STATUS_LABEL["fork-tested"]).toBe("Fork-tested");
    expect(STATUS_LABEL.live).toBe("Live on mainnet");
  });
});
