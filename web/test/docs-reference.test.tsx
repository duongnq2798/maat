import { act, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventSignature } from "@/components/docs/content";
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
import { FACTS } from "@/content/facts";
import { headingIds } from "@/lib/docs/content-checks";
import { docsData } from "@/lib/docs/generated";
import { headingId } from "@/lib/docs/links";
import { findContract } from "@/lib/docs/signatures";

/** A docs page's MDX, read relative to web/ as the build reads it (the helpers' file URLs do not resolve under jsdom). */
const page = (slug: string) => readFileSync(join("content/docs", `${slug}.mdx`), "utf8").replace(/\r\n/g, "\n");

/** The groups of the page's <FunctionIndex contract="MandateVault" groups={...} />, as written: JSON once trailing commas go. */
function indexGroups(source: string): [string, string[]][] {
  const literal = /<FunctionIndex\s+contract="MandateVault"\s+groups=\{([\s\S]*?)\}\s*\/>/.exec(source)?.[1];
  if (literal === undefined) throw new Error('mandate-vault.mdx has no <FunctionIndex contract="MandateVault" groups={...} />');
  return JSON.parse(literal.replace(/,(\s*\])/g, "$1")) as [string, string[]][];
}

/** Each H2 of the page with the H3 entries under it, up to the constructor, which is not a function. */
function sections(source: string): [string, string[]][] {
  const out: [string, string[]][] = [];
  for (const line of source.split("\n")) {
    const h2 = /^## (.+)$/.exec(line)?.[1];
    if (h2 === "Constructor") break;
    if (h2 !== undefined) out.push([h2, []]);
    const h3 = /^### (.+)$/.exec(line)?.[1];
    if (h3 !== undefined) out.at(-1)?.[1].push(h3);
  }
  return out;
}

describe("contract entries", () => {
  it("Fn shows the signature, who may call it and whether it changes state", () => {
    const { container } = render(<Fn contract="MandateVault" name="queueMandate" />);
    expect(container.querySelector("pre")).toHaveTextContent(/^function queueMandate\(Mandate m\) external returns \(bytes32 changeHash\)$/);
    expect(screen.getByText("Owner only")).toBeInTheDocument();
    expect(screen.getByText("Changes state")).toBeInTheDocument();
  });

  it("Fn marks public state variables", () => {
    render(<Fn contract="MandateVault" name="spentOnDay" />);
    expect(screen.getByText("function spentOnDay(uint256 utcDay) public view returns (uint256)")).toBeInTheDocument();
    expect(screen.getByText("Public state")).toBeInTheDocument();
    expect(screen.getByText("Read only")).toBeInTheDocument();
  });

  it("Fn shows what a getter of a struct really returns: its members", () => {
    render(<Fn contract="MandateVault" name="tokenConfig" />);
    expect(
      screen.getByText("function tokenConfig(address) public view returns (bool allowed, address feed, address pool, uint16 maxWeightBps)"),
    ).toBeInTheDocument();
  });

  it("Fn and ErrorEntry give the selector, and EventEntry the topic 0, that docs:gen hashed from the canonical signature", () => {
    render(
      <>
        <Fn contract="MandateVault" name="execute" />
        <ErrorEntry contract="MandateVault" name="NotExecutor" />
        <EventEntry contract="MandateVault" name="Decision" />
      </>,
    );
    expect(screen.getByText("0x4ad3993f").closest("p")).toHaveTextContent(/^Selector: 0x4ad3993f$/);
    expect(screen.getByText("0xc32d1d76").closest("p")).toHaveTextContent(/^Selector: 0xc32d1d76$/);
    const topic0 = "0x31e6f801fe8c4e61fff662a75a05831c8f1341359c56a18463b2a33bfa2df322";
    expect(screen.getByText(topic0).closest("p")).toHaveTextContent(new RegExp(`^Topic 0: ${topic0}$`));
  });

  it("labels a NatSpec comment as the source's, so it does not read as the docs' own words", () => {
    const vault = findContract(docsData.surface, "MandateVault");
    const preview = vault.functions.find((f) => f.name === "previewIntent")!.notice;
    const health = findContract(docsData.surface, "ICreditAdapter").errors.find((e) => e.name === "HealthFactorTooLow")!.notice;
    const intent = docsData.surface.structs.find((s) => s.name === "Intent")!.notice;
    expect([preview, health, intent].every(Boolean)).toBe(true);
    render(
      <>
        <Fn contract="MandateVault" name="previewIntent" />
        <ErrorEntry contract="ICreditAdapter" name="HealthFactorTooLow" />
        <TypeEntry name="Intent" />
      </>,
    );
    expect(screen.getAllByText("Source comment:").map((label) => label.closest("p")?.textContent)).toEqual([
      `Source comment: ${preview}`,
      `Source comment: ${health}`,
      `Source comment: ${intent}`,
    ]);
  });

  it("gives an entry with no NatSpec comment no label", () => {
    render(<Fn contract="MandateVault" name="execute" />);
    expect(screen.queryByText("Source comment:")).toBeNull();
  });

  it("links each struct and enum in a signature to its entry on the Types page, and the text stays the signature", () => {
    const { container } = render(
      <>
        <Fn contract="MandateVault" name="execute" />
        <EventEntry contract="MandateVault" name="Decision" />
      </>,
    );
    const [fn, event] = [...container.querySelectorAll("pre")];
    expect(fn).toHaveTextContent(/^function execute\(Intent intent\) external returns \(bool allowed, Reason reason\)$/);
    expect(within(fn!).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Intent", "/docs/reference/types#intent"],
      ["Reason", "/docs/reference/types#reason"],
    ]);
    expect(within(event!).getAllByRole("link").map((a) => a.textContent)).toEqual(["Action", "Reason"]);
    const types = headingIds(page("reference/types"));
    for (const t of [...docsData.surface.structs, ...docsData.surface.enums]) expect(types, t.name).toContain(headingId(t.name));
  });

  it("an unknown name throws, so a typo in a page fails the build", () => {
    expect(() => Fn({ contract: "MandateVault", name: "rugPull" })).toThrow("MandateVault has no function named rugPull");
    expect(() => TypeEntry({ name: "Order" })).toThrow("type Order is not in content/generated/contracts.json");
    expect(() => EnvVar({ name: "MAAT_NOPE" })).toThrow("MAAT_NOPE is not in agent/.env.example");
    expect(() => ScriptEntry({ name: "deploy" })).toThrow("npm run deploy is not in agent/package.json");
    expect(() => ScriptFile({ name: "nope.ts" })).toThrow("agent/scripts/nope.ts does not exist");
  });

  it("EventEntry lists the parameters and which are indexed", () => {
    render(<EventEntry contract="MandateVault" name="Decision" />);
    const table = screen.getByRole("region", { name: "Decision parameters (MandateVault)" });
    const intent = within(table).getByText("intentId").closest("tr");
    expect(intent).not.toBeNull();
    expect(within(intent as HTMLElement).getByText("Yes")).toBeInTheDocument();
    expect(within(table).getAllByRole("row")).toHaveLength(1 + 7);
  });

  it("names a parameter table after its contract, because several contracts share event and error names", () => {
    const { unmount } = render(<ErrorEntry contract="AaveV4CreditAdapter" name="TransferFailed" />);
    expect(screen.getByRole("region", { name: "TransferFailed parameters (AaveV4CreditAdapter)" })).toBeInTheDocument();
    unmount();
    render(
      <>
        <EventEntry contract="IMandateVaultEvents" name="Decision" />
        <EventEntry contract="MandateVault" name="Decision" />
      </>,
    );
    expect(screen.getByRole("region", { name: "Decision parameters (IMandateVaultEvents)" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Decision parameters (MandateVault)" })).toBeInTheDocument();
  });

  it("ErrorEntry shows the signature", () => {
    render(<ErrorEntry contract="MandateVault" name="ChangeNotReady" />);
    expect(screen.getByText("error ChangeNotReady(bytes32 changeHash, uint256 eta)")).toBeInTheDocument();
  });

  it("TypeEntry numbers enum members from 0 and lists struct fields", () => {
    const { unmount } = render(<TypeEntry name="Reason" />);
    const rows = within(screen.getByRole("region", { name: "Reason members" })).getAllByRole("row");
    expect(rows).toHaveLength(1 + FACTS.refusalCount.value + 1);
    expect(rows[1]).toHaveTextContent("0OK");
    unmount();
    render(<TypeEntry name="Mandate" />);
    expect(within(screen.getByRole("region", { name: "Mandate fields" })).getByText("maxPremiumBps")).toBeInTheDocument();
  });

  it("FunctionIndex links each function to the id Fumadocs gives its heading", () => {
    const { unmount } = render(<FunctionIndex contract="MandateVault" />);
    expect(screen.getByRole("link", { name: "queueMandate" })).toHaveAttribute("href", "#queuemandate");
    expect(screen.getByRole("link", { name: "GRACE_PERIOD" })).toHaveAttribute("href", "#grace_period");
    unmount();
    render(<FunctionIndex contract="AaveV4CreditAdapter" qualify />);
    expect(screen.getByRole("link", { name: "withdraw" })).toHaveAttribute("href", "#withdraw-aavev4creditadapter");
  });

  it("FunctionIndex describes a getter with the same words as Fn", () => {
    render(<FunctionIndex contract="MandateVault" />);
    const region = screen.getByRole("region", { name: "MandateVault functions" });
    const row = (name: string) => within(region).getByRole("link", { name }).closest("tr") as HTMLElement;
    expect(within(row("GRACE_PERIOD")).getByText("Read only, Public state")).toBeInTheDocument();
    expect(within(row("queueMandate")).getByText("Changes state")).toBeInTheDocument();
  });

  it("the MandateVault index has one group per section of the page, listing that section's entries in their order", () => {
    const source = page("reference/mandate-vault");
    expect(indexGroups(source)).toEqual(sections(source));
    expect(indexGroups(source).map(([name]) => name)).toEqual(["Executor only", "Anyone", "Owner, instant", "Owner, timelocked", "Views", "Public state"]);
  });

  it("a grouped FunctionIndex lists each function once under its group, whose name links to its section", () => {
    const groups = indexGroups(page("reference/mandate-vault"));
    render(<FunctionIndex contract="MandateVault" groups={groups} />);
    const region = screen.getByRole("region", { name: "MandateVault functions" });
    expect(within(region).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Function", "Kind"]);
    const heads = [...region.querySelectorAll('th[scope="rowgroup"]')];
    expect(heads.map((th) => [th.textContent, th.querySelector("a")?.getAttribute("href")])).toEqual(
      groups.map(([name]) => [name, `#${headingId(name)}`]),
    );
    const listed = [...region.querySelectorAll("td a")].map((a) => a.textContent);
    const all = findContract(docsData.surface, "MandateVault").functions.map((f) => f.name);
    expect(all).toHaveLength(39);
    expect(listed).toEqual(groups.flatMap(([, names]) => names));
    expect([...listed].sort()).toEqual([...all].sort());
    // The group says who may call and what is public state, so a row says only whether it changes state.
    const row = (name: string) => [...within(region).getByRole("link", { name }).closest("tr")!.querySelectorAll("td")].map((td) => td.textContent);
    expect(row("execute")).toEqual(["execute", "Changes state"]);
    expect(row("GRACE_PERIOD")).toEqual(["GRACE_PERIOD", "Read only"]);
  });

  it("a grouped FunctionIndex fails on a function it leaves out, lists twice or the contract does not have", () => {
    const groups = indexGroups(page("reference/mandate-vault"));
    const edit = (f: (names: string[], group: string) => string[]) => groups.map(([g, names]): [string, string[]] => [g, f(names, g)]);
    expect(() => FunctionIndex({ contract: "MandateVault", groups: edit((n) => n.filter((x) => x !== "fund")) })).toThrow(
      "<FunctionIndex contract=\"MandateVault\" /> groups leave out fund",
    );
    expect(() => FunctionIndex({ contract: "MandateVault", groups: edit((n, g) => (g === "Views" ? [...n, "fund"] : n)) })).toThrow(
      "<FunctionIndex contract=\"MandateVault\" /> groups list fund more than once",
    );
    expect(() => FunctionIndex({ contract: "MandateVault", groups: edit((n, g) => (g === "Views" ? [...n, "rugPull"] : n)) })).toThrow(
      "MandateVault has no function named rugPull",
    );
  });

  it.each([
    ["reference/market-calendar", "MarketCalendar"],
    ["reference/adapters", "ISwapAdapter"],
    ["reference/adapters", "AerodromeSwapAdapter"],
    ["reference/adapters", "ICreditAdapter"],
    ["reference/adapters", "AaveV4CreditAdapter"],
  ])("%s lists every %s function once in its index", (slug, contract) => {
    const qualify = new RegExp(`<FunctionIndex contract="${contract}" qualify />`).test(page(slug));
    expect(page(slug)).toMatch(new RegExp(`<FunctionIndex contract="${contract}"( qualify)? />`));
    render(<FunctionIndex contract={contract} qualify={qualify} />);
    const listed = [...screen.getByRole("region", { name: `${contract} functions` }).querySelectorAll("td a")].map((a) => a.textContent);
    expect([...listed].sort()).toEqual(findContract(docsData.surface, contract).functions.map((f) => f.name).sort());
  });

  it("headingId follows the slug rules for the headings the reference uses", () => {
    expect(headingId("queueMandate")).toBe("queuemandate");
    expect(headingId("ZeroAddress (MandateVault)")).toBe("zeroaddress-mandatevault");
    expect(headingId("MAAT_MODE")).toBe("maat_mode");
  });
});

describe("agent, address and fact entries", () => {
  it("EnvTable has one row per setting, linked to its entry", () => {
    render(<EnvTable />);
    const rows = within(screen.getByRole("region", { name: "Agent settings" })).getAllByRole("row");
    expect(rows).toHaveLength(1 + docsData.agent.env.length);
    expect(screen.getByRole("link", { name: "MAAT_MODE" })).toHaveAttribute("href", "#maat_mode");
  });

  it("EnvVar shows the default and the .env.example value", () => {
    render(<EnvVar name="MAAT_MODE" />);
    expect(screen.getAllByText("dry-run")).toHaveLength(2);
    expect(screen.getByText("agent/src/config.ts")).toBeInTheDocument();
  });

  it("a setting that is required only in live mode says so, in the table and in its entry", () => {
    const { unmount } = render(<EnvTable />);
    const row = screen.getByRole("link", { name: "MAAT_BUILDER_CODE" }).closest("tr") as HTMLElement;
    expect(within(row).getByText("In live mode")).toBeInTheDocument();
    expect(within(row).queryByText("No")).toBeNull();
    const vault = screen.getByRole("link", { name: "MAAT_VAULT" }).closest("tr") as HTMLElement;
    expect(within(vault).getByText("Yes")).toBeInTheDocument();
    unmount();
    render(<EnvVar name="MAAT_BUILDER_CODE" />);
    expect(screen.getByText("In live mode")).toBeInTheDocument();
    expect(screen.queryByText("No")).toBeNull();
  });

  it("ScriptEntry and ScriptFile name what runs", () => {
    render(
      <>
        <ScriptEntry name="agent" />
        <ScriptFile name="cdp-setup.ts" />
      </>,
    );
    expect(screen.getByText("npm run agent")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "agent/scripts/cdp-setup.ts" })).toHaveAttribute(
      "href",
      "https://github.com/duongnq2798/maat/blob/main/agent/scripts/cdp-setup.ts",
    );
  });

  it("AddressTable links every address to Basescan", () => {
    render(<AddressTable />);
    const rows = within(screen.getByRole("region", { name: "Base addresses" })).getAllByRole("row");
    const groups = new Set(docsData.addresses.map((a) => a.group).filter(Boolean));
    expect(rows).toHaveLength(1 + groups.size + docsData.addresses.length);
    const addresses = docsData.addresses.filter((a) => a.type === "address");
    expect(screen.getAllByRole("link")).toHaveLength(addresses.length);
    expect(screen.getByRole("link", { name: addresses[0]?.value })).toHaveAttribute(
      "href",
      `https://basescan.org/address/${addresses[0]?.value}`,
    );
  });

  it("AddressTable shows each group comment once, heading its own row group, and no row repeats it", () => {
    const { container } = render(<AddressTable />);
    const groups = [...new Set(docsData.addresses.map((a) => a.group).filter(Boolean))];
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      const heads = screen.getAllByText(g);
      expect(heads).toHaveLength(1);
      expect(heads[0]).toHaveAttribute("scope", "rowgroup");
      const members = docsData.addresses.filter((a) => a.group === g).map((a) => a.name);
      const inGroup = [...heads[0]!.closest("tbody")!.querySelectorAll("td:first-child")].map((td) => td.textContent);
      expect(inGroup).toEqual(members);
    }
    const notes = [...container.querySelectorAll("tbody td:nth-child(3)")].map((td) => td.textContent).filter(Boolean);
    expect(notes).toEqual(docsData.addresses.map((a) => a.note).filter(Boolean));
  });

  it("FactTable shows a setting's plain name, its name in the code, its value and the file that sets it", () => {
    render(<FactTable names={["timelockHours", "mandate.maxPremiumBps", "earlyClose"]} />);
    const region = screen.getByRole("region", { name: "Defaults" });
    expect(within(region).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Setting", "In code", "Value", "Source file"]);
    const row = (label: string) => [...within(region).getByText(label).closest("tr")!.querySelectorAll("td")].map((td) => td.textContent);
    expect(row("Timelock delay")).toEqual(["Timelock delay", "MandateVault.TIMELOCK", "24 hours", "contracts/src/MandateVault.sol"]);
    expect(row("Premium limit")).toEqual(["Premium limit", "Mandate.maxPremiumBps in defaultMandate", "100 bps", "contracts/script/MaatConfig.sol"]);
    expect(row("Close on a shipped early-close day")).toEqual([
      "Close on a shipped early-close day",
      "literal 780 in constructor",
      "13:00 ET",
      "contracts/src/MarketCalendar.sol",
    ]);
    expect(() => FactTable({ names: ["nope" as never] })).toThrow('<Fact name="nope" /> is not in FACT_TEXT');
  });

  it("FactTable shows a figure with the source that proves it, and a caption below the table", () => {
    render(<FactTable names={["forkBlock"]} label="Figures" caption="Measured on a fork." />);
    const region = screen.getByRole("region", { name: "Figures" });
    expect(within(region).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Figure", "Value", "Source"]);
    expect(within(region).getByText(FACTS.forkBlock.source)).toBeInTheDocument();
    expect(region.closest("figure")?.querySelector("figcaption")).toHaveTextContent("Measured on a fork.");
  });

  it("FactTable refuses a table that mixes settings and figures", () => {
    expect(() => FactTable({ names: ["timelockHours", "forkBlock"] })).toThrow("<FactTable /> mixes settings and figures");
  });

  it("FactTable names its region with the label it is given, and says Defaults without one", () => {
    const { unmount } = render(<FactTable names={["timelockHours"]} label="Measured and planned figures" />);
    expect(screen.getByRole("region", { name: "Measured and planned figures" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Defaults" })).toBeNull();
    unmount();
    render(<FactTable names={["timelockHours"]} />);
    expect(screen.getByRole("region", { name: "Defaults" })).toBeInTheDocument();
  });
});

describe("tab stops", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** jsdom lays nothing out: every box is 400 px wide, its content as wide as `resize` says, and a resize is observed. */
  function layout(width: number) {
    let content = width;
    vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(400);
    vi.spyOn(Element.prototype, "scrollWidth", "get").mockImplementation(() => content);
    const callbacks: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          callbacks.push(callback);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    return (next: number) =>
      act(() => {
        content = next;
        for (const callback of callbacks) callback([], {} as ResizeObserver);
      });
  }

  const isStop = (el: Element | null | undefined, name: string) => {
    expect(el).toHaveAttribute("tabindex", "0");
    expect(el).toHaveAttribute("role", "region");
    expect(el).toHaveAccessibleName(name);
    expect(el).toHaveAttribute("data-overflow", "scrolls");
  };
  const isPlain = (el: Element | null | undefined) => {
    for (const attribute of ["tabindex", "role", "aria-label"]) expect(el).not.toHaveAttribute(attribute);
    expect(el).toHaveAttribute("data-overflow", "fits");
  };

  it("a signature is a named, focusable region while it is wider than its box, and a plain block once it fits", () => {
    const resize = layout(600);
    const { container } = render(<Fn contract="MandateVault" name="execute" />);
    const pre = container.querySelector("pre");
    isStop(pre, "execute signature (MandateVault)");
    resize(300);
    isPlain(pre);
    resize(600);
    isStop(pre, "execute signature (MandateVault)");
  });

  it("so is a table, an event or error signature, a script's command and the Decision declaration", () => {
    const resize = layout(600);
    const { container } = render(
      <>
        <FunctionIndex contract="MarketCalendar" />
        <EventEntry contract="MandateVault" name="ChangeCancelled" />
        <ErrorEntry contract="MandateVault" name="ChangeExpired" />
        <ScriptEntry name="agent" />
        <EventSignature name="Decision" />
      </>,
    );
    const blocks = [...container.querySelectorAll("[data-overflow]")];
    expect(container.querySelectorAll("pre:not([data-overflow])")).toHaveLength(0);
    const names = [
      "MarketCalendar functions",
      "ChangeCancelled signature (MandateVault)",
      "ChangeCancelled parameters (MandateVault)",
      "ChangeExpired signature (MandateVault)",
      "ChangeExpired parameters (MandateVault)",
      "npm run agent",
      "Decision event declaration",
    ];
    expect(blocks).toHaveLength(names.length);
    blocks.forEach((el, i) => isStop(el, names[i]!));
    resize(300);
    for (const el of blocks) isPlain(el);
  });

  it("before the page can measure a block, as in the exported HTML, the block stays a tab stop", () => {
    // jsdom has no ResizeObserver, like a browser that cannot run the page's script.
    const { container } = render(<Fn contract="MandateVault" name="execute" />);
    const pre = container.querySelector("pre");
    expect(pre).toHaveAttribute("tabindex", "0");
    expect(pre).toHaveAttribute("role", "region");
    expect(pre).toHaveAttribute("data-overflow", "unmeasured");
  });
});
