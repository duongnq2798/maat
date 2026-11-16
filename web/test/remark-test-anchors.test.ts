// @vitest-environment node
import { createStringifier } from "fumadocs-core/mdx-plugins/stringifier";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { MdNode } from "@/lib/docs/remark-facts";
import { collectTestLines, remarkTestAnchors, type TestLines, testLinesIn } from "@/lib/docs/remark-test-anchors";
import { SITE } from "@/lib/site";

describe("testLinesIn", () => {
  it("records the line each Solidity test function starts on, whatever the line endings", () => {
    const sol = [
      "contract T {",
      "    function setUp() public {}",
      "",
      "    function test_a() public {",
      "    }",
      "    // function test_old() public {}",
      "    function test_b_c() public view {}",
      "    function helper_test_x() internal {}",
      "}",
    ].join("\r\n");
    expect(testLinesIn("contracts/test/T.t.sol", sol)).toEqual({ test_a: 4, test_b_c: 7 });
  });

  it("records the line of each Vitest it() and describe() title", () => {
    const ts = [
      'describe("the group", () => {',
      '  it("does a thing", async () => {',
      "  });",
      '  it("does, as well, another thing", () => {});',
      "  const it2 = 1;",
      "});",
    ].join("\n");
    expect(testLinesIn("agent/test/x.test.ts", ts)).toEqual({ "the group": 1, "does a thing": 2, "does, as well, another thing": 4 });
  });

  it("reads a title after a modifier, with or without arguments, as in describe.skipIf(!RPC)(\"...\")", () => {
    const ts = [
      'describe.skipIf(!RPC)("agent on a Base fork", () => {',
      '  it.skip("is skipped", () => {});',
      '  it.each([1, 2])("case %s", () => {});',
      '  it.concurrent.only("runs alone", () => {});',
      '  const s = split("not a title");',
      "});",
    ].join("\n");
    expect(testLinesIn("agent/test/integration/x.fork.test.ts", ts)).toEqual({
      "agent on a Base fork": 1,
      "is skipped": 2,
      "case %s": 3,
      "runs alone": 4,
    });
  });
});

describe("collectTestLines", () => {
  it("reads the .t.sol files under contracts/test and the .test.ts files under agent/test, sorted by path", () => {
    const root = mkdtempSync(join(tmpdir(), "maat-tests-"));
    const put = (rel: string, text: string) => {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), text);
    };
    try {
      put("contracts/test/V.t.sol", "contract V {\n    function test_v() public {}\n}\n");
      put("contracts/test/fork/A.t.sol", "contract A {\n\n    function test_a() public {}\n}\n");
      put("contracts/test/mocks/M.sol", "contract M {\n    function test_mock() public {}\n}\n");
      put("contracts/test/utils/Empty.t.sol", "contract E {}\n");
      put("agent/test/b.test.ts", 'it("b", () => {});\n');
      put("agent/test/fakes/fake.ts", 'it("not a test file", () => {});\n');
      put("agent/test/integration/c.fork.test.ts", '\ndescribe("c", () => {});\n');
      expect(collectTestLines(root)).toEqual({
        "agent/test/b.test.ts": { b: 1 },
        "agent/test/integration/c.fork.test.ts": { c: 2 },
        "contracts/test/V.t.sol": { test_v: 2 },
        "contracts/test/fork/A.t.sol": { test_a: 3 },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

const VAULT = `${SITE.repoUrl}/blob/main/contracts/test/MandateVault.t.sol`;
const RUN_ONCE = `${SITE.repoUrl}/blob/main/agent/test/runOnce.test.ts`;
const LINES: TestLines = {
  "contracts/test/MandateVault.t.sol": { test_replayReverts: 170 },
  "agent/test/runOnce.test.ts": { "halts when the preview said OK but the vault refused": 357 },
};

/** A one-line paragraph of links, each with the offsets it has in `source`, as remark-mdx would parse it. */
function paragraph(source: string, links: { label: string; url: string; code: boolean }[]): MdNode {
  const at = (start: number, end: number) => ({ start: { line: 1, column: start + 1, offset: start }, end: { line: 1, column: end + 1, offset: end } });
  let from = 0;
  const children = links.map(({ label, url, code }) => {
    const text = code ? `\`${label}\`` : label;
    const start = source.indexOf(`[${text}](${url})`, from);
    if (start < 0) throw new Error(`no link to ${label} in the source`);
    from = start + 1;
    const end = start + `[${text}](${url})`.length;
    return {
      type: "link",
      url,
      children: [{ type: code ? "inlineCode" : "text", value: label, position: at(start + 1, start + 1 + text.length) }],
      position: at(start, end),
    } as MdNode;
  });
  return { type: "root", children: [{ type: "paragraph", children, position: at(0, source.length) }], position: at(0, source.length) };
}

/** Runs the plugin, then prints the Markdown the way Fumadocs' processed Markdown does. */
function run(source: string, root: MdNode, lines?: TestLines) {
  const file = { path: "content/docs/security/model.mdx", toString: () => source };
  remarkTestAnchors(lines ? { lines } : {})(root, file);
  return createStringifier(file as never).stringify(root as never);
}

const urls = (root: MdNode) => (root.children![0]!.children as (MdNode & { url: string })[]).map((l) => l.url);

describe("remarkTestAnchors", () => {
  it("points a link whose text is a test name at the test's line, in the HTML and in the Markdown", () => {
    const source = `Replay: [\`test_replayReverts\`](${VAULT}). Halt: [halts when the preview said OK but the vault refused](${RUN_ONCE}).`;
    const root = paragraph(source, [
      { label: "test_replayReverts", url: VAULT, code: true },
      { label: "halts when the preview said OK but the vault refused", url: RUN_ONCE, code: false },
    ]);
    const markdown = run(source, root, LINES);
    expect(urls(root)).toEqual([`${VAULT}#L170`, `${RUN_ONCE}#L357`]);
    expect(markdown).toBe(
      `Replay: [\`test_replayReverts\`](${VAULT}#L170). Halt: [halts when the preview said OK but the vault refused](${RUN_ONCE}#L357).`,
    );
  });

  it("leaves a link to a file, a name its file does not define, a link with an anchor and another repository's link", () => {
    const other = "https://github.com/other/repo/blob/main/contracts/test/MandateVault.t.sol";
    const links = [
      { label: "MandateVault.t.sol", url: VAULT, code: false },
      { label: "test_unknown", url: VAULT, code: true },
      { label: "test_replayReverts", url: `${VAULT}#L1`, code: true },
      { label: "test_replayReverts", url: other, code: true },
    ];
    const source = links.map((l) => `[${l.code ? `\`${l.label}\`` : l.label}](${l.url})`).join(", ");
    const root = paragraph(source, links);
    expect(run(source, root, LINES)).toBe(source);
    expect(urls(root)).toEqual(links.map((l) => l.url));
  });

  it("reads the lines from content/generated/tests.json by default", () => {
    const committed = JSON.parse(readFileSync("content/generated/tests.json", "utf8")) as TestLines;
    const line = committed["contracts/test/MandateVault.t.sol"]?.test_replayReverts;
    expect(line).toBeGreaterThan(0);
    const source = `[\`test_replayReverts\`](${VAULT})`;
    const root = paragraph(source, [{ label: "test_replayReverts", url: VAULT, code: true }]);
    expect(run(source, root)).toBe(`[\`test_replayReverts\`](${VAULT}#L${line})`);
  });
});
