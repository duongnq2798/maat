import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { type FactKey, Fig, factAttr, resolveFact } from "@/components/instrument/Fig";
import { Live, liveAttrs } from "@/components/instrument/Live";
import { FACTS } from "@/content/facts";
import { formatLimit } from "@/content/format";
import { formatBlock } from "@/lib/live/format";

const SNAPSHOT = { block: 60_013_066n, timestamp: 1_795_000_000, endpoint: "https://base-rpc.publicnode.com" };

describe("resolveFact (components/instrument/Fig.tsx)", () => {
  it("reads an entry with its source", () => {
    expect(resolveFact("timelockHours")).toEqual({ value: 24, source: FACTS.timelockHours.source });
    expect(resolveFact("checksPerTrade")).toEqual({ value: 9, source: FACTS.checksPerTrade.source });
  });

  it("reads a field with the source of its entry, as spec section 10.2 gives it", () => {
    expect(resolveFact("mandate.maxPremiumBps")).toEqual({
      value: FACTS.mandate.value.maxPremiumBps,
      source: FACTS.mandate.source,
    });
    expect(resolveFact("gas.refusalLog").value).toBe(111_116);
    expect(resolveFact("premiumsBps.NVDAc").value).toBe(53);
  });

  it("refuses a key FACTS does not have", () => {
    for (const bad of ["", "nope", "mandate.nope", "timelockHours.x", "basket.0", "calendar.holidays", "toString", "mandate.constructor"]) {
      expect(() => resolveFact(bad), bad).toThrow(/no fact|no field|not one number/);
    }
  });
});

describe("factAttr (components/instrument/Fig.tsx)", () => {
  it("is one key, or several space-separated", () => {
    expect(factAttr("timelockHours")).toBe("timelockHours");
    expect(factAttr(["mandate.maxPremiumBps", "mandate.maxSlippageBps"])).toBe("mandate.maxPremiumBps mandate.maxSlippageBps");
  });

  it("refuses no key, a repeated key, or an unknown key", () => {
    expect(() => factAttr([])).toThrow(/at least one key/);
    expect(() => factAttr(["forkBlock", "forkBlock"])).toThrow(/repeated/);
    expect(() => factAttr(["forkBlock", "nope" as FactKey])).toThrow(/no fact/);
  });
});

describe("Fig (components/instrument/Fig.tsx)", () => {
  it("puts data-fact on the element that holds the whole string, and nothing inside it", () => {
    const { container } = render(
      <Fig k="timelockHours" as="dd">
        {`${FACTS.timelockHours.value}h`}
      </Fig>,
    );
    const dd = container.firstElementChild as HTMLElement;
    expect(dd.tagName).toBe("DD");
    expect(dd).toHaveAttribute("data-fact", "timelockHours");
    expect(dd.textContent).toBe("24h");
    expect(dd.children).toHaveLength(0);
    expect(dd).not.toHaveAttribute("class");
  });

  it("is a span by default, takes a class, and writes several keys into one attribute", () => {
    const m = FACTS.mandate.value;
    const { container } = render(
      <Fig k={["mandate.maxPremiumBps", "mandate.maxSlippageBps"]} className="font-mono">
        {`${formatLimit(m.maxPremiumBps, "bps")} premium · ${formatLimit(m.maxSlippageBps, "bps")} slippage`}
      </Fig>,
    );
    const span = container.firstElementChild as HTMLElement;
    expect(span.tagName).toBe("SPAN");
    expect(span.className).toBe("font-mono");
    expect(span).toHaveAttribute("data-fact", "mandate.maxPremiumBps mandate.maxSlippageBps");
    expect(span.textContent).toBe("100 bps premium · 150 bps slippage");
  });

  it("writes a number child as its text", () => {
    const { container } = render(<Fig k="checksPerTrade">{FACTS.checksPerTrade.value}</Fig>);
    expect(container.textContent).toBe("9");
  });

  it("refuses to render an unknown key", () => {
    expect(() => render(<Fig k={"mandate.nope" as FactKey}>1</Fig>)).toThrow(/no field/);
  });
});

describe("Live (components/instrument/Live.tsx)", () => {
  it("names the block, the RPC host and the block time", () => {
    expect(liveAttrs(SNAPSHOT)).toEqual({
      "data-live": "60013066",
      "data-live-host": "base-rpc.publicnode.com",
      "data-live-time": "1795000000",
    });
    expect(liveAttrs({ ...SNAPSHOT, endpoint: "https://mainnet.base.org/" })["data-live-host"]).toBe("mainnet.base.org");
  });

  it("marks the element that holds the live value, and nothing inside it", () => {
    const { container } = render(
      <Live snapshot={SNAPSHOT} as="strong" className="font-mono">
        {formatBlock(SNAPSHOT.block)}
      </Live>,
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.tagName).toBe("STRONG");
    expect(el).toHaveAttribute("data-live", "60013066");
    expect(el).toHaveAttribute("data-live-host", "base-rpc.publicnode.com");
    expect(el).toHaveAttribute("data-live-time", "1795000000");
    expect(el.className).toBe("font-mono");
    expect(el.textContent).toBe("60,013,066");
    expect(el.children).toHaveLength(0);
  });

  it("is a span by default", () => {
    const { container } = render(<Live snapshot={SNAPSHOT}>x</Live>);
    expect(container.firstElementChild?.tagName).toBe("SPAN");
  });
});
