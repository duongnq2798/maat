import { describe, expect, it } from "vitest";
import { canon } from "../src/rationale/canon.js";
import { cutTo, HEX_RE, KEY_RE, LONG_RE, NO_TEXT, sanitize, URL_RE } from "../src/rationale/sanitize.js";

describe("canon (spec §2.2)", () => {
  it("sorts keys at every level, drops undefined keys and writes no whitespace", () => {
    expect(canon({ t: "x", b: 1, s: [[1, null, "a"]], k: undefined, a: { z: true, y: false } })).toBe('{"a":{"y":false,"z":true},"b":1,"s":[[1,null,"a"]],"t":"x"}');
  });

  it("escapes only what JSON.stringify escapes", () => {
    expect(canon('He said "no" \\ ok')).toBe('"He said \\"no\\" \\\\ ok"');
  });

  it("takes safe integers only", () => {
    expect(canon(Number.MAX_SAFE_INTEGER)).toBe("9007199254740991");
    expect(() => canon(1.5)).toThrow(/integers only/);
    expect(() => canon(2 ** 53)).toThrow(/integers only/);
    expect(() => canon(Number.NaN)).toThrow(/integers only/);
  });

  it("refuses values JSON has no canonical form for", () => {
    expect(() => canon(1n)).toThrow(/no canonical form/);
    expect(() => canon(undefined)).toThrow(/no canonical form/);
    expect(() => canon([undefined])).toThrow(/no canonical form/);
  });
});

describe("sanitize (spec §2.3)", () => {
  // §5.8, row for row.
  it.each([
    ["a\tb\r\nc", "a b c"],
    ["  x  ", "x"],
    ["", "(no text)"],
    ["\u{1F680} go", "go"],
    [`key 0x${"ab".repeat(32)} end`, "key [hex] end"],
    ["token sk-fake0123456789abcdefXYZ here", "token [key] here"],
    [`run ${"A".repeat(45)} end`, "run [key] end"],
    ["NVDAc.price and 23.3% and e.g. 1.5bps", "[url] and 23.3% and e.g. 1.5bps"],
    ["mailto me at a@b.io", "mailto me at a@[url]"],
  ])("§5.8: sanitize(%j, 600) is %j", (input, out) => {
    expect(sanitize(input, 600)).toBe(out);
  });

  it("§5.8 cuts: at the last space that fits, else the ellipsis alone", () => {
    expect(sanitize("see www and more", 11)).toBe("see www ...");
    expect(sanitize("see www and more", 10)).toBe("see ...");
    expect(sanitize("abcdefghijkl", 8)).toBe("...");
  });

  it("maps typographic marks to ASCII and every listed space to one space", () => {
    expect(sanitize("‘a’ ‚b′ “c” „d″", 600)).toBe(`'a' 'b' "c" "d"`);
    expect(sanitize("a‐b‑c‒d–e—f―g−h", 600)).toBe("a-b-c-d-e-f-g-h");
    expect(sanitize("wait… a→b b←a ≈1 2×3", 600)).toBe("wait... a->b b<-a ~1 2x3");
    const spaces = ["\u0000", "\u001F", "\u007F", "\u0085", "\u009F", " ", " ", " ", " ", " ", " ", " ", "　"];
    expect(sanitize(spaces.map((s, i) => `w${i}${s}`).join(""), 600)).toBe(spaces.map((_, i) => `w${i}`).join(" "));
  });

  it("drops every other code point, lone surrogates and zero-width marks included", () => {
    expect(sanitize("café ü​ber \uD800x 中文 \u{1F4C8}up", 600)).toBe("caf ber x up");
    expect(sanitize("\u{1F680}\u{1F680}", 600)).toBe(NO_TEXT);
  });

  it("strips URLs, long hex, keys and long tokens in that order", () => {
    expect(sanitize("see ftp://x.y/z, http://a and www.b", 600)).toBe("see [url] [url] and [url]");
    expect(sanitize(`0x${"F".repeat(64)} and ${"c".repeat(70)}`, 600)).toBe("[hex] and [hex]");
    expect(sanitize(`ghp_${"a".repeat(20)} github_pat_${"b".repeat(20)} xoxb-${"1".repeat(10)} AKIA${"Q".repeat(16)}`, 600)).toBe("[key] [key] [key] [key]");
    expect(sanitize("-----BEGIN PRIVATE KEY----- MIIE", 600)).toBe("[key] MIIE");
    expect(sanitize(`id ${"a1/".repeat(14)}== tail`, 600)).toBe("id [key] tail");
  });

  it("caps at max characters on a whole word, never inside one", () => {
    const text = "alpha beta gamma delta";
    expect(sanitize(text, text.length)).toBe(text);
    expect(sanitize(text, text.length - 1)).toBe("alpha beta gamma ...");
    expect(sanitize(text, 20)).toBe("alpha beta gamma ...");
    expect(sanitize(text, 19)).toBe("alpha beta ...");
    // A cut that kept "www" before the ellipsis would read as a URL to the publisher; a cut on a space cannot.
    expect(sanitize("www and more", 10)).toBe("www ...");
    expect(URL_RE.test("www ...")).toBe(false);
    for (let max = 3; max <= 600; max += 37) expect(sanitize("word ".repeat(200), max).length).toBeLessThanOrEqual(max);
  });

  it("never leaves a match of the four patterns in its output", () => {
    const nasty = `see https://x.io/a?b=1 ${"d".repeat(64)} sk-${"k".repeat(20)} ${"Z".repeat(41)} www.q NVDAc.price`;
    const out = sanitize(nasty, 600);
    for (const re of [URL_RE, HEX_RE, KEY_RE, LONG_RE]) expect(new RegExp(re.source, re.flags.replace("g", "")).test(out)).toBe(false);
  });

  it("cutTo picks the longest cut that is at most max characters", () => {
    expect(cutTo("a bb ccc", 8)).toBe("a bb ccc");
    expect(cutTo("a bb ccc", 7)).toBe("a ...");
    expect(cutTo("a bb ccc", 5)).toBe("a ...");
    expect(cutTo("a bb ccc", 4)).toBe("...");
  });
});
