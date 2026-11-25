import { render, screen, within } from "@testing-library/react";
import type { Address } from "viem";
import { describe, expect, it } from "vitest";
import { BriefCounters, BriefFeed } from "@/app/(site)/ask/BriefFeed";
import { HIDDEN_BRIEFS } from "@/content/ask-hidden";
import { briefCounts, briefFeed, plainBriefText, type Brief } from "@/lib/chain/inbox";
import { hash32 } from "./helpers/fake-ledger";

const U = (code: number) => String.fromCodePoint(code);
const RLO = U(0x202e);
const ZWSP = U(0x200b);
const FFFD = U(0xfffd);
const ALICE: Address = "0x00000000000000000000000000000000000A11cE";
const BOB: Address = "0x0000000000000000000000000000000000000B0b";

const HOSTILE = {
  url: "claim at https://evil.example/drain and www.evil.example now",
  html: '<img src=x onerror="alert(1)"><script>alert(2)</script><a href="https://evil.example">click</a><b>bold</b>',
  markdown: "# Heading\n**bold** [link](https://evil.example) `code` <https://evil.example>",
  rtl: `invoice${RLO}fdp.exe`,
  zeroWidth: `pay${ZWSP}pal${U(0x200d)}.com`,
} as const;

const brief = (id: number, from: Address, text: string): Brief => ({ id, from, text, blockNumber: BigInt(100 + id), txHash: hash32(9000 + id), logIndex: 0 });
const briefs = Object.values(HOSTILE).map((text, i) => brief(i + 1, i % 2 ? BOB : ALICE, text));

describe("the owner's hide-list", () => {
  it("is a list of distinct brief ids, each a positive safe integer", () => {
    expect(HIDDEN_BRIEFS.every((id) => Number.isSafeInteger(id) && id > 0)).toBe(true);
    expect(new Set(HIDDEN_BRIEFS).size).toBe(HIDDEN_BRIEFS.length);
  });
});

describe("BriefFeed renders every brief as inert plain text", () => {
  it("shows URLs, HTML, markdown, an RTL override and zero-width characters as text, with no link and no markup", () => {
    render(<BriefFeed items={briefFeed(briefs, [])} />);
    const list = screen.getByRole("list", { name: "Briefs" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(briefs.length);

    // Nothing but the feed's own text boxes: no link, image, script, bold, heading or code element from a brief.
    expect(list.querySelectorAll("a, img, script, b, strong, em, h1, h2, h3, code, iframe, svg")).toHaveLength(0);
    expect(list.querySelectorAll("[href], [src], [onerror]")).toHaveLength(0);
    expect(within(list).queryAllByRole("link")).toEqual([]);
    expect(list.innerHTML).toContain("&lt;img src=x onerror=\"alert(1)\"&gt;&lt;script&gt;");

    const texts = items.map((li) => li.querySelector("[data-brief-text]")!.textContent);
    expect(texts).toEqual([...briefs].reverse().map((b) => plainBriefText(b.text)));
    expect(texts).toContain(HOSTILE.html);
    expect(texts).toContain(HOSTILE.url);
    expect(texts).toContain(plainBriefText(HOSTILE.markdown));
    expect(texts).toContain(`invoice${FFFD}fdp.exe`);
    expect(texts).toContain(`pay${FFFD}pal${FFFD}.com`);
    expect(texts.join("")).not.toContain(RLO);
    expect(texts.join("")).not.toContain(ZWSP);
  });

  it("gives each brief its id and its sender's short address, as text", () => {
    render(<BriefFeed items={briefFeed([brief(7, ALICE, "hello")], [])} />);
    const item = screen.getByRole("listitem");
    expect(item).toHaveTextContent("#7");
    expect(item).toHaveTextContent("0x0000…11cE");
    expect(item.querySelector("[data-brief-text]")).toHaveAttribute("dir", "auto");
  });

  it("leaves a hidden brief out of the feed, while the counters still count it", () => {
    const hidden = [2];
    render(
      <>
        <BriefCounters counts={briefCounts(briefs, hidden)} />
        <BriefFeed items={briefFeed(briefs, hidden)} />
      </>,
    );
    const items = within(screen.getByRole("list", { name: "Briefs" })).getAllByRole("listitem");
    expect(items.map((li) => li.getAttribute("data-brief-id"))).toEqual(["5", "4", "3", "1"]);
    expect(screen.getByTestId("count-briefs")).toHaveTextContent("5");
    expect(screen.getByTestId("count-wallets")).toHaveTextContent("2");
    expect(screen.getByText("1 brief is hidden from the feed by the owner; it still counts.")).toBeInTheDocument();
  });

  it("says so when there is no brief yet", () => {
    render(<BriefFeed items={[]} />);
    expect(screen.getByText("No brief yet.")).toBeInTheDocument();
  });
});

describe("BriefCounters", () => {
  it("shows Claude persuaded, vault allowed and vault refused as not available yet, and no value-moved line", () => {
    render(<BriefCounters counts={briefCounts(briefs, [])} />);
    for (const id of ["count-persuaded", "count-allowed", "count-refused"]) expect(screen.getByTestId(id)).toHaveTextContent("not available yet");
    expect(screen.getByText(/The agent does not read briefs until its agent-r3 release/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/value moved outside the mandate/i);
    expect(screen.queryByText(/hidden from the feed/)).toBeNull();
  });

  it("shows an ellipsis for each count while the briefs are being read", () => {
    render(<BriefCounters counts={null} />);
    expect(screen.getByTestId("count-briefs")).toHaveTextContent("…");
    expect(screen.getByTestId("count-wallets")).toHaveTextContent("…");
  });
});
