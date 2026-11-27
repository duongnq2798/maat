// The optional healthcheck ping: one GET after each healthy round, never the URL in a line, never a stop.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { PublishRetry, PublishStop } from "../lib/errors.mjs";
import { HEALTHCHECK_TIMEOUT_MS, HEALTHY_STATUSES, isHttpUrl, pingHealthcheck } from "../lib/healthcheck.mjs";
import { healthcheckUrl, main, USAGE } from "../publish.mjs";

/** A token that must never show in any line the publisher prints. */
const TOKEN = "0f2c9a4e-hc-token-never-printed";

describe("pingHealthcheck against a real HTTP server on 127.0.0.1", () => {
  /** @type {import("node:http").Server} */
  let server;
  let base = "";
  /** @type {{ method: string | undefined, url: string | undefined }[]} */
  const seen = [];
  before(async () => {
    server = createServer((req, res) => {
      seen.push({ method: req.method, url: req.url });
      if (req.url?.startsWith("/ok/")) res.end("OK");
      else if (req.url?.startsWith("/fail/")) {
        res.statusCode = 500;
        res.end("down");
      }
      // Any other path never answers, to stand in for a stalled monitor.
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", () => r(undefined)));
    base = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`;
  });
  after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(() => r(undefined)));
  });

  it("sends one GET and returns null on a 2xx", async () => {
    assert.equal(await pingHealthcheck(`${base}/ok/${TOKEN}`), null);
    assert.deepEqual(seen.at(-1), { method: "GET", url: `/ok/${TOKEN}` });
  });

  it("says HTTP <status> on any other answer, without the URL", async () => {
    const why = await pingHealthcheck(`${base}/fail/${TOKEN}`);
    assert.equal(why, "HTTP 500");
  });

  it("gives up after its timeout, which is 10 s by default", async () => {
    assert.equal(HEALTHCHECK_TIMEOUT_MS, 10_000);
    const started = Date.now();
    const why = await pingHealthcheck(`${base}/stall/${TOKEN}`, { timeoutMs: 300 });
    assert.equal(why, "no answer within 300 ms");
    assert.ok(Date.now() - started < 5_000);
  });

  it("names only an error code when nothing listens, never the URL", async () => {
    const closed = createServer();
    await new Promise((r) => closed.listen(0, "127.0.0.1", () => r(undefined)));
    const port = /** @type {import("node:net").AddressInfo} */ (closed.address()).port;
    await new Promise((r) => closed.close(() => r(undefined)));
    const why = await pingHealthcheck(`http://127.0.0.1:${port}/${TOKEN}`, { timeoutMs: 5_000 });
    assert.ok(why !== null);
    assert.match(why, /^[A-Z][A-Z0-9_]+$|^network error$/);
    assert.equal(why.includes(TOKEN), false);
  });

  it("never throws, even when fetch itself throws with the URL in its message", async () => {
    const why = await pingHealthcheck(`https://hc.example.invalid/${TOKEN}`, {
      fetch: async (url) => {
        throw new TypeError(`fetch failed for ${url}`);
      },
    });
    assert.equal(why, "network error");
  });
});

describe("isHttpUrl and healthcheckUrl", () => {
  it("takes only an absolute http or https URL", () => {
    assert.equal(isHttpUrl("https://hc-ping.com/abc"), true);
    assert.equal(isHttpUrl("http://127.0.0.1:8000/x"), true);
    assert.equal(isHttpUrl("hc-ping.com/abc"), false);
    assert.equal(isHttpUrl("file:///C:/x"), false);
    assert.equal(isHttpUrl(""), false);
  });

  it("reads MAAT_HEALTHCHECK_URL from the environment, else agent/.env; blank or missing means no ping", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "maat-agent-hc-"));
    try {
      assert.equal(healthcheckUrl({ env: {}, agentDir }), undefined);
      assert.equal(healthcheckUrl({ env: { MAAT_HEALTHCHECK_URL: "   " }, agentDir }), undefined);
      writeFileSync(join(agentDir, ".env"), `ANTHROPIC_API_KEY=sk-ant-fake-not-read\nMAAT_HEALTHCHECK_URL=https://hc.example.invalid/${TOKEN}\n`);
      assert.equal(healthcheckUrl({ env: {}, agentDir }), `https://hc.example.invalid/${TOKEN}`);
      assert.equal(healthcheckUrl({ env: { MAAT_HEALTHCHECK_URL: " https://env.example.invalid/x " }, agentDir }), "https://env.example.invalid/x");
      writeFileSync(join(agentDir, ".env"), "MAAT_HEALTHCHECK_URL=\n");
      assert.equal(healthcheckUrl({ env: {}, agentDir }), undefined);
    } finally {
      rmSync(agentDir, { recursive: true, force: true });
    }
  });

  it("pings after a push or a round with nothing new, and not after a round that waits for the journal", () => {
    assert.deepEqual([...HEALTHY_STATUSES].sort(), ["pushed", "up-to-date"]);
  });

  it("is in the usage, by name only", () => {
    assert.match(USAGE, /MAAT_HEALTHCHECK_URL/);
  });
});

describe("main: the healthcheck ping in the loop", () => {
  const URL_SET = `https://hc.example.invalid/ping/${TOKEN}`;

  /**
   * Runs main with fake rounds, a fake sleep and a fake fetch whose answers are `answers`, in order.
   * @param {string[]} argv
   * @param {Array<() => unknown>} rounds
   * @param {{ env?: Record<string, string>, answers?: Array<number | Error | "stall">, abortAfterSleeps?: number }} [o]
   */
  async function drive(argv, rounds, { env = { MAAT_HEALTHCHECK_URL: URL_SET }, answers = [], abortAfterSleeps = Infinity } = {}) {
    const out = [];
    const err = [];
    /** @type {{ url: string, method: string | undefined }[]} */
    const pings = [];
    let sleeps = 0;
    const ac = new AbortController();
    const code = await main(argv, {
      env,
      agentDir: resolve(tmpdir(), "maat-agent-none"),
      signal: ac.signal,
      healthcheckTimeoutMs: 200,
      log: (s) => out.push(s),
      err: (s) => err.push(s),
      sleep: async () => {
        sleeps += 1;
        if (sleeps >= abortAfterSleeps) ac.abort();
      },
      fetch: async (url, init) => {
        pings.push({ url: String(url), method: init?.method });
        const a = answers.shift() ?? 200;
        if (a instanceof Error) throw a;
        if (a === "stall") {
          return await new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
        }
        return new Response(a === 200 ? "OK" : "no", { status: a });
      },
      publishOnce: async () => {
        const next = rounds.shift();
        if (next === undefined) {
          ac.abort();
          throw new PublishRetry("no more rounds in this test");
        }
        return next();
      },
    });
    const all = [...out, ...err].join("\n");
    return { code, out, err, pings, all };
  }
  const pushed = () => ({ status: "pushed", appended: 1, rows: 1, head: null, message: "appended 1 row" });
  const upToDate = () => ({ status: "up-to-date", appended: 0, rows: 1, head: null, message: "nothing new" });
  const waiting = () => ({ status: "waiting", appended: 0, rows: 0, head: null, message: "no journal yet" });
  const retry = () => {
    throw new PublishRetry("git push failed: Could not resolve host");
  };

  it("pings once after each push and each round with nothing new, and says ok, never the URL", async () => {
    const r = await drive([], [pushed, upToDate], { abortAfterSleeps: 2 });
    assert.equal(r.code, 0);
    assert.deepEqual(r.pings, [{ url: URL_SET, method: "GET" }, { url: URL_SET, method: "GET" }]);
    assert.equal(r.out.filter((l) => l.endsWith(" healthcheck ping ok")).length, 2);
    assert.ok(r.out.some((l) => /healthcheck: a GET to MAAT_HEALTHCHECK_URL after each round that pushes or finds nothing new/.test(l)));
    assert.equal(r.all.includes(TOKEN), false);
    assert.equal(r.all.includes("hc.example.invalid"), false);
  });

  it("does not ping after a round that waits for the journal, or one that will try again", async () => {
    const r = await drive([], [waiting, retry, upToDate], { abortAfterSleeps: 3 });
    assert.equal(r.code, 0);
    assert.equal(r.pings.length, 1);
    assert.equal(r.out.filter((l) => /healthcheck ping/.test(l)).length, 1);
  });

  it("logs a failed ping and keeps going: an HTTP error, a network error and a timeout", async () => {
    const r = await drive([], [pushed, upToDate, upToDate, pushed], {
      answers: [503, new TypeError(`fetch failed: ${URL_SET}`), "stall", 200],
      abortAfterSleeps: 4,
    });
    assert.equal(r.code, 0);
    assert.equal(r.pings.length, 4);
    const lines = r.out.filter((l) => /healthcheck ping/.test(l)).map((l) => l.replace(/^journal-publisher \S+ /, ""));
    assert.deepEqual(lines, [
      "healthcheck ping failed: HTTP 503",
      "healthcheck ping failed: network error",
      "healthcheck ping failed: no answer within 200 ms",
      "healthcheck ping ok",
    ]);
    assert.equal(r.err.length, 0);
    assert.equal(r.all.includes(TOKEN), false);
  });

  it("pings in --once too, and a failed ping leaves the exit code at 0", async () => {
    const r = await drive(["--once"], [pushed], { answers: [500] });
    assert.equal(r.code, 0);
    assert.equal(r.pings.length, 1);
    assert.ok(r.out.some((l) => l.endsWith(" healthcheck ping failed: HTTP 500")));
  });

  it("sends nothing when the variable is unset, and prints no healthcheck line", async () => {
    const r = await drive(["--once"], [pushed], { env: {} });
    assert.equal(r.code, 0);
    assert.equal(r.pings.length, 0);
    assert.equal(/healthcheck/.test(r.all), false);
  });

  it("sends nothing for a value that is not an http or https URL, says so at start, and does not quote it", async () => {
    const r = await drive(["--once"], [pushed], { env: { MAAT_HEALTHCHECK_URL: `hc-ping.com/${TOKEN}` } });
    assert.equal(r.code, 0);
    assert.equal(r.pings.length, 0);
    assert.ok(r.out.some((l) => /healthcheck: MAAT_HEALTHCHECK_URL is set but is not an http or https URL, so no ping is sent/.test(l)));
    assert.equal(r.all.includes(TOKEN), false);
  });

  it("does not ping before a stop", async () => {
    const r = await drive([], [() => { throw new PublishStop("the published chain on the branch is broken"); }]);
    assert.equal(r.code, 1);
    assert.equal(r.pings.length, 0);
  });
});
