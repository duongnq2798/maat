import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inlineText, parseRule, PROOF_RULE, RULE_SPEC, type RuleBlock } from "@/app/(site)/proof/rule";
import { RuleText } from "@/app/(site)/proof/RuleText";

// jsdom gives import.meta.url no file: scheme, so the repo root comes from the working directory, web/.
const spec = readFileSync(join(process.cwd(), "..", RULE_SPEC), "utf8").split("\r\n").join("\n");

/** The body of the spec's section 5: the lines under its heading, up to the next section. */
function section5(md: string): string {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l === "## 5. The `/proof` counting rule");
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return lines.slice(start + 1, end).join("\n").trim();
}

describe("the counting rule on /proof", () => {
  it("is section 5 of the inbox spec, word for word", () => {
    expect(PROOF_RULE).toBe(section5(spec));
  });

  it("reads as the spec's paragraphs, its table of eight lines and its team list of four", () => {
    const blocks = parseRule(PROOF_RULE);
    expect(blocks.map((b) => b.kind)).toEqual(["p", "p", "table", "p", "list", "p", "p"]);
    const table = blocks.find((b): b is Extract<RuleBlock, { kind: "table" }> => b.kind === "table")!;
    expect(table.head).toEqual(["Line", "Counts"]);
    expect(table.rows.map((r) => r[0])).toEqual([
      "Owner by hand",
      "Agent",
      "Probe",
      "Outside briefs",
      "Brief-driven Decisions",
      "Team briefs",
      "Hidden briefs",
      "Bounty claimants",
    ]);
    const list = blocks.find((b): b is Extract<RuleBlock, { kind: "list" }> => b.kind === "list")!;
    expect(list.items).toHaveLength(4);
  });

  it("renders every word of it, with the code and bold marks turned into elements", () => {
    const { container } = render(<RuleText />);
    const words = (s: string) => s.replace(/\s+/g, " ").trim();
    const shown = words([...container.querySelectorAll("p, li, th, td")].map((e) => e.textContent).join(" "));
    const blocks = parseRule(PROOF_RULE);
    const source = words(
      blocks
        .flatMap((b) => (b.kind === "p" ? [b.text] : b.kind === "list" ? b.items : [...b.head, ...b.rows.flat()]))
        .map(inlineText)
        .join(" "),
    );
    expect(shown).toBe(source);
    expect(container.querySelector("code")?.textContent).toBe("/ask");
    expect([...container.querySelectorAll("strong")].map((e) => e.textContent)).toEqual([
      "Lines kept apart.",
      "Team set (for owner approval).",
      "Verified Account column.",
      "Never a user:",
    ]);
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });
});
