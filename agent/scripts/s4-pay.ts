/**
 * Spike S4 on mainnet, OWNER ONLY: pays one 0.01 USDC x402 call to a running guard and checks the USDC landed in the
 * vault. It signs with a separate CDP buyer account (never the executor), so it needs the owner's CDP keys and wallet
 * secret in agent/.env.s4. An agent never runs this script.
 *
 * It ends with `S4 PASS` or one `S4 FAIL (...)` line (and exit code 1). The verdict comes from the settlement
 * transaction's own USDC Transfer logs, not from a balance read, so a lagging RPC node cannot flip it.
 *
 *   npm run s4:pay -- http://localhost:8080
 */
import { CdpClient } from "@coinbase/cdp-sdk";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { createPublicClient, erc20Abi, getAddress, http, type Address } from "viem";
import { base } from "viem/chains";
import { USDC } from "../src/addresses.js";
import { BASE_NETWORK, CHECK_PRICE, CHECK_PRICE_USDC6 } from "../src/guard/x402.js";
import { judgePaidResponse, usdcPaidTo } from "./s4-verdict.js";

async function main() {
  const guard = process.argv[2] ?? "http://localhost:8080";
  const vault = getAddress(process.env.MAAT_VAULT ?? "");
  const rpc = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
  const buyerName = process.env.S4_BUYER_ACCOUNT ?? "maat-s4-buyer";
  const url = `${guard}/check?token=NVDAc&side=BUY&sizeUSD=100`;

  const pub = createPublicClient({ chain: base, transport: http(rpc) });
  const usdcOf = (a: Address, blockNumber?: bigint) =>
    pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [a], ...(blockNumber === undefined ? {} : { blockNumber }) });
  const fail = (line: string) => {
    console.log(line);
    process.exitCode = 1;
  };

  // 1. Read the offer before signing anything: exactly 0.01 USDC on Base, to the vault.
  const offer = await fetch(url);
  const header = offer.headers.get("payment-required");
  if (offer.status !== 402 || !header) throw new Error(`expected a 402 with PAYMENT-REQUIRED, got ${offer.status}`);
  const accepts = (JSON.parse(Buffer.from(header, "base64").toString("utf8")).accepts ?? []) as { payTo: string; amount: string; network: string; asset: string }[];
  const ok = (r: { payTo: string; amount: string; network: string; asset: string }) =>
    getAddress(r.payTo) === vault && r.amount === CHECK_PRICE_USDC6.toString() && r.network === BASE_NETWORK && getAddress(r.asset) === getAddress(USDC);
  if (!accepts.some(ok)) throw new Error(`the guard does not offer ${CHECK_PRICE} USDC to the vault ${vault}: ${JSON.stringify(accepts)}`);

  // 2. Pay with the buyer account, capped to this one offer.
  const cdp = new CdpClient(); // CDP_API_KEY_ID / CDP_API_KEY_SECRET / CDP_WALLET_SECRET
  const buyer = await cdp.evm.getOrCreateAccount({ name: buyerName });
  const balance = await usdcOf(buyer.address);
  if (balance < CHECK_PRICE_USDC6) throw new Error(`fund ${buyer.address} with at least 0.01 USDC on Base first (has ${balance})`);
  const client = new x402Client().setSpendControls({ maxAmountPerPayment: CHECK_PRICE });
  client.registerPolicy((_v, reqs) => reqs.filter(ok));
  registerExactEvmScheme(client, { signer: { address: buyer.address, signTypedData: (m) => buyer.signTypedData(m as never) } });

  const res = await wrapFetchWithPayment(fetch, client)(url);
  console.log(`status ${res.status}: ${await res.text()}`);
  const outcome = judgePaidResponse({ status: res.status, paymentRequired: res.headers.get("payment-required"), paymentResponse: res.headers.get("payment-response") });
  if ("fail" in outcome) return fail(outcome.fail);
  console.log(`settled: tx=${outcome.settlementTx}`);

  // 3. Decide from the settlement transaction itself: the USDC it paid to the vault must be exactly the price.
  const r = await pub.waitForTransactionReceipt({ hash: outcome.settlementTx });
  if (r.status !== "success") return fail(`S4 FAIL (settlement tx reverted): ${outcome.settlementTx}`);
  const paid = usdcPaidTo(r, USDC, vault);
  try {
    const [before, after] = await Promise.all([usdcOf(vault, r.blockNumber - 1n), usdcOf(vault, r.blockNumber)]);
    console.log(`vault USDC ${before} -> ${after} (block ${r.blockNumber}; information only)`);
  } catch {
    console.log(`vault USDC at block ${r.blockNumber}: not available from this RPC node (information only)`);
  }
  if (paid !== CHECK_PRICE_USDC6) return fail(`S4 FAIL: the settlement paid ${paid} USDC units to the vault, expected ${CHECK_PRICE_USDC6}`);
  console.log("S4 PASS: x402 paid straight into the vault. Next: the agent's notifyRevenue records it.");
}

// Print only the first line of an error: a viem error's later lines can carry the RPC URL, which holds an API key.
main().catch((e: unknown) => {
  console.error(String((e as Error)?.message ?? e).split("\n")[0]);
  process.exitCode = 1;
});
