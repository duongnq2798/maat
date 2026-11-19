import { describe, expect, it } from "vitest";

// Fails on purpose, to prove that a failing web unit test turns the web job and the summary gate red.
// It lives only on the throwaway branch chore/ci-red-proof, which is never merged
// (docs/superpowers/specs/2026-11-18-maat-ci-design.md, section 8 step 5).
describe("red proof", () => {
  it("fails on purpose", () => {
    expect(1 + 1, "red proof: fails on purpose").toBe(3);
  });
});
