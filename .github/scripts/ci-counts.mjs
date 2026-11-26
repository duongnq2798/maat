// The counting script of the CI workflow (docs/superpowers/specs/2026-11-18-maat-ci-design.md, section 5.1).
// `extract` turns one runner's JSON report into one compact job output and annotates failed forge and Playwright tests;
// `render` writes the job-summary table.
// Zero dependencies: Node 24 built-ins only.
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";

/** @typedef {{ passed: number, failed: number, skipped: number }} TestCounts */
/** @typedef {{ passed: number, failed: number, skipped: number, flaky: number }} E2eCounts */
/** @typedef {{ findings: number, commits?: number }} ScanCounts */
/** @typedef {{ report: "missing" }} MissingReport */
/** @typedef {{ error: "scan" }} ScanError */
/** @typedef {{ file: string, title: string, reason: string }} Failure file: relative to GITHUB_WORKSPACE, forward slashes; reason: already firstLine'd */
/** @typedef {{ STEP_OUTCOME?: string, SCAN_EXIT?: string, COMMITS?: string, GITHUB_WORKSPACE?: string }} ExtractEnv */
/** @typedef {{ code: 0 | 1, output?: TestCounts | E2eCounts | ScanCounts | MissingReport | ScanError, annotations: string[], message?: string }} ExtractResult */

/** ANSI SGR colour codes, which Playwright writes into its error messages. */
const ANSI_SGR = /\u001b\[[0-9;]*m/g;

/** Thrown by the read* functions when a report is not its kind's shape. */
export class ReportError extends Error {}

/** @param {string} value @returns {string} `%`, `\r`, `\n` escaped as `%25`, `%0D`, `%0A`. */
export function escapeData(value) {
  return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

/** @param {string} value @returns {string} escapeData plus `:` as `%3A` and `,` as `%2C`. */
export function escapeProperty(value) {
  return escapeData(value).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

/**
 * The first line of a failure reason that is not blank, trimmed and without ANSI SGR codes; "" when there is none.
 * @param {string} reason @returns {string}
 */
export function firstLine(reason) {
  const lines = reason.replace(ANSI_SGR, "").split(/\r\n|\r|\n/);
  return lines.map((line) => line.trim()).find((line) => line !== "") ?? "";
}

/** @param {string} workspace @param {string} absolutePath @returns {string} path.relative, then split(path.sep).join("/"). */
export function workspacePath(workspace, absolutePath) {
  return path.relative(workspace, absolutePath).split(path.sep).join("/");
}

/** @param {Failure} failure @returns {string} one `::error` line, no trailing newline. */
export function annotation(failure) {
  const message = failure.reason === "" ? failure.title : `${failure.title}: ${failure.reason}`;
  return `::error file=${escapeProperty(failure.file)}::${escapeData(message)}`;
}

/** @param {unknown} value @returns {boolean} true for a non-null object that is not an array */
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
/** Joins the suite, file or describe titles and the test's title in an annotation. */
const TITLE_SEPARATOR = " › ";
const FORGE_STATUSES = new Set(["Success", "Failure", "Skipped"]);

/**
 * A `forge test --json-file` report: one object keyed by `<path>:<Contract>`, each suite holding `test_results`.
 * @param {unknown} report @param {{ workspace: string, cwd: string }} where
 * @returns {{ counts: TestCounts, failures: Failure[] }} @throws {ReportError}
 */
export function readForge(report, where) {
  if (!isObject(report)) throw new ReportError("a forge report is an object keyed by suite");
  const counts = { passed: 0, failed: 0, skipped: 0 };
  const failures = [];
  for (const [suite, result] of Object.entries(report)) {
    const colon = suite.lastIndexOf(":");
    if (colon < 1) throw new ReportError(`suite key ${JSON.stringify(suite)} is not <path>:<Contract>`);
    if (!isObject(result) || !isObject(result.test_results)) throw new ReportError(`suite ${suite} has no test_results object`);
    const suitePath = suite.slice(0, colon);
    const contract = suite.slice(colon + 1);
    for (const [name, test] of Object.entries(result.test_results)) {
      if (!isObject(test) || !FORGE_STATUSES.has(test.status)) throw new ReportError(`test ${name} in ${suite} has no known status`);
      if (test.reason !== undefined && test.reason !== null && typeof test.reason !== "string") {
        throw new ReportError(`test ${name} in ${suite} has a reason that is not text`);
      }
      if (test.status === "Success") {
        counts.passed += 1;
      } else if (test.status === "Skipped") {
        counts.skipped += 1;
      } else {
        counts.failed += 1;
        failures.push({
          file: workspacePath(where.workspace, path.join(where.cwd, suitePath)),
          title: `${contract}${TITLE_SEPARATOR}${name}`,
          reason: firstLine(test.reason ?? ""),
        });
      }
    }
  }
  return { counts, failures };
}

/** @param {unknown} value @returns {boolean} true for a non-negative integer */
const isCount = (value) => Number.isInteger(value) && value >= 0;
const VITEST_TOTALS = ["numPassedTests", "numFailedTests", "numPendingTests", "numTodoTests"];

/**
 * A Vitest JSON report. Vitest's own github-actions reporter annotates its failures, so this gives none.
 * @param {unknown} report @returns {{ counts: TestCounts, failures: Failure[] }} failures is always []. @throws {ReportError}
 */
export function readVitest(report) {
  if (!isObject(report)) throw new ReportError("a vitest report is an object");
  for (const field of VITEST_TOTALS) {
    if (!isCount(report[field])) throw new ReportError(`${field} is not a non-negative integer`);
  }
  const counts = {
    passed: report.numPassedTests,
    failed: report.numFailedTests,
    skipped: report.numPendingTests + report.numTodoTests,
  };
  return { counts, failures: [] };
}

/** Below the shape rules: the object entries of a list, or none when it is missing or not a list. */
const objectsIn = (value) => (Array.isArray(value) ? value.filter(isObject) : []);
/** Below the shape rules: a title or file name, or "" when it is missing or not text. */
const textOf = (value) => (typeof value === "string" ? value : "");
const PLAYWRIGHT_STATS = ["expected", "unexpected", "skipped", "flaky"];

/**
 * A Playwright JSON report: one suite per spec file under `suites`, describe blocks nested in `suites`, totals in `stats`.
 * @param {unknown} report @param {{ workspace: string }} where
 * @returns {{ counts: E2eCounts, failures: Failure[] }} @throws {ReportError}
 */
export function readPlaywright(report, where) {
  if (!isObject(report)) throw new ReportError("a playwright report is an object");
  if (!isObject(report.config) || typeof report.config.rootDir !== "string") throw new ReportError("config.rootDir is not a string");
  if (!Array.isArray(report.suites)) throw new ReportError("suites is not an array");
  if (!isObject(report.stats)) throw new ReportError("stats is not an object");
  for (const field of PLAYWRIGHT_STATS) {
    if (!isCount(report.stats[field])) throw new ReportError(`stats.${field} is not a non-negative integer`);
  }
  const rootDir = report.config.rootDir;
  const failures = [];
  const visit = (suite, describeTitles) => {
    for (const spec of objectsIn(suite.specs)) {
      const file = textOf(spec.file);
      for (const test of objectsIn(spec.tests)) {
        if (test.status !== "unexpected") continue;
        const withMessage = objectsIn(test.results).filter((result) => isObject(result.error) && typeof result.error.message === "string");
        failures.push({
          file: workspacePath(where.workspace, path.join(rootDir, file)),
          title: [file, ...describeTitles, textOf(spec.title)].join(TITLE_SEPARATOR),
          reason: firstLine(withMessage.at(-1)?.error.message ?? ""),
        });
      }
    }
    for (const child of objectsIn(suite.suites)) visit(child, [...describeTitles, textOf(child.title)]);
  };
  for (const fileSuite of objectsIn(report.suites)) visit(fileSuite, []);
  const { expected, unexpected, skipped, flaky } = report.stats;
  return { counts: { passed: expected, failed: unexpected, skipped, flaky }, failures };
}

const USAGE = "usage: ci-counts.mjs extract <forge|vitest|playwright|gitleaks> <report.json> <output-name> | render";
const READERS = {
  forge: (report, env, cwd) => readForge(report, { workspace: env.GITHUB_WORKSPACE, cwd }),
  vitest: (report) => readVitest(report),
  playwright: (report, env) => readPlaywright(report, { workspace: env.GITHUB_WORKSPACE }),
};

/**
 * The failure semantics of spec 5.1 for one report.
 * @param {"forge" | "vitest" | "playwright" | "gitleaks"} kind @param {string | null} reportText null when the file is absent
 * @param {ExtractEnv} env @param {string} cwd @returns {ExtractResult}
 */
export function extractResult(kind, reportText, env, cwd) {
  if (kind === "gitleaks") return gitleaksResult(reportText, env);
  if (!Object.hasOwn(READERS, kind)) return { code: 1, annotations: [], message: USAGE };
  if (reportText === null) {
    // Unless its step succeeded, that step has already failed the job; an unset STEP_OUTCOME counts as not success.
    if (env.STEP_OUTCOME !== "success") return { code: 0, output: { report: "missing" }, annotations: [] };
    return { code: 1, annotations: [], message: `the ${kind} report is missing, but the step that writes it succeeded` };
  }
  let report;
  try {
    report = JSON.parse(reportText);
  } catch (error) {
    return { code: 1, annotations: [], message: `the ${kind} report is not JSON: ${error.message}` };
  }
  let read;
  try {
    read = READERS[kind](report, env, cwd);
  } catch (error) {
    if (!(error instanceof ReportError)) throw error;
    return { code: 1, annotations: [], message: `the ${kind} report is not a ${kind} report: ${error.message}` };
  }
  const { counts, failures } = read;
  if (counts.passed + counts.failed + (counts.flaky ?? 0) === 0) {
    // A test filter or a report path went wrong.
    return { code: 1, annotations: [], message: `the ${kind} report ran no test` };
  }
  return { code: 0, output: counts, annotations: failures.map(annotation) };
}

/** The report kinds `extract` takes. */
const KINDS = ["forge", "vitest", "playwright", "gitleaks"];
/** The kinds whose annotation paths are relative to GITHUB_WORKSPACE. */
const NEEDS_WORKSPACE = ["forge", "playwright"];

/**
 * Parses argv. `render` returns through renderCommand before any of the steps below, which only `extract` takes: it
 * checks GITHUB_OUTPUT (and GITHUB_WORKSPACE for forge and playwright), reads the report (ENOENT gives null; any other
 * read error exits 1), calls extractResult, appends the output line with appendFileSync, and writes annotations to
 * stdout and messages to stderr.
 * @param {string[]} argv @param {NodeJS.ProcessEnv} env @param {string} cwd @returns {0 | 1}
 */
export function main(argv, env, cwd) {
  if (argv.length === 1 && argv[0] === "render") return renderCommand(env);
  const [command, kind, reportPath, outputName] = argv;
  if (argv.length !== 4 || command !== "extract" || !KINDS.includes(kind)) {
    process.stderr.write(`${USAGE}\n`);
    return 1;
  }
  if (!env.GITHUB_OUTPUT) {
    process.stderr.write("GITHUB_OUTPUT is not set\n");
    return 1;
  }
  if (NEEDS_WORKSPACE.includes(kind) && !env.GITHUB_WORKSPACE) {
    process.stderr.write("GITHUB_WORKSPACE is not set\n");
    return 1;
  }
  let reportText = null;
  try {
    reportText = readFileSync(reportPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      process.stderr.write(`cannot read ${reportPath}: ${error.message}\n`);
      return 1;
    }
  }
  const result = extractResult(kind, reportText, env, cwd);
  for (const line of result.annotations) process.stdout.write(`${line}\n`);
  if (result.message !== undefined) process.stderr.write(`${result.message}\n`);
  if (result.output !== undefined) appendFileSync(env.GITHUB_OUTPUT, `${outputName}=${JSON.stringify(result.output)}\n`);
  return result.code;
}

/** gitleaks exit codes that mean the scan ran: 0 with no findings, 3 (`--exit-code 3`) with findings. */
const GITLEAKS_EXIT_CODES = new Set(["0", "3"]);

/**
 * Counts one gitleaks scan from its exit code and JSON report. An unset or empty SCAN_EXIT means the
 * scan step never ran; any exit other than 0 or 3 means gitleaks itself failed, so a broken scan never
 * shows as "0 findings".
 * @param {string | null} reportText null when the file is absent
 * @param {{ scanExit?: string, commits?: string }} scan
 * @returns {ScanCounts | MissingReport | ScanError}
 * @throws {ReportError} when a scan that ran left no usable report, or COMMITS is not a whole number
 */
export function readGitleaks(reportText, scan) {
  const scanExit = scan.scanExit ?? "";
  if (scanExit === "") return { report: "missing" };
  if (!GITLEAKS_EXIT_CODES.has(scanExit)) return { error: "scan" };
  const commits = scan.commits ?? "";
  if (commits !== "" && !/^\d+$/.test(commits)) throw new ReportError("COMMITS is not a whole number");
  if (reportText === null) throw new ReportError(`gitleaks exited ${scanExit} but wrote no report`);
  if (reportText.trim() === "") throw new ReportError(`gitleaks exited ${scanExit} but its report is empty`);
  let findings;
  try {
    findings = JSON.parse(reportText);
  } catch {
    throw new ReportError(`gitleaks exited ${scanExit} but its report is not JSON`);
  }
  if (!Array.isArray(findings)) {
    throw new ReportError(`gitleaks exited ${scanExit} but its report is not a JSON array`);
  }
  return commits === "" ? { findings: findings.length } : { findings: findings.length, commits: Number(commits) };
}

/** The gitleaks branch of extractResult: no annotations, and exit 1 only for a ReportError. */
function gitleaksResult(reportText, env) {
  try {
    const output = readGitleaks(reportText, { scanExit: env.SCAN_EXIT, commits: env.COMMITS });
    return { code: 0, output, annotations: [] };
  } catch (error) {
    if (error instanceof ReportError) return { code: 1, annotations: [], message: error.message };
    throw error;
  }
}

/** The table's footer. It carries no hand-measured number, so it cannot go stale. */
const SUMMARY_FOOTER =
  "Offline suites only. The contracts fork suite, the agent fork integration suite and Lighthouse need an archive RPC or a browser audit and run by hand; see README.md, Development.";

/** One row per suite and scan: the check's label, the needed job, its output, and how the cell reads it. */
const SUMMARY_ROWS = [
  ["Contracts, unit", "contracts", "forge", "counts"],
  ["Agent, unit", "agent", "unit", "counts"],
  ["Web, unit", "web", "unit", "counts"],
  ["Web, end to end", "web", "e2e", "e2e"],
  ["Secret scan, history", "hygiene", "history", "history"],
  ["Secret scan, commit messages", "hygiene", "messages", "scan"],
  ["Secret scan, canary", "hygiene", "canary", "outcome"],
  ["Workflow lint", "hygiene", "actionlint", "outcome"],
];

/** `needs.<job>.result` when it is a non-empty string, else "unknown". */
function summaryJobResult(job) {
  return isObject(job) && typeof job.result === "string" && job.result !== "" ? job.result : "unknown";
}

/**
 * One Report cell. An absent, null or empty output shows as "no report" (its step never ran, for
 * example after a timeout), never as malformed.
 * @param {unknown} output the job output as GitHub passed it
 * @param {"counts" | "e2e" | "history" | "scan" | "outcome"} reads
 * @returns {string}
 */
function summaryCell(output, reads) {
  if (reads === "outcome") return typeof output === "string" && output !== "" ? output : "no report";
  if (output === undefined || output === null || output === "") return "no report";
  if (typeof output !== "string") return "unreadable output";
  let value;
  try {
    value = JSON.parse(output);
  } catch {
    return "unreadable output";
  }
  if (!isObject(value)) return "unreadable output";
  if (value.report === "missing") return "no report";
  if (value.error === "scan") return "scan failed";
  if (reads === "counts" || reads === "e2e") {
    if (![value.passed, value.failed, value.skipped].every(isCount)) return "unreadable output";
    const counts = `${value.passed} passed, ${value.failed} failed, ${value.skipped} skipped`;
    if (reads === "counts") return counts;
    return isCount(value.flaky) ? `${counts}, ${value.flaky} flaky` : "unreadable output";
  }
  if (!isCount(value.findings)) return "unreadable output";
  const findings = `${value.findings} finding${value.findings === 1 ? "" : "s"}`;
  if (reads === "history" && value.commits !== undefined) {
    return isCount(value.commits) ? `${findings} over ${value.commits} commit${value.commits === 1 ? "" : "s"}` : "unreadable output";
  }
  return findings;
}

/**
 * Renders the job-summary table from `toJSON(needs)`. It fails only when NEEDS_JSON is unset, does
 * not parse or is not an object; gating belongs to the workflow's shell step.
 * @param {string | undefined} needsJson
 * @returns {{ code: 0 | 1, markdown?: string, message?: string }}
 */
export function renderSummary(needsJson) {
  let needs;
  try {
    needs = JSON.parse(needsJson ?? "");
  } catch {
    needs = undefined;
  }
  if (!isObject(needs)) return { code: 1, message: "NEEDS_JSON does not parse" };
  const lines = ["| Check | Job result | Report |", "| --- | --- | --- |"];
  for (const [label, jobName, outputName, reads] of SUMMARY_ROWS) {
    const job = Object.hasOwn(needs, jobName) ? needs[jobName] : undefined;
    const outputs = isObject(job) && isObject(job.outputs) ? job.outputs : {};
    const output = Object.hasOwn(outputs, outputName) ? outputs[outputName] : undefined;
    lines.push(`| ${label} | ${summaryJobResult(job)} | ${summaryCell(output, reads)} |`);
  }
  lines.push("", SUMMARY_FOOTER);
  return { code: 0, markdown: `${lines.join("\n")}\n` };
}

/** `render`: appends the table to GITHUB_STEP_SUMMARY, or writes it to stdout when that is unset or empty. */
function renderCommand(env) {
  const result = renderSummary(env.NEEDS_JSON);
  if (result.code !== 0) {
    process.stderr.write(`${result.message}\n`);
    return 1;
  }
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, result.markdown);
  else process.stdout.write(result.markdown);
  return 0;
}

// Runs only when invoked directly. import.meta.main exists from Node 24.2.0; local v24.12.0; CI: Node 24 (v24.22.3 on 2026-11-18).
if (import.meta.main) process.exitCode = main(process.argv.slice(2), process.env, process.cwd());
