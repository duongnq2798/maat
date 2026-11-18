// Tests for ci-counts.mjs. Run with `node --test`, locally and in the CI summary job.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { annotation, escapeData, escapeProperty, extractResult, firstLine, readForge, readPlaywright, readVitest, ReportError, workspacePath } from "./ci-counts.mjs";

import { readGitleaks, renderSummary } from "./ci-counts.mjs";

const SCRIPT = fileURLToPath(new URL("./ci-counts.mjs", import.meta.url));
const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
const OWN_VARS = ["GITHUB_OUTPUT", "GITHUB_STEP_SUMMARY", "GITHUB_WORKSPACE", "STEP_OUTCOME", "SCAN_EXIT", "COMMITS", "NEEDS_JSON"];
// A GitHub token, a 32-byte hex value, and an RPC URL with a provider's key in its path (spec 5.3).
const KEY_SHAPES = [
  /ghp_[0-9A-Za-z]{36}/,
  /0x[0-9a-fA-F]{64}/,
  /https:\/\/[a-z0-9.-]*(?:alchemy\.com\/v2|infura\.io\/v3|quiknode\.pro|api\.developer\.coinbase\.com\/rpc\/v1\/[a-z-]+)\/[A-Za-z0-9_-]{16,}/i,
];

/** @param {Record<string, string>} overrides @returns {NodeJS.ProcessEnv} process.env minus OWN_VARS, plus overrides */
function childEnv(overrides) {
  const env = { ...process.env };
  for (const name of OWN_VARS) delete env[name];
  return { ...env, ...overrides };
}

/**
 * @param {string[]} args @param {{ env?: Record<string, string>, cwd?: string }} [options]
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function runCli(args, options = {}) {
  const run = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: options.cwd, env: childEnv(options.env ?? {}), encoding: "utf8" });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

/** @returns {string} a new empty directory under the OS temp directory */
function tempDir() {
  return mkdtempSync(path.join(os.tmpdir(), "ci-counts-"));
}

/** @param {string} file @returns {string[]} the file's non-empty lines, split on /\r?\n/ */
function outputLines(file) {
  return readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line !== "");
}

describe("annotation escaping", () => {
  test("escapeData escapes %, CR and LF and leaves : and , alone", () => {
    assert.equal(escapeData("100% done\r\nnext: a,b"), "100%25 done%0D%0Anext: a,b");
  });

  test("escapeProperty also escapes : and ,", () => {
    assert.equal(escapeProperty("a%b\r\nc:d,e"), "a%25b%0D%0Ac%3Ad%2Ce");
  });

  test("a test name with , : % and :: and a reason over two lines give one line", () => {
    const line = annotation({
      file: "contracts/test/Odd,Name:1%.t.sol",
      title: "OddTest › test_a,b:c%d::e()",
      reason: firstLine("first line of the reason\nsecond line"),
    });
    assert.equal(line, "::error file=contracts/test/Odd%2CName%3A1%25.t.sol::OddTest › test_a,b:c%25d::e(): first line of the reason");
  });

  test("a line break in a title is escaped, never printed", () => {
    const line = annotation({ file: "web/e2e/smoke.spec.ts", title: "smoke.spec.ts › two\nlines\r", reason: "" });
    assert.equal(line, "::error file=web/e2e/smoke.spec.ts::smoke.spec.ts › two%0Alines%0D");
    assert.doesNotMatch(line, /[\r\n]/);
  });

  test("an empty reason leaves the title on its own", () => {
    assert.equal(annotation({ file: "agent/x.ts", title: "a title", reason: "" }), "::error file=agent/x.ts::a title");
  });
});

describe("firstLine", () => {
  test("gives the first line that is not blank, trimmed", () => {
    assert.equal(firstLine("\n   \r\n  assertion failed: 0 != 1  \nnext line"), "assertion failed: 0 != 1");
  });

  test("splits on CRLF, CR and LF alike", () => {
    for (const reason of ["one\r\ntwo", "one\rtwo", "one\ntwo"]) assert.equal(firstLine(reason), "one", JSON.stringify(reason));
  });

  test("removes ANSI colour codes", () => {
    assert.equal(firstLine("\u001b[31mError:\u001b[39m expect(\u001b[2mlocator\u001b[22m).toBeVisible()"), "Error: expect(locator).toBeVisible()");
  });

  test("gives an empty string when every line is blank", () => {
    for (const reason of ["", " \n\t\r\n", "\u001b[31m\u001b[39m"]) assert.equal(firstLine(reason), "", JSON.stringify(reason));
  });

  test("never truncates a long line", () => {
    const long = "x".repeat(5000);
    assert.equal(firstLine(long), long);
  });
});

describe("workspacePath", () => {
  test("is relative to the workspace and uses forward slashes on every OS", () => {
    const workspace = tempDir();
    const file = path.join(workspace, "contracts", "test", "MandateVault.t.sol");
    assert.equal(workspacePath(workspace, file), "contracts/test/MandateVault.t.sol");
    // A Windows shell may spell the workspace with forward slashes; on Linux this is the same string.
    assert.equal(workspacePath(workspace.split(path.sep).join("/"), file), "contracts/test/MandateVault.t.sol");
  });
});

describe("childEnv", () => {
  test("drops the runner's own variables, then sets the ones a case names", () => {
    const saved = OWN_VARS.map((name) => [name, process.env[name]]);
    try {
      for (const name of OWN_VARS) process.env[name] = "set-by-the-runner";
      const env = childEnv({ STEP_OUTCOME: "success" });
      assert.equal(env.STEP_OUTCOME, "success");
      for (const name of OWN_VARS.filter((own) => own !== "STEP_OUTCOME")) assert.equal(env[name], undefined, name);
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});

describe("fixture guard", () => {
  test("the key shapes catch values built at run time", () => {
    assert.match("ghp_" + "a".repeat(36), KEY_SHAPES[0]);
    assert.match("0x" + "ab".repeat(32), KEY_SHAPES[1]);
    assert.match("https://base-mainnet.g.alchemy.com/v2/" + "A".repeat(20), KEY_SHAPES[2]);
  });

  test("no fixture holds a key-shaped string", () => {
    const names = readdirSync(FIXTURES);
    assert.ok(names.length >= 15, `${names.length} fixtures`);
    for (const name of names) {
      const text = readFileSync(path.join(FIXTURES, name), "utf8");
      // assert.ok, so that a failure names the file and the shape but never prints the matching text.
      for (const shape of KEY_SHAPES) assert.ok(!shape.test(text), `${name} holds a string shaped like ${shape}`);
    }
  });

  test("every gitleaks fixture finding has REDACTED in Secret, Match and Line", () => {
    for (const name of readdirSync(FIXTURES).filter((file) => /^gitleaks-.*\.json$/.test(file))) {
      for (const finding of JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8"))) {
        for (const field of ["Secret", "Match", "Line"]) assert.ok(finding[field] === "REDACTED", `${name}: ${field}`);
      }
    }
  });
});

describe("readForge", () => {
  const forgeFixture = (name) => JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8"));
  // The contracts step runs in <workspace>/contracts.
  const where = (workspace) => ({ workspace, cwd: path.join(workspace, "contracts") });

  test("counts every test result in every suite", () => {
    assert.deepEqual(readForge(forgeFixture("forge-pass.json"), where(tempDir())), { counts: { passed: 3, failed: 0, skipped: 0 }, failures: [] });
    assert.deepEqual(readForge(forgeFixture("forge-skip.json"), where(tempDir())), { counts: { passed: 1, failed: 0, skipped: 1 }, failures: [] });
  });

  test("names each failure by contract and test, in a file relative to the workspace", () => {
    assert.deepEqual(readForge(forgeFixture("forge-fail.json"), where(tempDir())), {
      counts: { passed: 1, failed: 1, skipped: 0 },
      failures: [{ file: "contracts/test/MandateVault.t.sol", title: "MandateVaultTest › test_refusesStaleFeed()", reason: "assertion failed: 0 != 1" }],
    });
  });

  test("a failure with no reason, or a null one, keeps an empty reason", () => {
    const report = {
      "test/GuardLib.t.sol:GuardLibTest": { test_results: { "test_paused()": { status: "Failure" }, "test_okReturnsOraclePrice()": { status: "Failure", reason: null } } },
    };
    assert.deepEqual(readForge(report, where(tempDir())).failures.map((failure) => failure.reason), ["", ""]);
  });

  test("throws a ReportError for anything that is not a forge report", () => {
    const workspace = tempDir();
    const suite = (results) => ({ "test/GuardLib.t.sol:GuardLibTest": { test_results: results } });
    const cases = [
      null,
      [],
      "a string",
      { "test/GuardLib.t.sol": { test_results: {} } },
      { ":GuardLibTest": { test_results: {} } },
      { "test/GuardLib.t.sol:GuardLibTest": {} },
      suite([]),
      suite({ "test_paused()": null }),
      suite({ "test_paused()": { status: "Passed" } }),
      suite({ "test_paused()": { status: "Success", reason: 7 } }),
    ];
    cases.forEach((report, index) => assert.throws(() => readForge(report, where(workspace)), ReportError, `case ${index}`));
  });
});

describe("readVitest", () => {
  const vitestFixture = (name) => JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8"));

  test("takes the totals, with pending and todo tests as skipped, and no failures", () => {
    assert.deepEqual(readVitest(vitestFixture("vitest-pass.json")), { counts: { passed: 3, failed: 0, skipped: 0 }, failures: [] });
    assert.deepEqual(readVitest(vitestFixture("vitest-fail.json")), { counts: { passed: 2, failed: 1, skipped: 0 }, failures: [] });
    assert.deepEqual(readVitest(vitestFixture("vitest-skip.json")), { counts: { passed: 2, failed: 0, skipped: 2 }, failures: [] });
  });

  test("throws a ReportError unless the four totals are non-negative integers", () => {
    const totals = { numPassedTests: 1, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0 };
    assert.doesNotThrow(() => readVitest(totals));
    const cases = [
      null,
      [],
      vitestFixture("vitest-malformed.json"),
      { ...totals, numFailedTests: -1 },
      { ...totals, numPendingTests: 1.5 },
      { ...totals, numTodoTests: "0" },
    ];
    cases.forEach((report, index) => assert.throws(() => readVitest(report), ReportError, `case ${index}`));
  });
});

describe("readPlaywright", () => {
  // The fixtures carry a GitHub runner's rootDir; a test points it into its own temp workspace.
  const playwrightFixture = (name, rootDir) => {
    const report = JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8"));
    if (rootDir !== undefined) report.config.rootDir = rootDir;
    return report;
  };
  const FAILURE = {
    file: "web/e2e/smoke.spec.ts",
    title: "smoke.spec.ts › the landing page › the moment toggle works by mouse and keyboard",
    reason: "Error: expect(locator).toHaveAttribute(expected) failed",
  };
  const failedResults = (report) => report.suites[0].suites[0].specs[0].tests[0].results;

  test("takes the stats, and annotates neither skipped nor flaky tests", () => {
    const workspace = tempDir();
    const rootDir = path.join(workspace, "web", "e2e");
    assert.deepEqual(readPlaywright(playwrightFixture("playwright-pass.json", rootDir), { workspace }), {
      counts: { passed: 2, failed: 0, skipped: 0, flaky: 0 },
      failures: [],
    });
    assert.deepEqual(readPlaywright(playwrightFixture("playwright-skip.json", rootDir), { workspace }), {
      counts: { passed: 1, failed: 0, skipped: 1, flaky: 1 },
      failures: [],
    });
  });

  test("names each unexpected test by file, describe titles and title, relative to the workspace", () => {
    const workspace = tempDir();
    const native = path.join(workspace, "web", "e2e");
    const expected = { counts: { passed: 1, failed: 1, skipped: 0, flaky: 0 }, failures: [FAILURE] };
    assert.deepEqual(readPlaywright(playwrightFixture("playwright-fail.json", native), { workspace }), expected);
    // Playwright writes rootDir with forward slashes on every OS.
    assert.deepEqual(readPlaywright(playwrightFixture("playwright-fail.json", native.split(path.sep).join("/")), { workspace }), expected);
  });

  test("takes the reason from the last result that has an error message", () => {
    const workspace = tempDir();
    const report = playwrightFixture("playwright-fail.json", path.join(workspace, "web", "e2e"));
    const results = failedResults(report);
    results.push({ ...results[0], retry: 1, error: { message: "\n\u001b[31mTimeout 5000ms exceeded.\u001b[39m\r\nCall log:" } });
    results.push({ ...results[0], retry: 2, error: undefined });
    assert.equal(readPlaywright(report, { workspace }).failures[0].reason, "Timeout 5000ms exceeded.");
  });

  test("an unexpected test with no error message keeps an empty reason", () => {
    const workspace = tempDir();
    const report = playwrightFixture("playwright-fail.json", path.join(workspace, "web", "e2e"));
    for (const result of failedResults(report)) delete result.error;
    assert.deepEqual(readPlaywright(report, { workspace }).failures, [{ ...FAILURE, reason: "" }]);
  });

  test("throws a ReportError for anything that is not a playwright report", () => {
    const workspace = tempDir();
    const good = playwrightFixture("playwright-pass.json");
    assert.doesNotThrow(() => readPlaywright(good, { workspace }));
    const cases = [
      null,
      [],
      playwrightFixture("playwright-malformed.json"),
      { ...good, config: { ...good.config, rootDir: 7 } },
      { ...good, config: null },
      { ...good, suites: {} },
      { ...good, stats: { ...good.stats, flaky: undefined } },
      { ...good, stats: { ...good.stats, unexpected: -1 } },
    ];
    cases.forEach((report, index) => assert.throws(() => readPlaywright(report, { workspace }), ReportError, `case ${index}`));
  });
});

describe("extractResult", () => {
  const fixtureText = (name) => readFileSync(path.join(FIXTURES, name), "utf8");
  const workspace = tempDir();
  const cwd = path.join(workspace, "contracts");
  const TEST_KINDS = ["forge", "vitest", "playwright"];

  test("an absent report is missing, exit 0, unless its step succeeded", () => {
    for (const kind of TEST_KINDS) {
      for (const outcome of ["failure", "cancelled", "skipped", undefined]) {
        assert.deepEqual(
          extractResult(kind, null, { GITHUB_WORKSPACE: workspace, STEP_OUTCOME: outcome }, cwd),
          { code: 0, output: { report: "missing" }, annotations: [] },
          `${kind} ${outcome}`,
        );
      }
    }
  });

  test("an absent report exits 1 when its step succeeded", () => {
    for (const kind of TEST_KINDS) {
      assert.deepEqual(extractResult(kind, null, { GITHUB_WORKSPACE: workspace, STEP_OUTCOME: "success" }, cwd), {
        code: 1,
        annotations: [],
        message: `the ${kind} report is missing, but the step that writes it succeeded`,
      });
    }
  });

  test("an empty, non-JSON or wrongly shaped report exits 1 whatever the outcome", () => {
    const cases = [
      ["forge", ""],
      ["forge", fixtureText("forge-malformed.json")],
      ["forge", "[]"],
      ["vitest", ""],
      ["vitest", fixtureText("vitest-malformed.json")],
      ["vitest", "{"],
      ["playwright", ""],
      ["playwright", fixtureText("playwright-malformed.json")],
      ["playwright", "null"],
    ];
    for (const [kind, reportText] of cases) {
      for (const outcome of ["success", "failure"]) {
        const result = extractResult(kind, reportText, { GITHUB_WORKSPACE: workspace, STEP_OUTCOME: outcome }, cwd);
        assert.equal(result.code, 1, `${kind} ${outcome} ${JSON.stringify(reportText.slice(0, 12))}`);
        assert.equal(result.output, undefined);
      }
    }
  });

  test("a report with zero tests exits 1 whatever the outcome", () => {
    for (const kind of TEST_KINDS) {
      for (const outcome of ["success", "failure"]) {
        assert.deepEqual(extractResult(kind, fixtureText(`${kind}-zero.json`), { GITHUB_WORKSPACE: workspace, STEP_OUTCOME: outcome }, cwd), {
          code: 1,
          annotations: [],
          message: `the ${kind} report ran no test`,
        });
      }
    }
    // Skipped and todo tests did not run; a flaky test did.
    const env = { GITHUB_WORKSPACE: workspace, STEP_OUTCOME: "success" };
    const pending = { ...JSON.parse(fixtureText("vitest-zero.json")), numPendingTests: 2, numTodoTests: 1 };
    assert.deepEqual(extractResult("vitest", JSON.stringify(pending), env, cwd), { code: 1, annotations: [], message: "the vitest report ran no test" });
    const e2e = JSON.parse(fixtureText("playwright-zero.json"));
    const skipped = { ...e2e, stats: { ...e2e.stats, skipped: 2 } };
    assert.deepEqual(extractResult("playwright", JSON.stringify(skipped), env, cwd), { code: 1, annotations: [], message: "the playwright report ran no test" });
    const flaky = { ...e2e, stats: { ...e2e.stats, flaky: 1 } };
    assert.deepEqual(extractResult("playwright", JSON.stringify(flaky), env, cwd), {
      code: 0,
      output: { passed: 0, failed: 0, skipped: 0, flaky: 1 },
      annotations: [],
    });
  });

  test("a valid report gives its counts, with one annotation per forge or playwright failure", () => {
    const env = { GITHUB_WORKSPACE: workspace, STEP_OUTCOME: "failure" };
    const e2e = JSON.parse(fixtureText("playwright-fail.json"));
    e2e.config.rootDir = path.join(workspace, "web", "e2e");
    assert.deepEqual(extractResult("forge", fixtureText("forge-fail.json"), env, cwd), {
      code: 0,
      output: { passed: 1, failed: 1, skipped: 0 },
      annotations: ["::error file=contracts/test/MandateVault.t.sol::MandateVaultTest › test_refusesStaleFeed(): assertion failed: 0 != 1"],
    });
    assert.deepEqual(extractResult("vitest", fixtureText("vitest-fail.json"), env, cwd), {
      code: 0,
      output: { passed: 2, failed: 1, skipped: 0 },
      annotations: [],
    });
    assert.deepEqual(extractResult("playwright", JSON.stringify(e2e), env, cwd), {
      code: 0,
      output: { passed: 1, failed: 1, skipped: 0, flaky: 0 },
      annotations: [
        "::error file=web/e2e/smoke.spec.ts::smoke.spec.ts › the landing page › the moment toggle works by mouse and keyboard: Error: expect(locator).toHaveAttribute(expected) failed",
      ],
    });
  });

  test("the output keys keep a fixed order", () => {
    const shuffled = JSON.stringify({ numTodoTests: 1, numPendingTests: 1, numFailedTests: 2, numPassedTests: 3 });
    assert.equal(JSON.stringify(extractResult("vitest", shuffled, {}, cwd).output), '{"passed":3,"failed":2,"skipped":2}');
    const e2e = JSON.parse(fixtureText("playwright-skip.json"));
    e2e.stats = { flaky: 1, skipped: 1, unexpected: 0, expected: 1 };
    assert.equal(
      JSON.stringify(extractResult("playwright", JSON.stringify(e2e), { GITHUB_WORKSPACE: workspace }, cwd).output),
      '{"passed":1,"failed":0,"skipped":1,"flaky":1}',
    );
  });

  test("an unknown kind gives the usage", () => {
    assert.deepEqual(extractResult("jest", "{}", {}, cwd), {
      code: 1,
      annotations: [],
      message: "usage: ci-counts.mjs extract <forge|vitest|playwright|gitleaks> <report.json> <output-name> | render",
    });
  });
});

describe("extract on the command line", () => {
  const USAGE = "usage: ci-counts.mjs extract <forge|vitest|playwright|gitleaks> <report.json> <output-name> | render\n";
  const TEST_KINDS = ["forge", "vitest", "playwright"];
  const fixture = (name) => path.join(FIXTURES, name);

  test("prints the usage and exits 1 for any other argument list", () => {
    const output = path.join(tempDir(), "github-output.txt");
    const argLists = [
      [],
      ["extract", "forge", "report.json"],
      ["extract", "forge", "report.json", "forge", "extra"],
      ["extract", "jest", "report.json", "unit"],
      ["count", "forge", "report.json", "forge"],
    ];
    for (const args of argLists) {
      const run = runCli(args, { env: { GITHUB_OUTPUT: output, STEP_OUTCOME: "success" } });
      assert.deepEqual([run.status, run.stdout, run.stderr], [1, "", USAGE], args.join(" "));
    }
    assert.equal(existsSync(output), false);
  });

  test("exits 1 naming GITHUB_OUTPUT when it is unset or empty, before it reads the report", () => {
    const absent = path.join(tempDir(), "absent.json");
    for (const env of [{ STEP_OUTCOME: "success" }, { GITHUB_OUTPUT: "", STEP_OUTCOME: "success" }]) {
      const run = runCli(["extract", "vitest", absent, "unit"], { env });
      assert.deepEqual([run.status, run.stdout, run.stderr], [1, "", "GITHUB_OUTPUT is not set\n"]);
    }
  });

  test("exits 1 naming GITHUB_WORKSPACE for forge and playwright when it is unset or empty", () => {
    for (const kind of ["forge", "playwright"]) {
      for (const workspaceEnv of [{}, { GITHUB_WORKSPACE: "" }]) {
        const output = path.join(tempDir(), "github-output.txt");
        const run = runCli(["extract", kind, fixture(`${kind}-pass.json`), kind], {
          env: { ...workspaceEnv, GITHUB_OUTPUT: output, STEP_OUTCOME: "success" },
        });
        assert.deepEqual([run.status, run.stdout, run.stderr], [1, "", "GITHUB_WORKSPACE is not set\n"], kind);
        assert.equal(existsSync(output), false);
      }
    }
  });

  test("an absent report whose step did not succeed, or whose STEP_OUTCOME is unset, writes missing and exits 0", () => {
    for (const kind of TEST_KINDS) {
      for (const outcome of ["failure", "cancelled", undefined]) {
        const dir = tempDir();
        const output = path.join(dir, "github-output.txt");
        const env = { GITHUB_OUTPUT: output, GITHUB_WORKSPACE: dir };
        if (outcome !== undefined) env.STEP_OUTCOME = outcome;
        const run = runCli(["extract", kind, path.join(dir, "absent.json"), "out"], { env, cwd: dir });
        assert.deepEqual([run.status, run.stdout, run.stderr], [0, "", ""], `${kind} ${outcome}`);
        assert.deepEqual(outputLines(output), ['out={"report":"missing"}']);
      }
    }
  });

  test("an absent report whose step succeeded exits 1 and writes nothing", () => {
    for (const kind of TEST_KINDS) {
      const dir = tempDir();
      const output = path.join(dir, "github-output.txt");
      const run = runCli(["extract", kind, path.join(dir, "absent.json"), "out"], {
        env: { GITHUB_OUTPUT: output, GITHUB_WORKSPACE: dir, STEP_OUTCOME: "success" },
        cwd: dir,
      });
      assert.deepEqual([run.status, run.stdout, run.stderr], [1, "", `the ${kind} report is missing, but the step that writes it succeeded\n`]);
      assert.equal(existsSync(output), false);
    }
  });

  test("a report that is unreadable, empty, not JSON or not its kind's shape exits 1 and writes nothing", () => {
    const dir = tempDir();
    const empty = path.join(dir, "empty.json");
    writeFileSync(empty, "");
    const wrongStatus = path.join(dir, "wrong-status.json");
    writeFileSync(wrongStatus, JSON.stringify({ "test/GuardLib.t.sol:GuardLibTest": { test_results: { "test_paused()": { status: "Passed" } } } }));
    const cases = [
      ["forge", dir],
      ["forge", empty],
      ["forge", fixture("forge-malformed.json")],
      ["forge", wrongStatus],
      ["vitest", fixture("vitest-malformed.json")],
      ["playwright", fixture("playwright-malformed.json")],
    ];
    for (const [kind, report] of cases) {
      const output = path.join(tempDir(), "github-output.txt");
      const run = runCli(["extract", kind, report, "out"], {
        env: { GITHUB_OUTPUT: output, GITHUB_WORKSPACE: dir, STEP_OUTCOME: "failure" },
        cwd: dir,
      });
      assert.equal(run.status, 1, `${kind} ${path.basename(report)}`);
      assert.equal(run.stdout, "");
      assert.match(run.stderr, /^(?:cannot read |the (?:forge|vitest|playwright) report is not )/);
      assert.equal(existsSync(output), false);
    }
  });

  test("a report with zero tests exits 1 and writes nothing", () => {
    for (const kind of TEST_KINDS) {
      const dir = tempDir();
      const output = path.join(dir, "github-output.txt");
      const run = runCli(["extract", kind, fixture(`${kind}-zero.json`), "out"], {
        env: { GITHUB_OUTPUT: output, GITHUB_WORKSPACE: dir, STEP_OUTCOME: "success" },
        cwd: dir,
      });
      assert.deepEqual([run.status, run.stdout, run.stderr], [1, "", `the ${kind} report ran no test\n`]);
      assert.equal(existsSync(output), false);
    }
  });

  test("forge, run from contracts/: appends the counts and prints one annotation per failure", () => {
    const workspace = tempDir();
    const contracts = path.join(workspace, "contracts");
    mkdirSync(contracts);
    const output = path.join(workspace, "github-output.txt");
    writeFileSync(output, "earlier=kept\n");
    const failure = "::error file=contracts/test/MandateVault.t.sol::MandateVaultTest › test_refusesStaleFeed(): assertion failed: 0 != 1\n";
    // The workspace with native separators, then with the forward slashes a Windows shell may pass.
    const runs = [
      ["forge-fail.json", workspace, "failure"],
      ["forge-fail.json", workspace.split(path.sep).join("/"), "failure"],
      ["forge-pass.json", workspace, "success"],
      ["forge-skip.json", workspace, "success"],
    ].map(([name, root, outcome]) =>
      runCli(["extract", "forge", fixture(name), "forge"], { env: { GITHUB_OUTPUT: output, GITHUB_WORKSPACE: root, STEP_OUTCOME: outcome }, cwd: contracts }),
    );
    assert.deepEqual(
      runs.map((run) => [run.status, run.stdout, run.stderr]),
      [
        [0, failure, ""],
        [0, failure, ""],
        [0, "", ""],
        [0, "", ""],
      ],
    );
    assert.deepEqual(outputLines(output), [
      "earlier=kept",
      'forge={"passed":1,"failed":1,"skipped":0}',
      'forge={"passed":1,"failed":1,"skipped":0}',
      'forge={"passed":3,"failed":0,"skipped":0}',
      'forge={"passed":1,"failed":0,"skipped":1}',
    ]);
  });

  test("vitest: appends the counts, prints nothing and needs no GITHUB_WORKSPACE", () => {
    const output = path.join(tempDir(), "github-output.txt");
    const runs = [
      ["vitest-pass.json", "success"],
      ["vitest-fail.json", "failure"],
      ["vitest-skip.json", "success"],
    ].map(([name, outcome]) => runCli(["extract", "vitest", fixture(name), "unit"], { env: { GITHUB_OUTPUT: output, STEP_OUTCOME: outcome } }));
    assert.deepEqual(
      runs.map((run) => [run.status, run.stdout, run.stderr]),
      [
        [0, "", ""],
        [0, "", ""],
        [0, "", ""],
      ],
    );
    assert.deepEqual(outputLines(output), [
      'unit={"passed":3,"failed":0,"skipped":0}',
      'unit={"passed":2,"failed":1,"skipped":0}',
      'unit={"passed":2,"failed":0,"skipped":2}',
    ]);
  });

  test("playwright: appends the counts and prints one annotation per unexpected test", () => {
    const workspace = tempDir();
    const output = path.join(workspace, "github-output.txt");
    // A temp copy of a fixture whose rootDir is the temp workspace's web/e2e.
    const copy = (name) => {
      const report = JSON.parse(readFileSync(fixture(name), "utf8"));
      report.config.rootDir = path.join(workspace, "web", "e2e");
      const file = path.join(workspace, name);
      writeFileSync(file, JSON.stringify(report));
      return file;
    };
    const runs = [
      ["playwright-fail.json", "failure"],
      ["playwright-pass.json", "success"],
      ["playwright-skip.json", "success"],
    ].map(([name, outcome]) =>
      runCli(["extract", "playwright", copy(name), "e2e"], { env: { GITHUB_OUTPUT: output, GITHUB_WORKSPACE: workspace, STEP_OUTCOME: outcome } }),
    );
    assert.deepEqual(
      runs.map((run) => [run.status, run.stdout, run.stderr]),
      [
        [
          0,
          "::error file=web/e2e/smoke.spec.ts::smoke.spec.ts › the landing page › the moment toggle works by mouse and keyboard: Error: expect(locator).toHaveAttribute(expected) failed\n",
          "",
        ],
        [0, "", ""],
        [0, "", ""],
      ],
    );
    assert.deepEqual(outputLines(output), [
      'e2e={"passed":1,"failed":1,"skipped":0,"flaky":0}',
      'e2e={"passed":2,"failed":0,"skipped":0,"flaky":0}',
      'e2e={"passed":1,"failed":0,"skipped":1,"flaky":1}',
    ]);
  });

  test("reads a report the same with CRLF line endings", () => {
    const dir = tempDir();
    const report = path.join(dir, "vitest-skip-crlf.json");
    writeFileSync(report, readFileSync(fixture("vitest-skip.json"), "utf8").replace(/\r?\n/g, "\r\n"));
    const output = path.join(dir, "github-output.txt");
    const run = runCli(["extract", "vitest", report, "unit"], { env: { GITHUB_OUTPUT: output, STEP_OUTCOME: "success" } });
    assert.deepEqual([run.status, run.stdout, run.stderr], [0, "", ""]);
    assert.deepEqual(outputLines(output), ['unit={"passed":2,"failed":0,"skipped":2}']);
  });
});

// extract gitleaks: one secret scan's exit code, report and commit count, as the hygiene job passes them.

/**
 * Runs `extract gitleaks` on a report written to a fresh temp directory, as the history_counts step does.
 * @param {string | null} reportText null leaves the report file absent
 * @param {Record<string, string>} scanEnv SCAN_EXIT and COMMITS, as the step's env: sets them
 * @returns {{ status: number | null, stdout: string, stderr: string, lines: string[] }}
 */
function gitleaksExtract(reportText, scanEnv) {
  const dir = tempDir();
  const report = path.join(dir, "history.json");
  if (reportText !== null) writeFileSync(report, reportText);
  const output = path.join(dir, "github-output.txt");
  writeFileSync(output, "");
  const run = runCli(["extract", "gitleaks", report, "history"], {
    env: { GITHUB_OUTPUT: output, ...scanEnv },
    cwd: dir,
  });
  return { ...run, lines: outputLines(output) };
}

/** @param {string} name @returns {string} the fixture's text */
function gitleaksFixture(name) {
  return readFileSync(path.join(FIXTURES, name), "utf8");
}

test("extract gitleaks: exit 0 with an empty report counts 0 findings over the commits", () => {
  const run = gitleaksExtract(gitleaksFixture("gitleaks-none.json"), { SCAN_EXIT: "0", COMMITS: "373" });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(run.lines, ['history={"findings":0,"commits":373}']);
  assert.equal(run.stdout, "");
});

test("extract gitleaks: exit 3 counts the findings, and adds commits only when COMMITS is set", () => {
  const found = gitleaksFixture("gitleaks-found.json");
  for (const [scanEnv, line] of [
    [{ SCAN_EXIT: "3" }, 'history={"findings":2}'],
    [{ SCAN_EXIT: "3", COMMITS: "" }, 'history={"findings":2}'],
    [{ SCAN_EXIT: "3", COMMITS: "373" }, 'history={"findings":2,"commits":373}'],
  ]) {
    const run = gitleaksExtract(found, scanEnv);
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(run.lines, [line], JSON.stringify(scanEnv));
  }
});

test("extract gitleaks: an exit other than 0 or 3 is a scan error, never a count", () => {
  for (const scanExit of ["1", "126"]) {
    for (const reportText of [null, gitleaksFixture("gitleaks-none.json")]) {
      const run = gitleaksExtract(reportText, { SCAN_EXIT: scanExit, COMMITS: "373" });
      assert.equal(run.status, 0, run.stderr);
      assert.deepEqual(run.lines, ['history={"error":"scan"}'], scanExit);
    }
  }
});

test("extract gitleaks: an unset or empty SCAN_EXIT means the scan step never ran", () => {
  for (const scanEnv of [{}, { SCAN_EXIT: "" }]) {
    const run = gitleaksExtract(null, scanEnv);
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(run.lines, ['history={"report":"missing"}'], JSON.stringify(scanEnv));
  }
});

test("extract gitleaks: exit 0 or 3 with no usable report fails and writes nothing", () => {
  for (const scanExit of ["0", "3"]) {
    for (const reportText of [null, "", "not json", '{"findings":[]}', "null"]) {
      const run = gitleaksExtract(reportText, { SCAN_EXIT: scanExit });
      assert.equal(run.status, 1, `${scanExit} ${JSON.stringify(reportText)}`);
      assert.deepEqual(run.lines, []);
      assert.match(run.stderr, /gitleaks exited [03] but /);
    }
  }
});

test("extract gitleaks: a COMMITS value that is not a whole number fails and writes nothing", () => {
  for (const commits of ["373 ", "abc", "-1", "3.5"]) {
    const run = gitleaksExtract(gitleaksFixture("gitleaks-none.json"), { SCAN_EXIT: "0", COMMITS: commits });
    assert.equal(run.status, 1, JSON.stringify(commits));
    assert.deepEqual(run.lines, []);
    assert.match(run.stderr, /COMMITS is not a whole number/);
  }
});

test("extract gitleaks: a report path that cannot be read fails and writes nothing", () => {
  const dir = tempDir();
  const output = path.join(dir, "github-output.txt");
  writeFileSync(output, "");
  const run = runCli(["extract", "gitleaks", dir, "history"], {
    env: { GITHUB_OUTPUT: output, SCAN_EXIT: "3" },
    cwd: dir,
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /cannot read/);
  assert.deepEqual(outputLines(output), []);
});

test("extract gitleaks: an unset GITHUB_OUTPUT fails before the report is read", () => {
  const dir = tempDir();
  const run = runCli(["extract", "gitleaks", dir, "history"], { env: { SCAN_EXIT: "3" }, cwd: dir });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /GITHUB_OUTPUT is not set/);
  assert.doesNotMatch(run.stderr, /cannot read/);
});

test("readGitleaks: counts a report, and throws on one that a finished scan left unusable", () => {
  assert.deepEqual(readGitleaks("[]", { scanExit: "0", commits: "12" }), { findings: 0, commits: 12 });
  assert.deepEqual(readGitleaks('[{"RuleID":"github-pat"}]', { scanExit: "3" }), { findings: 1 });
  assert.deepEqual(readGitleaks(null, {}), { report: "missing" });
  assert.deepEqual(readGitleaks(null, { scanExit: "126" }), { error: "scan" });
  assert.throws(() => readGitleaks(null, { scanExit: "3" }), /wrote no report/);
  assert.throws(() => readGitleaks("{}", { scanExit: "0" }), /not a JSON array/);
  assert.throws(() => readGitleaks("[]", { scanExit: "0", commits: "12a" }), /COMMITS is not a whole number/);
});

// render: the summary job's table from toJSON(needs), and the drift guard on the web job's steps.

const FOOTER_LINE =
  "Offline suites only. The contracts fork suite, the agent fork integration suite and Lighthouse need an archive RPC or a browser audit and run by hand; see README.md, Development.";

const TABLE_HEAD = ["| Check | Job result | Report |", "| --- | --- | --- |"];

const VERIFY = "npm run typecheck && npm test && npm run build && npm run check:out";

/** `toJSON(needs)` of a run in which every job passed. The counts are test inputs, not measurements. */
function greenNeeds() {
  return {
    contracts: { result: "success", outputs: { forge: '{"passed":3,"failed":0,"skipped":0}' } },
    agent: { result: "success", outputs: { unit: '{"passed":4,"failed":0,"skipped":0}' } },
    web: {
      result: "success",
      outputs: { unit: '{"passed":5,"failed":0,"skipped":0}', e2e: '{"passed":6,"failed":0,"skipped":0,"flaky":0}' },
    },
    hygiene: {
      result: "success",
      outputs: {
        history: '{"findings":0,"commits":373}',
        messages: '{"findings":0}',
        canary: "success",
        actionlint: "success",
      },
    },
  };
}

/** @param {string[]} rows the eight table rows @returns {string} the whole text render must write */
function summaryText(rows) {
  return [...TABLE_HEAD, ...rows, "", FOOTER_LINE, ""].join("\n");
}

test("render: every job green gives one row per suite and scan, then the footer", () => {
  assert.deepEqual(renderSummary(JSON.stringify(greenNeeds())), {
    code: 0,
    markdown: summaryText([
      "| Contracts, unit | success | 3 passed, 0 failed, 0 skipped |",
      "| Agent, unit | success | 4 passed, 0 failed, 0 skipped |",
      "| Web, unit | success | 5 passed, 0 failed, 0 skipped |",
      "| Web, end to end | success | 6 passed, 0 failed, 0 skipped, 0 flaky |",
      "| Secret scan, history | success | 0 findings over 373 commits |",
      "| Secret scan, commit messages | success | 0 findings |",
      "| Secret scan, canary | success | success |",
      "| Workflow lint | success | success |",
    ]),
  });
});

test("render: failed jobs show their result and the failed counts", () => {
  const needs = greenNeeds();
  needs.contracts = { result: "failure", outputs: { forge: '{"passed":2,"failed":1,"skipped":0}' } };
  needs.web = {
    result: "failure",
    outputs: { unit: '{"passed":4,"failed":1,"skipped":0}', e2e: '{"passed":5,"failed":1,"skipped":0,"flaky":0}' },
  };
  needs.hygiene = {
    result: "failure",
    outputs: {
      history: '{"findings":2,"commits":373}',
      messages: '{"findings":1}',
      canary: "failure",
      actionlint: "success",
    },
  };
  assert.equal(
    renderSummary(JSON.stringify(needs)).markdown,
    summaryText([
      "| Contracts, unit | failure | 2 passed, 1 failed, 0 skipped |",
      "| Agent, unit | success | 4 passed, 0 failed, 0 skipped |",
      "| Web, unit | failure | 4 passed, 1 failed, 0 skipped |",
      "| Web, end to end | failure | 5 passed, 1 failed, 0 skipped, 0 flaky |",
      "| Secret scan, history | failure | 2 findings over 373 commits |",
      "| Secret scan, commit messages | failure | 1 findings |",
      "| Secret scan, canary | failure | failure |",
      "| Workflow lint | failure | success |",
    ]),
  );
});

test("render: skipped tests, flaky tests and a skipped job are printed as given", () => {
  const needs = greenNeeds();
  needs.contracts.outputs.forge = '{"passed":2,"failed":0,"skipped":1}';
  needs.agent = { result: "skipped", outputs: {} };
  needs.web.outputs.e2e = '{"passed":4,"failed":0,"skipped":1,"flaky":1}';
  assert.equal(
    renderSummary(JSON.stringify(needs)).markdown,
    summaryText([
      "| Contracts, unit | success | 2 passed, 0 failed, 1 skipped |",
      "| Agent, unit | skipped | no report |",
      "| Web, unit | success | 5 passed, 0 failed, 0 skipped |",
      "| Web, end to end | success | 4 passed, 0 failed, 1 skipped, 1 flaky |",
      "| Secret scan, history | success | 0 findings over 373 commits |",
      "| Secret scan, commit messages | success | 0 findings |",
      "| Secret scan, canary | success | success |",
      "| Workflow lint | success | success |",
    ]),
  );
});

test("render: a missing report, a job with no outputs and an absent job show no report", () => {
  const needs = greenNeeds();
  needs.contracts = { result: "failure", outputs: { forge: '{"report":"missing"}' } };
  needs.agent = { result: "failure" };
  delete needs.web;
  needs.hygiene.result = "";
  assert.equal(
    renderSummary(JSON.stringify(needs)).markdown,
    summaryText([
      "| Contracts, unit | failure | no report |",
      "| Agent, unit | failure | no report |",
      "| Web, unit | unknown | no report |",
      "| Web, end to end | unknown | no report |",
      "| Secret scan, history | unknown | 0 findings over 373 commits |",
      "| Secret scan, commit messages | unknown | 0 findings |",
      "| Secret scan, canary | unknown | success |",
      "| Workflow lint | unknown | success |",
    ]),
  );
});

test("render: a cancelled or timed-out run's empty outputs show no report and the exit stays 0", () => {
  const needs = {
    contracts: { result: "cancelled", outputs: {} },
    agent: { result: "cancelled", outputs: { unit: "" } },
    web: { result: "failure", outputs: { unit: '{"passed":5,"failed":0,"skipped":0}', e2e: "" } },
    hygiene: { result: "cancelled", outputs: { history: "", messages: null, canary: "", actionlint: "" } },
  };
  const result = renderSummary(JSON.stringify(needs));
  assert.equal(result.code, 0);
  assert.equal(
    result.markdown,
    summaryText([
      "| Contracts, unit | cancelled | no report |",
      "| Agent, unit | cancelled | no report |",
      "| Web, unit | failure | 5 passed, 0 failed, 0 skipped |",
      "| Web, end to end | failure | no report |",
      "| Secret scan, history | cancelled | no report |",
      "| Secret scan, commit messages | cancelled | no report |",
      "| Secret scan, canary | cancelled | no report |",
      "| Workflow lint | cancelled | no report |",
    ]),
  );
});

test("render: a scan error shows as scan failed, never as 0 findings", () => {
  const needs = greenNeeds();
  needs.hygiene = {
    result: "failure",
    outputs: { history: '{"error":"scan"}', messages: '{"error":"scan"}', canary: "success", actionlint: "failure" },
  };
  assert.equal(
    renderSummary(JSON.stringify(needs)).markdown,
    summaryText([
      "| Contracts, unit | success | 3 passed, 0 failed, 0 skipped |",
      "| Agent, unit | success | 4 passed, 0 failed, 0 skipped |",
      "| Web, unit | success | 5 passed, 0 failed, 0 skipped |",
      "| Web, end to end | success | 6 passed, 0 failed, 0 skipped, 0 flaky |",
      "| Secret scan, history | failure | scan failed |",
      "| Secret scan, commit messages | failure | scan failed |",
      "| Secret scan, canary | failure | success |",
      "| Workflow lint | failure | failure |",
    ]),
  );
});

test("render: an output that does not parse or has the wrong shape shows as unreadable output", () => {
  const needs = greenNeeds();
  needs.contracts.outputs.forge = "not json";
  needs.agent.outputs.unit = "[]";
  needs.web.outputs = { unit: '{"passed":-1,"failed":0,"skipped":0}', e2e: '{"passed":6,"failed":0,"skipped":0}' };
  needs.hygiene.outputs.history = '{"findings":0,"commits":"373"}';
  needs.hygiene.outputs.messages = '{"findings":1.5}';
  assert.equal(
    renderSummary(JSON.stringify(needs)).markdown,
    summaryText([
      "| Contracts, unit | success | unreadable output |",
      "| Agent, unit | success | unreadable output |",
      "| Web, unit | success | unreadable output |",
      "| Web, end to end | success | unreadable output |",
      "| Secret scan, history | success | unreadable output |",
      "| Secret scan, commit messages | success | unreadable output |",
      "| Secret scan, canary | success | success |",
      "| Workflow lint | success | success |",
    ]),
  );
});

test("renderSummary: a NEEDS_JSON that is unset, does not parse or is not an object fails", () => {
  for (const needsJson of [undefined, "", "not json", "[]", "null", '"needs"', "42"]) {
    assert.deepEqual(renderSummary(needsJson), { code: 1, message: "NEEDS_JSON does not parse" }, String(needsJson));
  }
});

test("render: appends the table to GITHUB_STEP_SUMMARY and exits 0", () => {
  const dir = tempDir();
  const summary = path.join(dir, "step-summary.md");
  writeFileSync(summary, "earlier step\n");
  const needsJson = JSON.stringify(greenNeeds());
  const run = runCli(["render"], { env: { GITHUB_STEP_SUMMARY: summary, NEEDS_JSON: needsJson }, cwd: dir });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "");
  assert.equal(readFileSync(summary, "utf8"), `earlier step\n${renderSummary(needsJson).markdown}`);
});

test("render: with no GITHUB_STEP_SUMMARY the table goes to stdout and the exit stays 0", () => {
  const needsJson = JSON.stringify(greenNeeds());
  const run = runCli(["render"], { env: { NEEDS_JSON: needsJson }, cwd: tempDir() });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, renderSummary(needsJson).markdown);
});

test("render: a NEEDS_JSON that is unset or does not parse exits 1 and writes nothing", () => {
  const dir = tempDir();
  const summary = path.join(dir, "step-summary.md");
  writeFileSync(summary, "");
  for (const env of [{ GITHUB_STEP_SUMMARY: summary, NEEDS_JSON: "{" }, { GITHUB_STEP_SUMMARY: summary }]) {
    const run = runCli(["render"], { env, cwd: dir });
    assert.equal(run.status, 1, JSON.stringify(env));
    assert.match(run.stderr, /NEEDS_JSON does not parse/);
    assert.equal(run.stdout, "");
  }
  assert.equal(readFileSync(summary, "utf8"), "");
});

test("render and extract gitleaks with the wrong argument count take the usage path", () => {
  const dir = tempDir();
  const output = path.join(dir, "github-output.txt");
  writeFileSync(output, "");
  for (const args of [["render", "now"], ["extract", "gitleaks", "history.json"]]) {
    const run = runCli(args, {
      env: { GITHUB_OUTPUT: output, SCAN_EXIT: "0", NEEDS_JSON: JSON.stringify(greenNeeds()) },
      cwd: dir,
    });
    assert.equal(run.status, 1, args.join(" "));
    assert.ok(
      run.stderr.startsWith(
        "usage: ci-counts.mjs extract <forge|vitest|playwright|gitleaks> <report.json> <output-name> | render",
      ),
      run.stderr,
    );
    assert.equal(run.stdout, "");
  }
  assert.deepEqual(outputLines(output), []);
});

test("drift guard: web/package.json verify is exactly the four parts the web job runs one by one", () => {
  const webPackage = JSON.parse(readFileSync(fileURLToPath(new URL("../../web/package.json", import.meta.url)), "utf8"));
  assert.equal(webPackage.scripts.verify, VERIFY);
});
