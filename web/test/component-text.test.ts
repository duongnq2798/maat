// @vitest-environment node
import type { Root } from "fumadocs-core/page-tree";
import { describe, expect, it } from "vitest";
import { getDecisions } from "@/content/decisions";
import { FACTS } from "@/content/facts";
import { mandateRows } from "@/content/mandate";
import { REASONS } from "@/content/reasons";
import { COMPONENT_TEXT, componentText, deploymentText, mdTable, type TextContext } from "@/lib/docs/component-text";
import { DATA_COMPONENTS } from "@/lib/docs/data-components";
import { factFor } from "@/lib/docs/fact-text";
import { docsData } from "@/lib/docs/generated";
import { headingId } from "@/lib/docs/links";
import { READER_PATHS } from "@/lib/docs/reader-paths";
import { findContract } from "@/lib/docs/signatures";
import { SITE } from "@/lib/site";

const ALL: TextContext = { exists: () => true };
const text = (name: (typeof DATA_COMPONENTS)[number], props: Parameters<typeof componentText>[1] = {}, ctx = ALL) =>
  componentText(name, props, ctx);
const lines = (s: string) => s.split("\n");

describe("componentText", () => {
  it("has a rendering for every data component and for nothing else", () => {
    expect(Object.keys(COMPONENT_TEXT).sort()).toEqual([...DATA_COMPONENTS].sort());
  });

  it("fails on a missing or non-literal prop, naming the component and the prop", () => {
    expect(() => text("Fn", { contract: "MandateVault" })).toThrow('<Fn /> needs a plain-string "name"');
    expect(() => text("FactTable", { names: "mandate.sessionMode" })).toThrow('<FactTable /> needs a list of strings for "names"');
    expect(() => text("FactTable", { names: [["mandate.sessionMode"]] })).toThrow('<FactTable /> needs a list of strings for "names"');
    expect(() => text("StatusBadge", { status: "nope" })).toThrow('<StatusBadge status="nope" /> is not a status');
  });
});

describe("reference entries", () => {
  it("Fn gives the signature in a solidity fence, who may call it, what it does to state and its selector", () => {
    expect(text("Fn", { contract: "MandateVault", name: "execute" })).toBe(
      [
        "```solidity",
        "function execute(Intent intent) external returns (bool allowed, Reason reason)",
        "```",
        "",
        "Who may call: Executor only. Kind: Changes state.",
        "",
        "Selector: `0x4ad3993f`",
      ].join("\n"),
    );
  });

  it("Fn adds the notice as the source's comment, and says Public state for a getter", () => {
    const vault = findContract(docsData.surface, "MandateVault");
    const withNotice = vault.functions.find((f) => f.notice)!;
    expect(text("Fn", { contract: "MandateVault", name: withNotice.name }).endsWith(`\n\nSource comment: ${withNotice.notice}`)).toBe(true);
    const getter = vault.functions.find((f) => f.kind === "getter" && !f.notice)!;
    expect(text("Fn", { contract: "MandateVault", name: getter.name })).toContain("Kind: Read only, Public state.");
  });

  it("FunctionIndex in groups heads each group with a one-cell row linking its section, and says only what each function does to state", () => {
    const fns = findContract(docsData.surface, "MarketCalendar").functions;
    const reads = fns.filter((f) => f.mutability === "view" || f.mutability === "pure").map((f) => f.name);
    const writes = fns.map((f) => f.name).filter((n) => !reads.includes(n));
    const out = lines(text("FunctionIndex", { contract: "MarketCalendar", qualify: true, groups: [["Writes", writes], ["Reads", reads]] }));
    const first = `[\`${writes[0]}\`](#${headingId(`${writes[0]} (MarketCalendar)`)})`;
    expect(out.slice(0, 4)).toEqual(["| Function | Kind |", "| --- | --- |", "| [Writes](#writes) |", `| ${first} | Changes state |`]);
    expect(out[3 + writes.length]).toBe("| [Reads](#reads) |");
    expect(out).toHaveLength(2 + 2 + fns.length);
    expect(() => text("FunctionIndex", { contract: "MarketCalendar", groups: [["Writes", writes]] })).toThrow(
      `<FunctionIndex contract="MarketCalendar" /> groups leave out ${reads.join(", ")}`,
    );
    expect(() => text("FunctionIndex", { contract: "MarketCalendar", groups: ["Writes", writes] })).toThrow(
      '<FunctionIndex /> needs a list of ["group", ["function", ...]] for "groups"',
    );
  });

  it("Fn fails on a name the contract does not have", () => {
    expect(() => text("Fn", { contract: "MandateVault", name: "nope" })).toThrow("MandateVault has no function named nope");
  });

  it("FunctionIndex tables every function, linking its entry, with who may call it and its kind", () => {
    const fns = findContract(docsData.surface, "MarketCalendar").functions;
    const out = lines(text("FunctionIndex", { contract: "MarketCalendar", qualify: true }));
    expect(out[0]).toBe("| Function | Who may call | Kind |");
    expect(out[1]).toBe("| --- | --- | --- |");
    expect(out).toHaveLength(2 + fns.length);
    const name = fns[0]!.name;
    const row = (anchor: string) => new RegExp(`^\\| \\[\`${name}\`\\]\\(#${anchor}\\) \\| (Anyone|Owner only|Executor only) \\| (Read only|Changes state)`);
    expect(out[2]).toMatch(row(headingId(`${name} (MarketCalendar)`)));
    expect(lines(text("FunctionIndex", { contract: "MarketCalendar" }))[2]).toMatch(row(headingId(name)));
  });

  it("EventEntry gives the signature, its topic 0 and a table of its parameters with which are indexed", () => {
    const { topic0 } = findContract(docsData.surface, "MandateVault").events.find((e) => e.name === "ChangeCancelled")!;
    expect(topic0).toMatch(/^0x[0-9a-f]{64}$/);
    expect(text("EventEntry", { contract: "MandateVault", name: "ChangeCancelled" })).toBe(
      [
        "```solidity",
        "event ChangeCancelled(bytes32 indexed changeHash)",
        "```",
        "",
        `Topic 0: \`${topic0}\``,
        "",
        "| Name | Type | Indexed |",
        "| --- | --- | --- |",
        "| `changeHash` | `bytes32` | Yes |",
      ].join("\n"),
    );
    expect(text("EventEntry", { contract: "MandateVault", name: "Decision" })).toContain("| `amount` | `uint256` | No |");
  });

  it("ErrorEntry gives the signature, its selector and a table of its parameters", () => {
    expect(text("ErrorEntry", { contract: "MandateVault", name: "ChangeExpired" })).toBe(
      [
        "```solidity",
        "error ChangeExpired(bytes32 changeHash)",
        "```",
        "",
        "Selector: `0x051a48c0`",
        "",
        "| Name | Type |",
        "| --- | --- |",
        "| `changeHash` | `bytes32` |",
      ].join("\n"),
    );
  });

  it("TypeEntry gives an enum's members with their ids, and a struct's fields with its notice as the source's comment", () => {
    expect(lines(text("TypeEntry", { name: "Action" })).slice(0, 5)).toEqual(["| Id | Member |", "| --- | --- |", "| 0 | `BUY` |", "| 1 | `SELL` |", "| 2 | `SUPPLY` |"]);
    const intent = lines(text("TypeEntry", { name: "Intent" }));
    expect(intent[0]).toMatch(/^Source comment: BUY: amount = USDC in/);
    expect(intent).toContain("| `minOut` | `uint256` |");
    expect(() => text("TypeEntry", { name: "Nope" })).toThrow("type Nope is not in content/generated/contracts.json");
  });

  it("EnvVar lists the fields the entry shows, then its note", () => {
    expect(text("EnvVar", { name: "BASE_RPC_URL" })).toBe(
      [
        "- Read by: agent/src/config.ts",
        "- Required: Yes, in every mode",
        "- Default: None",
        "- In .env.example: `https://mainnet.base.org`",
        "",
        "RPC for Base mainnet (archive not required for the agent itself).",
      ].join("\n"),
    );
    expect(() => text("EnvVar", { name: "NOPE" })).toThrow("NOPE is not in agent/.env.example");
  });

  it("EnvTable has a row for every setting", () => {
    const out = lines(text("EnvTable"));
    expect(out[0]).toBe("| Setting | Read by | Required | Default |");
    expect(out).toHaveLength(2 + docsData.agent.env.length);
    expect(out[2]).toBe("| `BASE_RPC_URL` | Agent config | Yes | None |");
  });

  it("ScriptEntry gives the command to run, and ScriptFile links the file in the repo", () => {
    expect(text("ScriptEntry", { name: "gen:abi" })).toBe(
      ["```bash", "npm run gen:abi", "```", "", "Runs `tsx scripts/gen-abis.ts` in `agent/`."].join("\n"),
    );
    expect(text("ScriptFile", { name: "cdp-setup.ts" })).toBe(
      `[\`agent/scripts/cdp-setup.ts\`](${SITE.repoUrl}/blob/main/agent/scripts/cdp-setup.ts)`,
    );
    expect(() => text("ScriptFile", { name: "nope.ts" })).toThrow("agent/scripts/nope.ts does not exist");
  });

  it("AddressTable links an address to Basescan and prints a number as it is", () => {
    const out = lines(text("AddressTable"));
    expect(out[0]).toBe("| Name | Value | Note |");
    const groups = new Set(docsData.addresses.map((a) => a.group).filter(Boolean));
    expect(out).toHaveLength(2 + groups.size + docsData.addresses.length);
    expect(out).toContain("| `USDC` | [`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`](https://basescan.org/address/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913) |  |");
  });

  it("AddressTable heads a group with its comment once, in a row of its own, above rows with no note", () => {
    const out = lines(text("AddressTable"));
    const pools = docsData.addresses.find((a) => a.name === "NVDAC_USDC_POOL")!.group;
    expect(out.filter((l) => l.includes(pools))).toEqual([`| ${pools} |`]);
    const head = out.indexOf(`| ${pools} |`);
    expect(out[head + 1]).toMatch(/^\| `NVDAC_USDC_POOL` \| .+ \|  \|$/);
  });
});

describe("deployments", () => {
  const README = `[\`deployments/README.md\`](${SITE.repoUrl}/blob/main/deployments/README.md)`;
  const VAULT = `0x${"11".repeat(20)}`;
  const TX = `0x${"22".repeat(32)}`;
  const row = (contract: string, address = "", tx = "", date = "", network = "Base mainnet") => ({ network, contract, address, tx, date });

  it("DeploymentTable prints the committed table of deployments/README.md", () => {
    expect(text("DeploymentTable")).toBe(deploymentText(docsData.deployments));
  });

  it("says no Maat contract is deployed while no row has an address, linking the file, even if a row has a date", () => {
    const expected = `No Maat contract is deployed: no row of the table in ${README} has an address.`;
    expect(deploymentText([row("MarketCalendar"), row("MandateVault")])).toBe(expected);
    expect(deploymentText([row("MandateVault", "", "", "2026-12-01")])).toBe(expected);
  });

  it("once a row has an address, prints every row, links a Base mainnet address and transaction to Basescan, then names its source", () => {
    expect(
      deploymentText([row("MarketCalendar"), row("MandateVault", VAULT, TX, "2026-12-01"), row("MandateVault", VAULT, "", "", "Base Sepolia")]),
    ).toBe(
      [
        "| Network | Contract | Address | Tx | Date |",
        "| --- | --- | --- | --- | --- |",
        "| Base mainnet | `MarketCalendar` |  |  |  |",
        `| Base mainnet | \`MandateVault\` | [\`${VAULT}\`](https://basescan.org/address/${VAULT}) | [\`${TX}\`](https://basescan.org/tx/${TX}) | 2026-12-01 |`,
        `| Base Sepolia | \`MandateVault\` | \`${VAULT}\` |  |  |`,
        "",
        `From the table in ${README}.`,
      ].join("\n"),
    );
  });

  it("prints the table for a row on another network too, since the sentence says no row has an address", () => {
    expect(deploymentText([row("MandateVault", VAULT, "", "", "Base Sepolia")])).toBe(
      [
        "| Network | Contract | Address | Tx | Date |",
        "| --- | --- | --- | --- | --- |",
        `| Base Sepolia | \`MandateVault\` | \`${VAULT}\` |  |  |`,
        "",
        `From the table in ${README}.`,
      ].join("\n"),
    );
  });
});

describe("tables of shared data", () => {
  it("FactTable gives a figure's plain name, text and source", () => {
    const f = factFor("checksPerTrade");
    expect(lines(text("FactTable", { names: ["checksPerTrade"], label: "Counts" }))).toEqual([
      "| Figure | Value | Source |",
      "| --- | --- | --- |",
      `| Checks per trade | ${f.text} | ${f.source} |`,
    ]);
  });

  it("FactTable gives a setting's plain name, its name in the code, its text and its file, then the caption", () => {
    expect(text("FactTable", { names: ["mandate.maxStalenessSec", "maxTokenDecimals", "timelockHours"], caption: "Shared source." })).toBe(
      [
        "| Setting | In code | Value | Source file |",
        "| --- | --- | --- | --- |",
        "| Oldest feed answer accepted | `Mandate.maxStaleness` in `defaultMandate` | 3,600 s | `contracts/script/MaatConfig.sol` |",
        "| Most decimals a stock may have | literal `18` in `_requireValidTokenConfig` | 18 decimals | `contracts/src/MandateVault.sol` |",
        "| Timelock delay | `MandateVault.TIMELOCK` | 24 hours | `contracts/src/MandateVault.sol` |",
        "",
        "Shared source.",
      ].join("\n"),
    );
  });

  it("FactTable refuses a table that mixes settings and figures", () => {
    expect(() => text("FactTable", { names: ["timelockHours", "checksPerTrade"] })).toThrow(
      "<FactTable /> mixes settings and figures; rows with no place in the code: checksPerTrade",
    );
  });

  it("ReasonTable lists every refusal with its id, its group and a link to its entry", () => {
    const out = lines(text("ReasonTable"));
    expect(out[0]).toBe("| Code | Id | Group | Meaning |");
    expect(out).toHaveLength(2 + REASONS.length);
    expect(out.find((l) => l.includes("MARKET_CLOSED"))).toMatch(
      /^\| \[`MARKET_CLOSED`\]\(\/docs\/concepts\/refusal-codes#market_closed\) \| \d+ \| .+ \| .+ \|$/,
    );
  });

  it("MandateTable gives the landing page's rows, then the caption", () => {
    const out = lines(text("MandateTable"));
    expect(out.slice(0, 2)).toEqual(["| Setting | Field | Default |", "| --- | --- | --- |"]);
    const rows = mandateRows(FACTS.mandate.value);
    expect(out.slice(2, 2 + rows.length)).toHaveLength(rows.length);
    expect(out).toContain(`| ${rows[0]!.label} | \`${rows[0]!.k}\` | ${rows[0]!.v} |`);
    expect(out.at(-1)).toMatch(/^Set in contracts\/script\/MaatConfig\.sol;/);
  });

  it("ForkLedger gives one row per fork decision, then the caption naming the fork block", () => {
    const out = lines(text("ForkLedger"));
    expect(out[0]).toBe("| Time (ET) | Intent | Decision | Gas | Note |");
    expect(out.filter((l) => l.startsWith("| "))).toHaveLength(2 + getDecisions().length);
    expect(out.at(-1)).toContain(`block ${factFor("forkBlock").text}`);
  });

  it("escapes a pipe and joins a line break in a cell, so the row keeps its columns", () => {
    // Neither appears in today's data; a note or a notice could carry one.
    expect(mdTable(["A", "B"], [["a | b", "c\nd"]])).toBe("| A | B |\n| --- | --- |\n| a \\| b | c d |");
  });
});

describe("EventSignature, RouterCards and StatusBadge", () => {
  it("EventSignature prints the Decision event and refuses any other", () => {
    const out = text("EventSignature", { name: "Decision" });
    expect(out.startsWith("```solidity\nevent Decision(\n  bytes32 indexed intentId,")).toBe(true);
    expect(out.endsWith("\n)\n```")).toBe(true);
    expect(() => text("EventSignature", { name: "Paused" })).toThrow("only Decision is in FACTS");
  });

  it("RouterCards lists each reader path with a link, or without one when its page has not shipped", () => {
    const all = lines(text("RouterCards"));
    expect(all).toHaveLength(READER_PATHS.length);
    expect(all[0]).toBe("- **New to Maat**: Know what it is and why it matters. [What is Maat →](/docs/get-started/what-is-maat)");
    const some = lines(text("RouterCards", {}, { exists: (slug) => slug !== "security/model" }));
    expect(some.at(-1)).toBe("- **Evaluator or partner**: Decide whether to trust it or build on it. Security model (coming soon)");
  });

  it("StatusBadge is its label", () => {
    expect(text("StatusBadge", { status: "fork-tested" })).toBe("Fork-tested");
    expect(text("StatusBadge", { status: "live" })).toBe("Live on mainnet");
  });
});

describe("SectionIndex", () => {
  const tree: Root = {
    name: "Docs",
    children: [
      { type: "page", name: "Home", url: "/docs", description: "The home." },
      {
        type: "folder",
        name: "A",
        index: { type: "page", name: "A", url: "/docs/a", description: "Section A." },
        children: [
          { type: "page", name: "One", url: "/docs/a/one", description: "Page one." },
          { type: "page", name: "Two", url: "/docs/a/two" },
          { type: "separator", name: "More" },
          { type: "page", name: "Three", url: "/docs/b/three" },
        ],
      },
      {
        type: "folder",
        name: "B",
        index: { type: "page", name: "B", url: "/docs/b", description: "Section B." },
        children: [{ type: "page", name: "Three", url: "/docs/b/three", description: "Page three." }],
      },
    ],
  };
  const withTree: TextContext = { ...ALL, tree: () => tree };

  it("lists a folder's pages as links with their descriptions, and names each later group in bold", () => {
    expect(text("SectionIndex", { section: "a" }, withTree)).toBe(
      [
        "- [One](/docs/a/one): Page one.",
        "- [Two](/docs/a/two)",
        "",
        "**More**",
        "",
        "- [Three](/docs/b/three): Page three.",
      ].join("\n"),
    );
  });

  it("with no section, lists the sections, each linking its own page", () => {
    expect(text("SectionIndex", {}, withTree)).toBe("- [A](/docs/a): Section A.\n- [B](/docs/b): Section B.");
  });

  it("needs the page tree", () => {
    expect(() => text("SectionIndex", { section: "a" })).toThrow("<SectionIndex /> needs the docs page tree");
  });
});

describe("diagrams", () => {
  it("a flow gives its label, its steps as a numbered list and its caption", () => {
    const out = lines(text("DecisionLoop"));
    expect(out[0]).toBe("**How one round of the agent loop reaches a decision**");
    expect(out[2]).toBe("1. **Read the vault**: Balances, prices, the mandate and the market, all at one block.");
    expect(out[5]).toBe(
      `4. **The vault decides**: Up to ${factFor("checksPerTrade").text} checks run in the contract for a BUY or a SELL. A Decision event records the verdict.`,
    );
    expect(out.at(-1)).toContain(`every ${factFor("loopMinutes").text} in session`);
  });

  it("states the signer, the vault, the instant owner actions and the borrow rule as wide as the code", () => {
    const architecture = lines(text("Architecture"));
    expect(architecture).toContain(
      "3. **CDP wallet**: Live-mode signer. Its policy allows only zero-value transactions to the vault, and sends only on Base.",
    );
    expect(architecture).toContain("4. **MandateVault**: Runs the checks and records its verdict on every execute that does not revert.");
    expect(lines(text("TimelockFlow")).at(-1)).toBe(
      "Pausing, rotating the executor, withdrawing to the owner, and adding a holiday or an earlier close to the calendar are instant. Changing the mandate, a stock's settings or a payee never is.",
    );
    expect(lines(text("TreasuryLoop"))).toContain(
      `3. **Borrow**: USDC, when cash covers less than ${factFor("runwayDays").text} of compute plus unpaid bills. Only in session, and only if the projected health factor stays at or above ${factFor("mandate.minHealthFactor").text}, or ${factFor("mandate.targetHealthFactor").text} in the de-risk window.`,
    );
  });

  it("MultiplierFlow puts the block before the recording, and counts the cooldown from the recording", () => {
    expect(text("MultiplierFlow")).toBe(
      [
        "**How a multiplier change blocks a stock**",
        "",
        "1. **The token changes**: Its uiMultiplier no longer matches the vault's snapshot, or it schedules a change with an effectiveAt() in the future. The stock is blocked at once, before anything is recorded.",
        "2. **The vault records it**: When the value has changed, a syncMultiplier from anyone, an execute that names the stock, or an applyTokenConfig for it stores the new value and emits an event. The cooldown counts from this recording.",
        `3. **The cooldown**: The stock stays blocked until the cooldown, ${factFor("mandate.multiplierCooldownSec").text} by default, has passed since the recording and, for a scheduled change, since effectiveAt().`,
        "4. **Allowed again**: The multiplier check passes. Every other check still applies.",
        "",
        "The block covers BUY and SELL of the stock, and BORROW and WITHDRAW_COLLATERAL against debt while the stock is supplied as collateral. Those actions return MULTIPLIER_COOLDOWN once every check before the multiplier check passes.",
      ].join("\n"),
    );
  });

  it("HealthFactorScale gives each range from the highest, with its numbers from FACTS and what the vault returns there", () => {
    const bound = factFor("healthFactorBound").text;
    const floor = factFor("mandate.minHealthFactor").text;
    const target = factFor("mandate.targetHealthFactor").text;
    expect(text("HealthFactorScale")).toBe(
      [
        "**What the vault returns for the health factor a BORROW, or a WITHDRAW_COLLATERAL against debt, would leave**",
        "",
        `- **${target} and above**: Allowed. At or above the target, targetHealthFactor: allowed, inside the de-risk window too. The action's other checks still apply.`,
        `- **${floor} to under ${target}**: DERISK_WINDOW in the window. From the floor up to the target: allowed outside the de-risk window, DERISK_WINDOW inside it.`,
        `- **${bound} to under ${floor}**: HEALTH_FACTOR_LOW. Below the floor, minHealthFactor: refused, inside the de-risk window or not.`,
        `- **Below ${bound}**: Below the lowest floor allowed. A mandate with a credit adapter cannot set its floor here: the vault rejects it with InvalidConfig. A BORROW projected to land here returns HEALTH_FACTOR_LOW. A WITHDRAW_COLLATERAL is not projected, and the adapter asks the spoke to withdraw before it checks the health factor. If the spoke refuses first, as the mock Aave spoke in the unit tests does below ${bound}, the vault returns CREDIT_FAILED.`,
        "",
        `Shown with the default floor and target. A mandate with a credit adapter can set others, as long as the floor is at least ${bound} and the target is at least the floor. SUPPLY and REPAY are never refused for the health factor.`,
      ].join("\n"),
    );
  });

  it.each(["Architecture", "TimelockFlow", "TreasuryLoop", "MultiplierFlow"] as const)("%s numbers its steps from 1", (name) => {
    const items = lines(text(name)).filter((l) => /^\d+\. /.test(l));
    expect(items.length).toBeGreaterThanOrEqual(4);
    items.forEach((l, i) => expect(l.startsWith(`${i + 1}. `)).toBe(true));
  });

  it("MarketWeek says when each session mode is open, then the note on the time zone", () => {
    const out = lines(text("MarketWeek"));
    expect(out[0]).toBe(`- \`REGULAR\` is open Monday to Friday, ${factFor("nyseOpen").text} to ${factFor("nyseClose").text}.`);
    expect(out[1]).toContain("`FEED_24_5` is open Sunday");
    expect(out.at(-1)).toMatch(/^New York time,/);
  });
});
