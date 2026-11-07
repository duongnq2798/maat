import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
import { docsData } from "@/lib/docs/generated";
import { headingId } from "@/lib/docs/links";

describe("contract entries", () => {
  it("Fn shows the signature, who may call it and whether it changes state", () => {
    render(<Fn contract="MandateVault" name="queueMandate" />);
    expect(screen.getByText("function queueMandate(Mandate m) external returns (bytes32 changeHash)")).toBeInTheDocument();
    expect(screen.getByText("Owner only")).toBeInTheDocument();
    expect(screen.getByText("Changes state")).toBeInTheDocument();
  });

  it("Fn marks public state variables", () => {
    render(<Fn contract="MandateVault" name="spentOnDay" />);
    expect(screen.getByText("function spentOnDay(uint256 utcDay) public view returns (uint256)")).toBeInTheDocument();
    expect(screen.getByText("Public state")).toBeInTheDocument();
    expect(screen.getByText("Read only")).toBeInTheDocument();
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
    const table = screen.getByRole("region", { name: "Decision parameters" });
    const intent = within(table).getByText("intentId").closest("tr");
    expect(intent).not.toBeNull();
    expect(within(intent as HTMLElement).getByText("Yes")).toBeInTheDocument();
    expect(within(table).getAllByRole("row")).toHaveLength(1 + 7);
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
    expect(rows).toHaveLength(1 + docsData.addresses.length);
    const addresses = docsData.addresses.filter((a) => a.type === "address");
    expect(screen.getAllByRole("link")).toHaveLength(addresses.length);
    expect(screen.getByRole("link", { name: addresses[0]?.value })).toHaveAttribute(
      "href",
      `https://basescan.org/address/${addresses[0]?.value}`,
    );
  });

  it("FactTable shows each value with its source", () => {
    render(<FactTable names={["timelockHours", "mandate.maxPremiumBps"]} />);
    expect(screen.getByText("24 hours")).toBeInTheDocument();
    expect(screen.getByText(FACTS.timelockHours.source)).toBeInTheDocument();
    expect(() => FactTable({ names: ["nope" as never] })).toThrow('<Fact name="nope" /> is not in FACT_TEXT');
  });
});
