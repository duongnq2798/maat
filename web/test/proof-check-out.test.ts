import { describe, expect, it } from "vitest";
import { checkProofPage } from "@/lib/check-out";

describe("checkProofPage", () => {
  const page = (body: string, head = "") =>
    [
      '<!DOCTYPE html><html lang="en"><head><title>Proof · Maat</title>',
      '<meta name="description" content="How Maat counts outside briefs to its agent, rebuilt from MaatInbox logs on Base by a script anyone can run."/>',
      '<link rel="canonical" href="https://maat.example/proof"/>',
      '<meta property="og:image" content="https://maat.example/opengraph-image.png"/>',
      head,
      '<script src="/_next/static/chunks/proof.js" async=""></script>',
      `</head><body><a href="#main">Skip</a><main id="main"><h1 class="h2">Proof</h1>${body}`,
      "<h2>The counting rule</h2><p><strong>Lines kept apart.</strong> No line is ever added to another.</p>",
      "</main></body></html>",
    ].join("");
  const URL_ = "https://maat.example/proof";
  const SITEMAP = `<url><loc>${URL_}</loc></url>`;
  const check = (html: string, inbox: boolean, sitemap = SITEMAP) => checkProofPage({ html, inboxRecorded: inbox, sitemap, url: URL_ });
  const NOT_RECORDED = page(
    '<div data-proof-state="not-recorded"><p>Counting starts when the inbox is recorded.</p></div><dd data-testid="proof-outside-briefs">not deployed</dd>',
  );
  const READING = page('<div data-proof-state="reading"><p>Reading briefs from Base…</p></div><dd data-testid="proof-outside-briefs">…</dd>');

  it("passes the not-recorded page before the inbox is recorded, and the reading page after", () => {
    expect(check(NOT_RECORDED, false)).toEqual([]);
    expect(check(READING, true)).toEqual([]);
  });

  it("fails when the static state does not match the deployments table", () => {
    expect(check(READING, false)).toEqual(["out/proof.html does not say counting starts when the inbox is recorded, but no MaatInbox is recorded"]);
    expect(check(NOT_RECORDED, true)).toEqual(["out/proof.html does not show the reading state, but a MaatInbox is recorded"]);
  });

  it("fails a reading page with a count baked in at build time", () => {
    const baked = READING.replace('data-testid="proof-outside-briefs">…<', 'data-testid="proof-outside-briefs">3<');
    expect(check(baked, true)).toEqual(["out/proof.html has a count in its HTML, read at build time"]);
  });

  it("fails a not-recorded page with a number on a brief line or a row, since there is nothing to count yet", () => {
    for (const n of ["2", "0"]) {
      const counted = NOT_RECORDED.replace('data-testid="proof-outside-briefs">not deployed<', `data-testid="proof-outside-briefs">${n}<`);
      expect(check(counted, false)).toEqual(["out/proof.html shows a brief line other than not deployed, but no MaatInbox is recorded"]);
    }
    const row = NOT_RECORDED.replace("</main>", '<table><tr data-proof-row="outside"><td>0xabc</td></tr></table></main>');
    expect(check(row, false)).toEqual(["out/proof.html lists a wallet or a brief, but no MaatInbox is recorded"]);
  });

  it("fails a page without the counting rule in its markup", () => {
    const bare = NOT_RECORDED.replace("No line is ever added to another.", "");
    expect(check(bare, false)).toEqual(["out/proof.html does not hold the counting rule in its markup"]);
  });

  it("fails a page that asks not to be indexed, or that the sitemap does not list, since it is public", () => {
    expect(check(page('<div data-proof-state="not-recorded">Counting starts when the inbox is recorded.</div>', '<meta name="robots" content="noindex, follow"/>'), false)).toEqual([
      "out/proof.html asks not to be indexed, but /proof is a public page",
    ]);
    expect(check(NOT_RECORDED, false, "<urlset></urlset>")).toEqual([`out/sitemap.xml does not list ${URL_}`]);
  });

  it("names a wrong title, a missing canonical URL, a short description, an anchor without a target and a third-party script", () => {
    const bad = NOT_RECORDED.replace("<title>Proof · Maat</title>", "<title>Maat</title>")
      .replace('<link rel="canonical" href="https://maat.example/proof"/>', "")
      .replace(/content="How Maat[^"]*"/, 'content="Too short."')
      .replace('<a href="#main">', '<a href="#nowhere">')
      .replace("/_next/static/chunks/proof.js", "https://cdn.example/x.js");
    expect(check(bad, false)).toEqual([
      'out/proof.html: title "Maat" is not "Proof · Maat"',
      "out/proof.html: meta description is 10 characters, want 50 to 160",
      "out/proof.html: the canonical link is missing, not absolute or not /proof",
      "out/proof.html: link #nowhere has no target",
      "out/proof.html: third-party script https://cdn.example/x.js",
    ]);
  });
});
