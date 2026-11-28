import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Page from "@/app/(site)/page";
import { AgentBuilders } from "@/components/sections/AgentBuilders";
import { USAGE } from "../../skills/maat-market-guard/scripts/check.mjs";
import { SITE } from "@/lib/site";

// The landing's "For agent builders" section points other agents at the market-guard skill: /skill.md, the typed
// reasons on this page and the skill's folder on GitHub. Its two commands are the skill's own.

describe("the For agent builders section", () => {
  // Spec 2026-11-27, landing "explain in 10 seconds", section 3: the builder section moves up from the end of the page
  // to right after How it works, before the simulator.
  it("follows How it works in the landing's main, before the simulator", () => {
    const main = render(<Page />).container.querySelector("main")!;
    const agents = main.querySelector(":scope > #agents")!;
    expect(agents.previousElementSibling?.id).toBe("how");
    expect(agents.nextElementSibling?.id).toBe("try");
  });

  it("points its link to the refusals the way they lie on the page: down, since they follow this section", () => {
    const main = render(<Page />).container.querySelector("main")!;
    const agents = main.querySelector(":scope > #agents")!;
    const reasons = main.querySelector(":scope > #reasons")!;
    expect(agents.compareDocumentPosition(reasons) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const link = within(agents as HTMLElement).getByRole("link", { name: /See the nineteen refusals/ });
    expect(link.querySelector('[aria-hidden="true"]')?.textContent).toBe(" ↓");
  });

  it("names the skill, says it is read-only, and links /skill.md, the reasons and the source", () => {
    const section = render(<AgentBuilders />).container.querySelector("#agents") as HTMLElement;
    expect(within(section).getByRole("heading", { level: 2 })).toHaveTextContent("Ask the vault before you trade.");
    expect(section).toHaveTextContent("For agent builders");
    expect(section).toHaveTextContent("maat-market-guard");
    expect(section).toHaveTextContent("No key, no wallet, no transaction");
    expect(section).toHaveTextContent("OK or one of nineteen typed refusals");
    expect(within(section).getByRole("link", { name: /Read \/skill\.md/ })).toHaveAttribute("href", "/skill.md");
    expect(within(section).getByRole("link", { name: /See the nineteen refusals/ })).toHaveAttribute("href", "#reasons");
    expect(within(section).getByRole("link", { name: /The skill on GitHub/ })).toHaveAttribute(
      "href",
      `${SITE.repoUrl}/tree/main/skills/maat-market-guard`,
    );
  });

  it("shows the two checks with commands the skill's usage gives", () => {
    const section = render(<AgentBuilders />).container.querySelector("#agents") as HTMLElement;
    const commands = [...section.querySelectorAll("code")].map((c) => c.textContent ?? "");
    expect(commands).toEqual(["node scripts/check.mjs market", "node scripts/check.mjs preview --action BUY --token NVDAc --amount 5"]);
    expect(USAGE).toContain("node scripts/check.mjs market");
    expect(USAGE).toContain("node scripts/check.mjs preview --action");
    expect(section.querySelectorAll("li.card")).toHaveLength(2);
  });
});
