import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Page from "@/app/(site)/page";
import { REASON_LABEL, REASON_MEANING, REASONS, type RefusalCode } from "@/content/reasons";
import { SITE } from "@/lib/site";

function setup() {
  return render(<Page />).container;
}

describe("landing page", () => {
  it("has one h1 and never skips a heading level on the way down", () => {
    const levels = [...setup().querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => Number(h.tagName.slice(1)));
    expect(levels[0]).toBe(1);
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    levels.forEach((l, i) => {
      if (i > 0) expect(l - levels[i - 1]!).toBeLessThanOrEqual(1);
    });
  });

  it("every in-page link has a target", () => {
    const c = setup();
    const ids = new Set([...c.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute("href")!.slice(1)));
    expect([...ids].sort()).toEqual(["how", "ledger", "main", "mandate", "reasons", "top", "try"]);
    for (const id of ids) expect(c.querySelector(`#${id}`), `#${id}`).not.toBeNull();
  });

  it("orders the sections like the comp", () => {
    const c = setup();
    const ids = [...c.querySelectorAll("#top, #how, #reasons, #try, #ledger, #mandate")].map((el) => el.id);
    expect(ids).toEqual(["top", "how", "reasons", "try", "ledger", "mandate"]);
  });

  it("lists all nineteen refusals once, each titled by its plain label, and highlights only MARKET_CLOSED", () => {
    const c = setup();
    const section = c.querySelector("#reasons") as HTMLElement;
    expect(within(section).getByRole("heading", { level: 2 })).toHaveTextContent("Nineteen typed ways to say no.");
    const items = [...section.querySelectorAll<HTMLElement>("li[data-code]")];
    expect(items.map((li) => li.dataset.code).sort()).toEqual([...REASONS].sort());
    // Each item reads its plain label first, then its code as a tag, then the plain-English meaning.
    for (const li of items) {
      const code = li.dataset.code as RefusalCode;
      expect(li.children).toHaveLength(2);
      const [tag, meaning] = [...li.children];
      expect(tag).toHaveAttribute("data-reason-tag", code);
      expect(tag!.firstElementChild!.textContent).toBe(REASON_LABEL[code]);
      expect(tag!.lastElementChild!.textContent).toBe(code);
      expect(meaning!.textContent).toBe(REASON_MEANING[code]);
    }
    expect([...section.querySelectorAll<HTMLElement>("li[data-hot]")].map((li) => li.dataset.code)).toEqual(["MARKET_CLOSED"]);
  });

  it("lets a visitor try the mandate, labeled as a simulation of the default one", () => {
    const c = setup();
    const section = c.querySelector("#try") as HTMLElement;
    expect(within(section).getByRole("heading", { level: 2 })).toHaveTextContent("Try to make it say no.");
    expect(section).toHaveTextContent("A simulation of the default mandate, running in your browser.");
    expect(section).toHaveTextContent("The contract is the source of truth.");
    expect(within(section).getByText("default mandate · not the contract")).toBeInTheDocument();
    expect(section).toHaveTextContent(
      "weekends, and the 12 holidays and 3 early closes the calendar lists, up to Fri 24 Dec 2027)",
    );
    expect(section).toHaveTextContent("53 bps for NVDAc, 49 bps for GOOGLc and 29 bps for AAPLc");
    expect(section).toHaveTextContent(
      "an NVDAc feed answer 14 s old (the GOOGLc and AAPLc feeds are assumed fresh), multiplier unchanged",
    );
    expect(section).toHaveTextContent("the token list, the per-trade and daily caps, the weight and the vault's USDC balance.");
    expect(section).toHaveTextContent("Each day starts with $200 USDC and no stock");
    expect(within(section).getByRole("link", { name: "MarketCalendar.sol" })).toHaveAttribute(
      "href",
      `${SITE.repoUrl}/blob/main/contracts/src/MarketCalendar.sol`,
    );
    expect(within(section).getByRole("link", { name: "MandateVault.sol" })).toHaveAttribute(
      "href",
      `${SITE.repoUrl}/blob/main/contracts/src/MandateVault.sol`,
    );
  });

  it("shows the mandate sheet and its public timelock", () => {
    const c = setup();
    const section = c.querySelector("#mandate") as HTMLElement;
    expect(section.querySelectorAll("dl > div")).toHaveLength(12);
    expect(within(section).getByText("timelock 24h")).toBeInTheDocument();
    expect(within(section).getByText("mandateHash [after deploy]")).toBeInTheDocument();
    // Nothing is deployed yet, so the sheet must not claim a network.
    expect(within(section).getByText("default · not deployed yet")).toBeInTheDocument();
    expect(section).not.toHaveTextContent("Base mainnet");
    expect(within(section).getByText(/waits 24 hours/)).toBeInTheDocument();
  });

  it("explains the treasury loop with fact-backed numbers", () => {
    setup();
    expect(screen.getByText(/pay about one cent/)).toBeInTheDocument();
    expect(screen.getByText(/rebalanced past a 5% drift/)).toBeInTheDocument();
  });

  it("closes with the CTA, disclaimer and tagline verbatim", () => {
    setup();
    expect(screen.getByRole("link", { name: "Follow @maatonbase" })).toHaveAttribute("href", SITE.xUrl);
    expect(screen.getByRole("link", { name: "Read the code" })).toHaveAttribute("href", SITE.repoUrl);
    const links = within(screen.getByRole("list", { name: "Project links" }))
      .getAllByRole("link")
      .map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([
      ["Docs", SITE.docsUrl],
      ["Source on GitHub", SITE.repoUrl],
      ["Verify in 5 minutes", SITE.quickstartUrl],
      ["Fork evidence", SITE.forkEvidenceUrl],
      ["MIT License", SITE.licenseUrl],
      [SITE.xHandle, SITE.xUrl],
    ]);
    expect(screen.getByText(SITE.disclaimer)).toBeInTheDocument();
    expect(screen.getByText(SITE.tagline)).toBeInTheDocument();
  });

  it("never shows a made-up hash and keeps the mainnet placeholders", () => {
    const text = setup().textContent ?? "";
    expect(text).not.toMatch(/0x[0-9a-fA-F]{40,}/);
    expect(text).toContain("[after deploy]");
    expect(text).toContain("[from mainnet tx]");
  });

  it("uses no raster images", () => {
    expect(setup().querySelectorAll("img")).toHaveLength(0);
  });
});
