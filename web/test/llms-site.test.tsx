import type { Metadata } from "next";
import { describe, expect, it } from "vitest";
import { ASK_SITE_PAGE } from "@/app/(site)/ask/config";
import { metadata as ask } from "@/app/(site)/ask/page";
import { metadata as gapIndex } from "@/app/(site)/gap-index/page";
import { metadata as ledger } from "@/app/(site)/ledger/page";
import { metadata as now } from "@/app/(site)/now/page";
import { metadata as proof } from "@/app/(site)/proof/page";
import { ABI_NOTE } from "@/lib/docs/abi";
import { docsData } from "@/lib/docs/generated";
import { LLMS_SITE_PAGES, LLMS_STATUS } from "@/lib/docs/markdown";
import { SITE } from "@/lib/site";

// llms.txt's Site section (judge rehearsal 2026-11-27, m11): the pages that show Maat on Base, each named and described
// as its own <title> and meta description give it, so the list cannot drift from the pages.
const METADATA: Record<string, Metadata> = { "/ledger": ledger, "/now": now, "/proof": proof, "/gap-index": gapIndex, "/ask": ask };

describe("llms.txt's Site section", () => {
  it("lists the ledger, /now, /proof and the Gap Index, the ledger first", () => {
    expect(LLMS_SITE_PAGES.map((p) => p.path)).toEqual(["/ledger", "/now", "/proof", "/gap-index"]);
  });

  it.each([...LLMS_SITE_PAGES, ASK_SITE_PAGE].map((p) => [p.path, p] as const))("names and describes %s as its metadata does", (path, page) => {
    const m = METADATA[path]!;
    expect(`${page.title} · ${SITE.name}`).toBe(String(m.title));
    expect(page.description).toBe(String(m.description));
  });
});

// m12: the five Base mainnet rows of deployments/README.md are the four core contracts and MaatInbox. The generated
// lines an AI reads first, llms.txt's status and every ABI file's note, give that count, not four alone. llms.txt's
// status quotes the docs home's Today paragraph (test/docs-page.test.tsx), so it says it in that paragraph's words.
describe("the five-contract wording of the generated files", () => {
  const recorded = docsData.deployments.filter((d) => d.network === "Base mainnet" && /^0x[0-9a-fA-F]{40}$/.test(d.address.trim()));
  /** The sentences of `text` that give "four Maat contracts" in the present tense without naming MaatInbox. */
  const fourAlone = (text: string) =>
    text.split(/(?<=\.)\s+/).filter((s) => /\bfour (?:core )?Maat contracts,? (?:are|is)\b/i.test(s) && !s.includes("MaatInbox"));

  it("counts every recorded Base mainnet contract, MaatInbox included, in llms.txt's status and the ABI note", () => {
    expect(recorded.map((d) => d.contract)).toContain("MaatInbox");
    expect(recorded).toHaveLength(5);
    expect(LLMS_STATUS).toContain("the four Maat contracts are deployed to Base mainnet, and so is `MaatInbox`, the inbox for briefs: five contracts in all.");
    expect(ABI_NOTE).toContain("The four core Maat contracts and MaatInbox (five in all) are deployed to Base mainnet");
    for (const text of [LLMS_STATUS, ABI_NOTE]) expect(fourAlone(text)).toEqual([]);
    expect(fourAlone("Today the four Maat contracts are deployed to Base mainnet. The contracts are unaudited.")).toHaveLength(1);
  });
});
