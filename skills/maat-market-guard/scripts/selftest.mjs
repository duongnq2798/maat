#!/usr/bin/env node
// maat-market-guard selftest. Offline by default: every JSON-RPC answer comes from fixtures/rpc.json, recorded
// read-only from Base mainnet, and a call to fetch() fails the run, so it never touches the network.
// `--record` runs the same cases against a live RPC instead (MAAT_GUARD_RPC_URL, else https://mainnet.base.org; it must
// serve state at the two pinned blocks below) and rewrites fixtures/rpc.json. eth_call and eth_getBlockByNumber only.
// Exit 0 when every check passes; otherwise 1, naming each failing check.

import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { DEFAULT_RPC, RPC_ENV, ADDRESSES, REASONS, TOKENS, check, encodePreviewIntent, httpTransport } from "./check.mjs";

const FIXTURES = fileURLToPath(new URL("./fixtures/rpc.json", import.meta.url));
const RECORD = process.argv.includes("--record");

// The two Base mainnet blocks the chain cases run at.
const SESSION_BLOCK = "61764125"; // Tue 2026-11-24 18:00:00 UTC (13:00 ET): in the NYSE session
const CLOSED_BLOCK = "62087947"; // Wed 2026-11-25 11:59:25 UTC (06:59 ET): before the open

const DEAD = "0x000000000000000000000000000000000000dead";
const lower = (a) => a.toLowerCase();

const keyOf = (method, params) => `${method} ${JSON.stringify(params)}`;

/** The transport the chain cases use: the recorded answers, or the live RPC while recording. */
function chainTransport() {
  if (RECORD) {
    const live = httpTransport(process.env[RPC_ENV] || DEFAULT_RPC);
    const seen = new Map();
    const transport = async (method, params) => {
      const key = keyOf(method, params);
      if (!seen.has(key)) {
        let result = await live(method, params);
        // A block keeps the fields the check reads, and its hash to look it up by.
        if (method === "eth_getBlockByNumber" && result) result = { number: result.number, hash: result.hash, timestamp: result.timestamp };
        seen.set(key, { method, params, result });
      }
      return seen.get(key).result;
    };
    return { transport, calls: () => [...seen.values()] };
  }
  const fixture = JSON.parse(readFileSync(FIXTURES, "utf8"));
  const answers = new Map(fixture.calls.map((c) => [keyOf(c.method, c.params), c.result]));
  const transport = async (method, params) => {
    const key = keyOf(method, params);
    if (!answers.has(key)) throw new Error(`no recorded answer for ${key}`);
    return answers.get(key);
  };
  return { transport, calls: () => fixture.calls, fixture };
}

/** A transport that fails the case if the check calls it: input errors must be caught before any RPC call. */
const noCalls = async (method) => {
  throw new Error(`made an RPC call (${method}) on bad input`);
};

/** A fetch stand-in for httpTransport: answers every request with `respond()`. */
const fakeFetch = (respond) => async () => respond();

const results = [];
function expectFields(name, actual, expected) {
  const bad = Object.entries(expected).filter(([k, v]) => JSON.stringify(actual?.[k]) !== JSON.stringify(v));
  results.push({
    name,
    pass: bad.length === 0,
    detail: bad.map(([k, v]) => `${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(actual?.[k])}`).join("; "),
  });
}
function expectTrue(name, cond, detail = "") {
  results.push({ name, pass: Boolean(cond), detail });
}

async function run(name, argv, transport, expected, extra) {
  let out;
  try {
    out = await check(argv, { transport, env: {} });
  } catch (e) {
    results.push({ name, pass: false, detail: `threw: ${e?.message ?? e}` });
    return undefined;
  }
  expectFields(name, { exitCode: out.exitCode, ...out.result }, expected);
  if (extra) extra(out.result);
  return out.result;
}

if (!RECORD) {
  // Offline means offline: the chain cases read fixtures, and any real request fails the run.
  globalThis.fetch = () => {
    throw new Error("the selftest made a network call");
  };
}

const chain = chainTransport();
const t = chain.transport;

// ---------------------------------------------------------------- market: the vault's calendar
await run("market open: Tue 2026-11-24 10:00 ET", ["market", "--block", CLOSED_BLOCK, "--at", "2026-11-24T15:00:00Z"], t, {
  exitCode: 0,
  check: "market",
  allowed: true,
  open: true,
  reason: 0,
  reasonName: "OK",
  closedBecause: null,
  session: "REGULAR",
  calendar: lower(ADDRESSES.MarketCalendar),
  vault: lower(ADDRESSES.MandateVault),
}, (r) => {
  expectFields("market open: local time", r.at, { unix: 1795532400, utc: "2026-11-24T15:00:00.000Z", et: "2026-11-24 10:00", weekday: "Tue" });
  expectFields("market open: block", r.block, { number: 62087947, timestamp: 1795607965 });
});

await run("market closed: Thanksgiving 2026-11-26 is a holiday", ["market", "--block", CLOSED_BLOCK, "--at", "2026-11-26T15:00:00Z"], t, {
  exitCode: 1,
  allowed: false,
  open: false,
  reason: 6,
  reasonName: "MARKET_CLOSED",
  closedBecause: "holiday",
  earlyClose: null,
}, (r) => expectFields("market closed (holiday): local time", r.at, { et: "2026-11-26 10:00", weekday: "Thu" }));

await run("market closed: Fri 2026-11-27 13:30 ET is past the 13:00 early close", ["market", "--block", CLOSED_BLOCK, "--at", "2026-11-27T18:30:00Z"], t, {
  exitCode: 1,
  reasonName: "MARKET_CLOSED",
  closedBecause: "early-close",
  earlyClose: "13:00",
});

await run("market closed: Saturday", ["market", "--block", CLOSED_BLOCK, "--at", "2026-11-28T15:00:00Z"], t, {
  exitCode: 1,
  reasonName: "MARKET_CLOSED",
  closedBecause: "weekend",
});

await run("market now (block time): Wed 06:59 ET is before the open", ["market", "--block", CLOSED_BLOCK], t, {
  exitCode: 1,
  open: false,
  reasonName: "MARKET_CLOSED",
  closedBecause: "before-open",
}, (r) => expectFields("market now: local time is the block's", r.at, { unix: 1795607965, et: "2026-11-25 06:59", weekday: "Wed" }));

await run("market now, Chainlink feed session: open on a weekday morning", ["market", "--block", CLOSED_BLOCK, "--session", "feed"], t, {
  exitCode: 0,
  open: true,
  reasonName: "OK",
  session: "FEED_24_5",
});

// ---------------------------------------------------------------- preview: the live vault's verdict
await run("preview ALLOW: BUY $1 of NVDAc in session", ["preview", "--block", SESSION_BLOCK, "--action", "BUY", "--token", "NVDAc", "--amount", "1"], t, {
  exitCode: 0,
  check: "preview",
  allowed: true,
  reason: 0,
  reasonName: "OK",
  label: "All checks passed",
  from: "0x3c3a66f713dae7e4a03bbd81db79ff65f42c1d6a",
}, (r) => {
  expectFields("preview ALLOW: intent", r.intent, { action: "BUY", actionId: 0, token: lower(TOKENS.NVDAc), symbol: "NVDAc", amount: "1000000" });
  expectFields("preview ALLOW: block", r.block, { number: 61764125, timestamp: 1795543200 });
});

await run("preview refusal: BUY $5 of NVDAc in session is CONCENTRATION", ["preview", "--block", SESSION_BLOCK, "--action", "BUY", "--token", "nvdac", "--amount", "5"], t, {
  exitCode: 1,
  allowed: false,
  reason: 12,
  reasonName: "CONCENTRATION",
  group: "Limits",
});

await run("preview refusal: BUY $60 of NVDAc is INSUFFICIENT_BALANCE", ["preview", "--block", SESSION_BLOCK, "--action", "BUY", "--token", "NVDAc", "--amount", "60"], t, {
  exitCode: 1,
  reason: 14,
  reasonName: "INSUFFICIENT_BALANCE",
});

await run("preview refusal: BUY $1 of NVDAc before the open is MARKET_CLOSED", ["preview", "--block", CLOSED_BLOCK, "--action", "BUY", "--token", "NVDAc", "--amount", "1"], t, {
  exitCode: 1,
  reason: 6,
  reasonName: "MARKET_CLOSED",
  group: "Market",
  label: "Market closed",
});

await run("preview refusal: PAY_EXPENSE to an unlisted payee is PAYEE_NOT_ALLOWED", ["preview", "--block", CLOSED_BLOCK, "--action", "PAY_EXPENSE", "--payee", DEAD, "--amount", "1"], t, {
  exitCode: 1,
  reason: 13,
  reasonName: "PAYEE_NOT_ALLOWED",
}, (r) => expectFields("PAY_EXPENSE pays USDC", r.intent, { token: lower(TOKENS.USDC), symbol: "USDC", payee: DEAD, amount: "1000000" }));

await run("preview refusal: SELL of USDC is TOKEN_NOT_ALLOWED", ["preview", "--block", SESSION_BLOCK, "--action", "SELL", "--token", "USDC", "--raw", "1"], t, {
  exitCode: 1,
  reason: 3,
  reasonName: "TOKEN_NOT_ALLOWED",
});

await run("preview ALLOW: SUPPLY 0.01 NVDAc while closed (adding collateral lowers risk)", ["preview", "--block", CLOSED_BLOCK, "--action", "SUPPLY", "--token", "NVDAc", "--amount", "0.01"], t, {
  exitCode: 0,
  reasonName: "OK",
}, (r) => expectFields("SUPPLY reads the token's decimals", r.intent, { amount: "1000000" }));

// ---------------------------------------------------------------- no answer: fail closed
const unknown = { exitCode: 2, allowed: false, reason: null, reasonName: "UNKNOWN" };

await run("RPC down (HTTP 503) is UNKNOWN, exit 2", ["market"], httpTransport("https://rpc.example", { fetchImpl: fakeFetch(() => new Response("busy", { status: 503 })) }), unknown,
  (r) => expectTrue("RPC down: says why", /HTTP 503/.test(r.error ?? ""), r.error));

await run("a JSON-RPC error is UNKNOWN, exit 2", ["preview", "--action", "BUY", "--token", "NVDAc", "--amount", "1"], httpTransport("https://rpc.example", {
  fetchImpl: fakeFetch(
    () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32005, message: "rate limited" } }), {
        headers: { "content-type": "application/json" },
      }),
  ),
}), unknown, (r) => expectTrue("JSON-RPC error: quotes the code", /-32005/.test(r.error ?? ""), r.error));

{
  const out = await check(["market", "--rpc", "https://rpc.example/v2/fake-key-0123"], {
    transport: async () => {
      throw new Error("unreachable");
    },
    env: {},
  }).catch((e) => ({ thrown: e }));
  expectTrue("a non-RPC failure is not swallowed as a verdict", out.thrown instanceof Error, JSON.stringify(out.result ?? null));
  const fail = await check(["market", "--rpc", "https://rpc.example/v2/fake-key-0123"], {
    transport: httpTransport("https://rpc.example/v2/fake-key-0123", { fetchImpl: fakeFetch(() => new Response("", { status: 500 })) }),
    env: {},
  });
  expectFields("the output names the RPC host only", fail.result, { rpc: "rpc.example" });
  expectTrue("the output never holds the RPC path or key", !JSON.stringify(fail.result).includes("fake-key"), JSON.stringify(fail.result));
  const fromEnv = await check(["market"], {
    transport: httpTransport("https://env.example", { fetchImpl: fakeFetch(() => new Response("", { status: 500 })) }),
    env: { [RPC_ENV]: "https://env.example/path" },
  });
  expectFields(`${RPC_ENV} sets the RPC`, fromEnv.result, { rpc: "env.example" });
  const byDefault = await check(["market"], {
    transport: httpTransport(DEFAULT_RPC, { fetchImpl: fakeFetch(() => new Response("", { status: 500 })) }),
    env: {},
  });
  expectFields("the default RPC is the public Base endpoint", byDefault.result, { rpc: new URL(DEFAULT_RPC).host });
}

// ---------------------------------------------------------------- bad input: no RPC call, exit 2
const usage = [
  ["no command", []],
  ["an unknown command", ["trade"]],
  ["BUY without --token", ["preview", "--action", "BUY", "--amount", "1"], /--token/],
  ["an unknown token symbol", ["preview", "--action", "BUY", "--token", "TSLAc", "--amount", "1"], /TSLAc/],
  ["an unknown action", ["preview", "--action", "SHORT", "--token", "NVDAc", "--amount", "1"], /SHORT/],
  ["no amount", ["preview", "--action", "BUY", "--token", "NVDAc"], /--amount/],
  ["both --amount and --raw", ["preview", "--action", "BUY", "--token", "NVDAc", "--amount", "1", "--raw", "1"], /--raw/],
  ["more decimals than USDC has", ["preview", "--action", "BUY", "--token", "NVDAc", "--amount", "1.0000001"], /decimals/],
  ["a negative amount", ["preview", "--action", "BUY", "--token", "NVDAc", "--amount", "-1"], /--amount/],
  ["PAY_EXPENSE without --payee", ["preview", "--action", "PAY_EXPENSE", "--amount", "1"], /--payee/],
  ["a time with no zone", ["market", "--at", "2026-11-26T10:00"], /--at/],
  ["a bad block", ["market", "--block", "yesterday"], /--block/],
  ["a bad session", ["market", "--session", "overnight"], /--session/],
  ["an unknown flag", ["market", "--fast"], /--fast/],
  ["a flag with no value", ["market", "--at"], /--at/],
  ["a non-http RPC", ["market", "--rpc", "ws://rpc.example"], /--rpc/],
  ["a bad --from", ["preview", "--action", "BUY", "--token", "NVDAc", "--amount", "1", "--from", "0x12"], /--from/],
];
for (const [name, argv, pattern] of usage) {
  await run(`bad input, ${name}: exit 2 before any RPC call`, argv, noCalls, unknown, (r) => {
    if (pattern) expectTrue(`bad input, ${name}: says which`, pattern.test(r.error ?? ""), r.error);
  });
}

{
  const help = await check(["--help"], { transport: noCalls, env: {} });
  expectTrue("--help prints the usage and exits 0", help.exitCode === 0 && /check\.mjs market/.test(help.text ?? ""), help.text);
}

// ---------------------------------------------------------------- offline: encoding and the reason list
expectTrue(
  "previewIntent calldata matches cast calldata",
  encodePreviewIntent({
    id: `0x${"11".repeat(32)}`,
    action: 6,
    token: TOKENS.USDC,
    amount: 1_500_000n,
    minOut: 7n,
    payee: "0x000000000000000000000000000000000000dEaD",
    rationaleHash: `0x${"22".repeat(32)}`,
  }) ===
    "0x0ee774db" +
      "1111111111111111111111111111111111111111111111111111111111111111" +
      "0000000000000000000000000000000000000000000000000000000000000006" +
      "000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913" +
      "000000000000000000000000000000000000000000000000000000000016e360" +
      "0000000000000000000000000000000000000000000000000000000000000007" +
      "000000000000000000000000000000000000000000000000000000000000dead" +
      "2222222222222222222222222222222222222222222222222222222222222222",
);

{
  const out = await check(["reasons"], { transport: noCalls, env: {} });
  const names = out.result?.reasons?.map((r) => r.name) ?? [];
  expectTrue("reasons: OK and the 19 refusals, in the order of enum Reason", out.exitCode === 0 && names.length === 20 && names[0] === "OK" && names[19] === "DERISK_WINDOW", names.join(","));
  expectTrue("reasons: ids are the enum values", out.result?.reasons?.every((r, i) => r.id === i) ?? false);
  expectTrue("reasons: the exported list is the one printed", JSON.stringify(REASONS.map((r) => r.name)) === JSON.stringify(names));
}

// ---------------------------------------------------------------- report
if (RECORD) {
  const calls = chain.calls();
  writeFileSync(
    FIXTURES,
    `${JSON.stringify(
      {
        note: "Read-only JSON-RPC answers from Base mainnet, recorded by `node scripts/selftest.mjs --record` (a block keeps its number, hash and timestamp). The offline selftest serves them.",
        recorded: new Date().toISOString(),
        rpc: new URL(process.env[RPC_ENV] || DEFAULT_RPC).host,
        calls,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`recorded ${calls.length} answers to ${FIXTURES}`);
}

const failed = results.filter((r) => !r.pass);
for (const r of failed) console.error(`FAIL ${r.name}${r.detail ? `: ${r.detail}` : ""}`);
const mode = RECORD ? "live, read-only" : `offline, fixtures recorded ${chain.fixture?.recorded ?? "?"} from ${chain.fixture?.rpc ?? "?"}`;
console.log(`selftest: ${results.length - failed.length}/${results.length} passed (${mode})`);
process.exit(failed.length === 0 ? 0 : 1);
