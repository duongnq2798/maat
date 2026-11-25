// Offline helper for the vault owner: builds one BUY intent and prints its calldata and cast command templates.
//   node --import tsx scripts/first-decision.ts --vault 0xVault --token NVDAc --salt sat-1 --builder-code bc_xxxxxxxx
// Run it from agent/ after `npm ci`. It makes no network call, reads no settings file and no environment variable,
// holds no key and sends nothing. The owner runs the printed commands, signed with their own keystore.
//
// The intent is the one the agent builds for a BUY (src/intent.ts buildIntent), encoded by the same code
// (src/exec/calls.ts encodeExecute) and tagged with the same suffix (src/exec/builderCode.ts builderSuffix and
// withSuffix, the bytes GuardedSender in src/exec/sender.ts sends):
// - id: the agent's intentId(runId, index), with runId "first-decision:<salt>" and index 0, or the 32-byte --id as
//   given. execute() reverts with IntentAlreadyUsed on an id it has seen, so every send needs a new salt.
// - action 0 (BUY); token from BASKET in src/addresses.ts; amount = the dollars in USDC units (6 decimals).
// - minOut 0, as the agent sends it. This tool reads no price, and it needs none: for a BUY the vault computes
//   expectedOut from the Chainlink price and swaps with minOut = max(intent.minOut, expectedOut x (10000 -
//   maxSlippageBps) / 10000) (MandateVault._perform), so 0 means "the vault's own oracle floor". A floor set
//   offline from an old price could only be stale, and the vault would still apply its own.
// - payee: the zero address (BUY); rationaleHash: keccak256 of the --rationale text.
// - The amount is not clamped to the vault's USDC balance, which takes a read. The vault answers
//   INSUFFICIENT_BALANCE instead, after the market checks.
// --builder-code is the code as Base Dashboard shows it. A hex form (0x and hex digits only) is refused, and the
// tool prints the codes it reads back from its own execute calldata, so the owner can check them before sending.
// Send execute with an explicit gas limit, EXECUTE_GAS_FLOOR, as the agent does: src/exec/calls.ts says why an
// estimate alone is unsafe for this vault.
// SELL is not offered: its amount is a raw stock amount, and converting dollars to it takes the live price.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { encodeFunctionData, getAbiItem, getAddress, isAddress, isHex, parseUnits, size, toEventSelector, zeroAddress, type Address, type Hex } from "viem";
import { mandateVaultAbi } from "../src/abi/index.js";
import { BASKET, type TokenSymbol } from "../src/addresses.js";
import { BUILDER_CODE_RE, builderSuffix, codesIn, withSuffix } from "../src/exec/builderCode.js";
import { EXECUTE_GAS_FLOOR, encodeExecute } from "../src/exec/calls.js";
import { intentId, rationaleHash } from "../src/intent.js";
import { actionId, REASONS, type OnchainIntent } from "../src/types.js";
import { USDC_DECIMALS } from "../src/units.js";

export const RUN_ID_PREFIX = "first-decision:";
export const DEFAULT_USD = "5";
/** The struct as cast spells it, for `cast decode-calldata`. */
export const INTENT_TUPLE = "(bytes32,uint8,address,uint256,uint256,address,bytes32)";
export const DECISION_SIG =
  "Decision(bytes32 indexed intentId,uint8 action,address indexed token,uint256 amount,bool allowed,uint8 reason,bytes32 rationaleHash)";
export const DECISION_TOPIC: Hex = toEventSelector(getAbiItem({ abi: mandateVaultAbi, name: "Decision" }));

export interface FirstDecisionInput {
  vault: string;
  token: string;
  builderCode: string;
  action?: string;
  usd?: string;
  id?: string;
  salt?: string;
  rationale?: string;
}

export interface FirstDecision {
  vault: Address;
  symbol: TokenSymbol;
  usd: string;
  /** Set when the id comes from --salt. */
  runId: string | null;
  rationale: string;
  builderCode: string;
  suffix: Hex;
  /** The Builder Codes read back from executeCalldata with ox's Attribution.fromData. */
  codesInCalldata: readonly string[];
  intent: OnchainIntent;
  /** previewIntent(intent): a free eth_call. */
  previewCalldata: Hex;
  /** execute(intent) followed by the ERC-8021 suffix: what the owner signs. */
  executeCalldata: Hex;
}

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

/** At most 9 digits before the point and 6 after: the text is parsed as written, never through a JS number. */
const USD_RE = /^\d{1,9}(\.\d{1,6})?$/;
const ZERO_ID: Hex = `0x${"00".repeat(32)}`;
/** A hex form copied from a web page, such as 0x6d61..., which BUILDER_CODE_RE alone would let through. */
const HEX_FORM_RE = /^0x[0-9a-f]*$/;

export function buildFirstDecision(input: FirstDecisionInput): FirstDecision {
  if (!isAddress(input.vault)) {
    throw new InputError(`--vault ${input.vault} is not an address (0x and 40 hex digits; a mixed-case one must have a valid checksum)`);
  }
  const vault = getAddress(input.vault);
  if (vault === zeroAddress) throw new InputError("--vault is the zero address");

  const action = (input.action ?? "BUY").toUpperCase();
  if (action === "SELL") {
    throw new InputError("--action SELL is not offered: a SELL amount is a raw stock amount, and converting dollars to it takes the live price");
  }
  if (action !== "BUY") throw new InputError(`--action ${input.action} is not supported; use BUY`);

  const listed = BASKET.find((t) => t.symbol.toLowerCase() === input.token.toLowerCase());
  if (!listed) throw new InputError(`--token ${input.token} is not in the basket; use ${BASKET.map((t) => t.symbol).join(", ")}`);

  const usd = input.usd ?? DEFAULT_USD;
  if (!USD_RE.test(usd)) {
    throw new InputError(`--usd ${usd} is not a plain dollar amount with at most 9 digits before the point and 6 after, such as 5 or 5.25`);
  }
  const amount = parseUnits(usd, USDC_DECIMALS);
  if (amount <= 0n) throw new InputError(`--usd ${usd} must be more than 0`);

  if ((input.id === undefined) === (input.salt === undefined)) throw new InputError("give exactly one of --id and --salt");
  let id: Hex;
  let runId: string | null = null;
  if (input.id !== undefined) {
    if (!isHex(input.id, { strict: true }) || size(input.id) !== 32) throw new InputError(`--id ${input.id} is not 0x and 64 hex digits`);
    id = input.id.toLowerCase() as Hex;
    if (id === ZERO_ID) throw new InputError("--id is all zeros; pick a unique id or use --salt");
  } else {
    const salt = input.salt as string;
    if (salt.trim() === "") throw new InputError("--salt is empty");
    runId = `${RUN_ID_PREFIX}${salt}`;
    id = intentId(runId, 0);
  }

  if (!BUILDER_CODE_RE.test(input.builderCode)) {
    throw new InputError(`--builder-code ${JSON.stringify(input.builderCode)} does not match ${BUILDER_CODE_RE.source}`);
  }
  if (HEX_FORM_RE.test(input.builderCode)) {
    throw new InputError(
      `--builder-code ${JSON.stringify(input.builderCode)} is a hex form; give the code exactly as Base Dashboard shows it (deployments/go-live.md step 2, item 3)`,
    );
  }
  const suffix = builderSuffix(input.builderCode);

  const rationale = input.rationale ?? `Owner-sent first decision: BUY ${usd} USD of ${listed.symbol}`;
  if (rationale.trim() === "") throw new InputError("--rationale is empty");

  const intent: OnchainIntent = {
    id,
    action: actionId("BUY"),
    token: getAddress(listed.address),
    amount,
    minOut: 0n,
    payee: zeroAddress,
    rationaleHash: rationaleHash(rationale),
  };
  const executeCalldata = withSuffix(encodeExecute(intent), suffix);
  const codesInCalldata = codesIn(executeCalldata);
  if (codesInCalldata.length !== 1 || codesInCalldata[0] !== input.builderCode) {
    throw new Error(`the execute calldata carries the codes ${JSON.stringify(codesInCalldata)}, not ${JSON.stringify([input.builderCode])}`);
  }
  return {
    vault,
    symbol: listed.symbol,
    usd,
    runId,
    rationale,
    builderCode: input.builderCode,
    suffix,
    codesInCalldata,
    intent,
    previewCalldata: encodeFunctionData({ abi: mandateVaultAbi, functionName: "previewIntent", args: [intent] }),
    executeCalldata,
  };
}

export function render(d: FirstDecision): string {
  const i = d.intent;
  const idSource = d.runId === null ? "from --id" : `intentId("${d.runId}", 0), as the agent derives ids`;
  return [
    "first-decision.ts: offline. No network call, no settings read, no key; nothing was sent.",
    "",
    "Intent",
    `  id             ${i.id}  (${idSource})`,
    `  action         ${i.action} (BUY)`,
    `  token          ${i.token} (${d.symbol})`,
    `  amount         ${i.amount} (${d.usd} USD in USDC units, 6 decimals)`,
    `  minOut         ${i.minOut} (the vault applies its own oracle floor, maxSlippageBps)`,
    `  payee          ${i.payee}`,
    `  rationaleHash  ${i.rationaleHash}`,
    `  rationale      ${JSON.stringify(d.rationale)} (keep this text: the chain stores only its hash)`,
    `Builder Code     ${d.builderCode}, ERC-8021 suffix ${d.suffix} (${size(d.suffix)} bytes)`,
    `Codes in calldata ${JSON.stringify(d.codesInCalldata)} (read back from the execute calldata below)`,
    "",
    "1. previewIntent(intent) calldata, for a free read-only eth_call:",
    d.previewCalldata,
    "",
    "2. execute(intent) calldata, Builder Code suffix included (this is what you sign):",
    d.executeCalldata,
    "",
    "OWNER-RUN command templates. This tool ran none of them. Set RPC to your Base RPC URL yourself first.",
    "",
    `  VAULT=${d.vault}`,
    "",
    "  # a. Check the calldata offline: the decoded tuple must be the intent above.",
    `  cast decode-calldata "execute(${INTENT_TUPLE})" ${d.executeCalldata}`,
    "",
    "  # b. Dry run, free and read-only, from the executor (the vault's policy check reads tx.origin).",
    `  EXECUTOR=$(cast call "$VAULT" "executor()(address)" --rpc-url "$RPC")`,
    `  cast call "$VAULT" --data ${d.previewCalldata} --from "$EXECUTOR" --rpc-url "$RPC"`,
    "  cast to-dec <the 0x... word it prints>     # the Reason id: 0 = OK, 6 = MARKET_CLOSED",
    "",
    "  # Before c: the Builder Code and Codes in calldata lines above must show your code exactly as Base Dashboard",
    "  # shows it, and the execute calldata must end with the suffix on the Builder Code line. Otherwise do not send.",
    "",
    "  # c. Send it, signed by the executor's keystore. The gas limit is the agent's execute floor.",
    `  cast send "$VAULT" --data ${d.executeCalldata} --gas-limit ${EXECUTE_GAS_FLOOR} --account <your-keystore> --rpc-url "$RPC"`,
    "",
    "  # d. Read the Decision log of that transaction (topic 0 is the event, topic 1 the intent id).",
    `  cast receipt <tx hash> --rpc-url "$RPC"`,
    `  cast decode-event --sig "${DECISION_SIG}" <data of the log whose topic 1 is the intent id>`,
    "  # prints action, amount, allowed, reason, rationaleHash; or open https://basescan.org/tx/<tx hash> and read its Logs tab",
    "",
    `Decision topic 0  ${DECISION_TOPIC}`,
    `Decision topic 1  ${i.id}`,
    `Reason ids        ${REASONS.map((r, n) => `${n} ${r}`).join(", ")}`,
  ].join("\n");
}

export const USAGE = [
  "usage: node --import tsx scripts/first-decision.ts --vault <address> --token NVDAc|GOOGLc|AAPLc",
  "         --builder-code <code> (--salt <text> | --id <0x + 64 hex>) [--usd 5] [--action BUY] [--rationale <text>]",
].join("\n");

/** Returns the process exit code: 0 printed, 1 invalid input, 2 unreadable flags. */
export function main(argv: readonly string[], out: (s: string) => void = console.log, err: (s: string) => void = console.error): number {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      strict: true,
      allowPositionals: false,
      options: {
        vault: { type: "string" },
        action: { type: "string" },
        token: { type: "string" },
        usd: { type: "string" },
        id: { type: "string" },
        salt: { type: "string" },
        "builder-code": { type: "string" },
        rationale: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    }));
  } catch (e) {
    err(`first-decision: ${(e as Error).message}`);
    err(USAGE);
    return 2;
  }
  if (values.help === true) {
    out(USAGE);
    return 0;
  }
  const str = (k: string) => (typeof values[k] === "string" ? (values[k] as string) : undefined);
  const missing = ["vault", "token", "builder-code"].filter((k) => str(k) === undefined);
  if (missing.length > 0) {
    err(`first-decision: missing ${missing.map((k) => `--${k}`).join(", ")}`);
    err(USAGE);
    return 1;
  }
  try {
    const d = buildFirstDecision({
      vault: str("vault") as string,
      token: str("token") as string,
      builderCode: str("builder-code") as string,
      action: str("action"),
      usd: str("usd"),
      id: str("id"),
      salt: str("salt"),
      rationale: str("rationale"),
    });
    out(render(d));
    return 0;
  } catch (e) {
    if (!(e instanceof InputError)) throw e;
    err(`first-decision: ${e.message}`);
    err(USAGE);
    return 1;
  }
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) process.exitCode = main(process.argv.slice(2));
