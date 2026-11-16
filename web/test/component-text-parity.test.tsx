import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EventSignature, ForkLedger, MandateTable, ReasonTable, RouterCards } from "@/components/docs/content";
import { Architecture, DecisionLoop, MarketWeek, TimelockFlow, TreasuryLoop } from "@/components/docs/diagrams";
import {
  AddressTable,
  EnvTable,
  EnvVar,
  ErrorEntry,
  EventEntry,
  FactTable,
  Fn,
  FunctionIndex,
  ScriptEntry,
  ScriptFile,
  TypeEntry,
} from "@/components/docs/reference";
import { StatusBadge } from "@/components/docs/StatusBadge";
import { componentText, type Props, type TextContext } from "@/lib/docs/component-text";
import type { DataComponent } from "@/lib/docs/data-components";

// The Markdown copies print the same data as the components. These tests render a component and read its text
// back out of the HTML, so a column, a caption or a label that changes in one place and not the other fails here.

const ALL: TextContext = { exists: () => true };
const md = (name: DataComponent, props: Props = {}, ctx: TextContext = ALL) => componentText(name, props, ctx);

/** What a reader sees: Markdown links and code marks removed, a pipe unescaped. */
const plain = (s: string) => s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/`/g, "").replace(/\\\|/g, "|").trim();

/** The rows of a pipe table in a Markdown text, header first, as plain cell text. */
function mdRows(text: string): string[][] {
  return text
    .split("\n")
    .filter((l) => l.startsWith("| ") && !/^\| (---( \| ---)*) \|$/.test(l))
    .map((l) => l.slice(2, -2).split(/(?<!\\) \| /).map(plain));
}

/** The rows of the first table in the rendered HTML, header first. */
function domRows(container: HTMLElement): string[][] {
  return [...container.querySelectorAll("tr")].map((tr) => [...tr.querySelectorAll("th, td")].map((c) => c.textContent!.trim()));
}

/** The text after the last blank line: where the Markdown copies put a caption. */
const lastBlock = (text: string) => text.split("\n\n").at(-1)!;

describe("tables", () => {
  const cases: [string, DataComponent, Props, React.ReactElement][] = [
    ["FunctionIndex", "FunctionIndex", { contract: "MarketCalendar", qualify: true }, <FunctionIndex contract="MarketCalendar" qualify />],
    ["FunctionIndex of the vault", "FunctionIndex", { contract: "MandateVault" }, <FunctionIndex contract="MandateVault" />],
    ["EnvTable", "EnvTable", {}, <EnvTable />],
    ["AddressTable", "AddressTable", {}, <AddressTable />],
    ["FactTable of settings", "FactTable", { names: ["nyseOpen", "mandate.sessionMode", "maxTokenDecimals"] }, <FactTable names={["nyseOpen", "mandate.sessionMode", "maxTokenDecimals"]} />],
    ["FactTable of figures", "FactTable", { names: ["checksPerTrade", "forkBlock"] }, <FactTable names={["checksPerTrade", "forkBlock"]} />],
    ["ReasonTable", "ReasonTable", {}, <ReasonTable />],
    ["MandateTable", "MandateTable", {}, <MandateTable />],
    ["ForkLedger", "ForkLedger", {}, <ForkLedger />],
    ["a TypeEntry enum", "TypeEntry", { name: "Action" }, <TypeEntry name="Action" />],
    ["a TypeEntry struct", "TypeEntry", { name: "Mandate" }, <TypeEntry name="Mandate" />],
    ["the parameters of an EventEntry", "EventEntry", { contract: "MandateVault", name: "Decision" }, <EventEntry contract="MandateVault" name="Decision" />],
    ["the parameters of an ErrorEntry", "ErrorEntry", { contract: "MandateVault", name: "ChangeExpired" }, <ErrorEntry contract="MandateVault" name="ChangeExpired" />],
  ];

  it.each(cases)("%s has the columns and the cells of the rendered table", (_label, name, props, element) => {
    const { container } = render(element);
    expect(mdRows(md(name, props))).toEqual(domRows(container));
  });

  it.each([
    ["AddressTable", "AddressTable", <AddressTable />],
    ["ReasonTable", "ReasonTable", <ReasonTable />],
  ] as const)("%s links the same targets as the rendered table, cell for cell", (_label, name, element) => {
    const { container } = render(element);
    const targets = [...container.querySelectorAll("tbody td, tbody th")].map((td) => td.querySelector("a")?.getAttribute("href") ?? "");
    const marked = md(name)
      .split("\n")
      .slice(2)
      .flatMap((row) => row.slice(2, -2).split(/(?<!\\) \| /))
      .map((cell) => /\]\(([^)]*)\)/.exec(cell)?.[1] ?? "");
    expect(marked).toEqual(targets);
    expect(targets.filter(Boolean).length).toBeGreaterThan(0);
  });

  it.each([
    ["MandateTable", "MandateTable", <MandateTable />],
    ["ForkLedger", "ForkLedger", <ForkLedger />],
  ] as const)("%s ends with the caption of the rendered figure", (_label, name, element) => {
    const { container } = render(element);
    expect(lastBlock(md(name))).toBe(container.querySelector("figcaption")!.textContent);
  });

  it("FactTable ends with the caption of the rendered figure", () => {
    const names = ["timelockHours"] as const;
    const { container } = render(<FactTable names={names} caption="Set in the vault." />);
    expect(lastBlock(md("FactTable", { names, caption: "Set in the vault." }))).toBe(container.querySelector("figcaption")!.textContent);
  });
});

describe("reference entries", () => {
  it("Fn has the signature, the chips and the notice of the rendered entry", () => {
    for (const name of ["execute", "fund", "executor"]) {
      const { container, unmount } = render(<Fn contract="MandateVault" name={name} />);
      const chips = [...container.querySelectorAll("span")].map((s) => s.textContent);
      const [access, ...kind] = chips as string[];
      const notice = container.querySelector("p")?.textContent;
      const text = md("Fn", { contract: "MandateVault", name });
      expect(text).toContain(`\`\`\`solidity\n${container.querySelector("pre")!.textContent}\n\`\`\``);
      expect(text).toContain(`Who may call: ${access}. Kind: ${kind.join(", ")}.`);
      if (notice) expect(text.endsWith(`\n\n${notice}`)).toBe(true);
      unmount();
    }
  });

  it("EventEntry and ErrorEntry have the signature of the rendered entry", () => {
    const event = render(<EventEntry contract="MandateVault" name="Decision" />).container;
    expect(md("EventEntry", { contract: "MandateVault", name: "Decision" })).toContain(`\`\`\`solidity\n${event.querySelector("pre")!.textContent}\n\`\`\``);
    const error = render(<ErrorEntry contract="MandateVault" name="ChangeExpired" />).container;
    expect(md("ErrorEntry", { contract: "MandateVault", name: "ChangeExpired" })).toContain(`\`\`\`solidity\n${error.querySelector("pre")!.textContent}\n\`\`\``);
  });

  it.each(["BASE_RPC_URL", "MAAT_VAULT", "ANTHROPIC_API_KEY"])("EnvVar %s has the fields of the rendered entry", (name) => {
    const { container } = render(<EnvVar name={name} />);
    const fields = [...container.querySelectorAll("dt")].map((dt) => `- ${dt.textContent}: ${dt.nextElementSibling!.textContent}`);
    const note = container.querySelector("p")?.textContent;
    expect(md("EnvVar", { name }).replace(/`/g, "")).toBe([fields.join("\n"), note].filter(Boolean).join("\n\n"));
  });

  it("ScriptEntry and ScriptFile have the command, the line below it and the link of the rendered entry", () => {
    const entry = render(<ScriptEntry name="gen:abi" />).container;
    const text = md("ScriptEntry", { name: "gen:abi" });
    expect(text).toContain(`\`\`\`bash\n${entry.querySelector("pre")!.textContent}\n\`\`\``);
    expect(plain(text.split("\n\n").at(-1)!)).toBe(entry.querySelector("p")!.textContent);
    const file = render(<ScriptFile name="cdp-setup.ts" />).container.querySelector("a")!;
    expect(md("ScriptFile", { name: "cdp-setup.ts" })).toBe(`[\`${file.textContent}\`](${file.getAttribute("href")})`);
  });

  it("EventSignature has the source of the rendered block", () => {
    const { container } = render(<EventSignature name="Decision" />);
    expect(md("EventSignature", { name: "Decision" })).toBe(`\`\`\`solidity\n${container.querySelector("pre")!.textContent}\n\`\`\``);
  });

  it("StatusBadge has the label of the rendered badge", () => {
    for (const status of ["fork-tested", "live", "planned"] as const) {
      const { container, unmount } = render(<StatusBadge status={status} />);
      expect(md("StatusBadge", { status })).toBe(container.textContent);
      unmount();
    }
  });
});

describe("router cards", () => {
  const shipped: [string, (slug: string) => boolean][] = [
    ["every page shipped", () => true],
    ["one page not shipped", (slug) => slug !== "security/model"],
  ];

  it.each(shipped)("%s: each card has its reader, its line and its call to action", (_label, exists) => {
    const { container } = render(<RouterCards exists={exists} />);
    const cards = [...container.querySelectorAll("li")].map((li) => {
      const [reader, want, cta] = [...li.querySelectorAll("p, a")].map((e) => e.textContent);
      const href = li.querySelector("a")?.getAttribute("href");
      return `- **${reader}**: ${want} ${href ? `[${cta}](${href})` : cta}`;
    });
    expect(md("RouterCards", {}, { exists })).toBe(cards.join("\n"));
  });
});

describe("diagrams", () => {
  it.each([
    ["DecisionLoop", <DecisionLoop />],
    ["Architecture", <Architecture />],
    ["TimelockFlow", <TimelockFlow />],
    ["TreasuryLoop", <TreasuryLoop />],
  ] as const)("%s has the label, the steps and the caption of the rendered figure", (name, element) => {
    const { container } = render(element);
    const steps = [...container.querySelectorAll("li")].map((li, i) => {
      const [title, detail] = [...li.querySelectorAll("p")].map((p) => p.textContent);
      return `${i + 1}. **${title}**: ${detail}`;
    });
    const label = container.querySelector("ol")!.getAttribute("aria-label");
    const caption = container.querySelector("figcaption")!.textContent;
    expect(md(name)).toBe([`**${label}**`, steps.join("\n"), caption].join("\n\n"));
  });

  it("MarketWeek has the sentences and the caption of the rendered figure", () => {
    const { container } = render(<MarketWeek />);
    const rows = [...container.querySelectorAll("p")].map((p) => `- ${p.textContent}`).join("\n");
    expect(md("MarketWeek").split("\n\n")[0]!.replace(/`/g, "")).toBe(rows);
    expect(lastBlock(md("MarketWeek"))).toBe(container.querySelector("figcaption")!.textContent);
  });
});
