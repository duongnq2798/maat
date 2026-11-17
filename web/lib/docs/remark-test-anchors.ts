import { replaceSource } from "fumadocs-core/mdx-plugins/stringifier";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SITE } from "../site";
import type { MdNode } from "./remark-facts";

// Relative imports only: source.config.ts loads this file through the fumadocs-mdx bundler, outside Next.

type Replace = Parameters<typeof replaceSource>;

/** For each test file, by repo path, the line each of its tests starts on, by name or title. */
export type TestLines = Readonly<Record<string, Readonly<Record<string, number>>>>;

/**
 * The tests of one file: `function test_x(` in a .t.sol file; in a .test.ts file, `it("...")` and `describe("...")`,
 * also after modifiers such as `describe.skipIf(!RPC)("...")` or `it.each([...])("...")`, whose arguments may hold one
 * level of nested parentheses, as in `describe.skipIf(!fn())("...")`.
 */
export function testLinesIn(file: string, text: string): Record<string, number> {
  const test = file.endsWith(".sol") ? /^\s*function\s+(test\w*)\s*\(/g : /\b(?:it|describe)(?:\.\w+(?:\((?:[^()]|\([^()]*\))*\))?)*\("([^"\n]*)"/g;
  const out: Record<string, number> = {};
  text.split(/\r?\n/).forEach((line, i) => {
    for (const [, name = ""] of line.matchAll(test)) out[name] ??= i + 1;
  });
  return out;
}

/** The line of every test in contracts/test (*.t.sol) and agent/test (*.test.ts), by file in path order: tests.json. */
export function collectTestLines(root: string): TestLines {
  const files: string[] = [];
  const walk = (dir: string, suffix: string) => {
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel, suffix);
      else if (e.name.endsWith(suffix)) files.push(rel);
    }
  };
  walk("contracts/test", ".t.sol");
  walk("agent/test", ".test.ts");
  const out: Record<string, Record<string, number>> = {};
  for (const file of files.sort()) {
    const tests = testLinesIn(file, readFileSync(join(root, file), "utf8"));
    if (Object.keys(tests).length > 0) out[file] = tests;
  }
  return out;
}

interface Link extends MdNode {
  url?: string;
  title?: string | null;
}

export interface TestAnchorOptions {
  /** content/generated/tests.json, relative to the working directory like defineDocs' `dir`. */
  testsFile?: string;
  /** Overrides the lines read from testsFile, for tests. */
  lines?: TestLines;
}

const BLOB = `${SITE.repoUrl}/blob/main/`;

/** The test a link names: its text, alone in the link and in code or plain, when it opens a file on main with no anchor. */
function citedTest(link: Link): { file: string; name: string } | null {
  const [only, ...rest] = link.children ?? [];
  if (!only || rest.length > 0 || (only.type !== "inlineCode" && only.type !== "text") || !only.value) return null;
  if (!link.url?.startsWith(BLOB) || /[#?]/.test(link.url)) return null;
  return { file: link.url.slice(BLOB.length), name: only.value };
}

/**
 * Points every repo link whose text is a test, such as [`test_replayReverts`](<repo>/blob/main/contracts/test/
 * MandateVault.t.sol), at the line that test starts on (#L170), in the HTML page and in the Markdown copies alike. The
 * lines come from content/generated/tests.json, which docs:gen writes and test/docs-gen.test.ts keeps current, so a test
 * that moves fails that test until the lines are regenerated. A link whose file does not define the test is left as it
 * is; test/docs-content.test.ts fails on it. Runs after remarkComponentText.
 */
export function remarkTestAnchors(options: TestAnchorOptions = {}) {
  const testsFile = options.testsFile ?? "content/generated/tests.json";
  return (tree: MdNode, file: { path?: string; data?: { _compiler?: { addDependency?: (file: string) => void } } }) => {
    let lines = options.lines;
    // Read when a page cites a test, and registered with the bundler as remarkComponentText registers the pages it reads,
    // so in next dev a regenerated tests.json recompiles the pages that link a test.
    const read = (): TestLines => {
      if (lines === undefined) {
        file.data?._compiler?.addDependency?.(resolve(testsFile));
        lines = JSON.parse(readFileSync(testsFile, "utf8")) as TestLines;
      }
      return lines;
    };
    const walk = (parent: MdNode) => {
      for (const node of (parent.children ?? []) as Link[]) {
        const test = node.type === "link" ? citedTest(node) : null;
        const line = test ? read()[test.file]?.[test.name] : undefined;
        if (line === undefined) {
          walk(node);
          continue;
        }
        const url = `${node.url}#L${line}`;
        node.url = url;
        // The Markdown copies are sliced from the authored source, which still has the bare URL; s.inner keeps the edits
        // other plugins made to the link's text.
        const title = node.title ? ` "${node.title}"` : "";
        replaceSource(file as Replace[0], node as Replace[1], (s) => `[${s.inner(node as never)}](${url}${title})`);
      }
    };
    walk(tree);
  };
}
