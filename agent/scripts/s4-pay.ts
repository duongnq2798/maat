/**
 * Spike S4 on mainnet, OWNER ONLY: pays one 0.01 USDC x402 call to a running guard and checks the USDC landed in the
 * vault. It signs with a separate CDP buyer account (never the executor), so it needs the owner's CDP keys and wallet
 * secret in agent/.env.s4. An agent never runs this script.
 *
 *   npm run s4:pay -- http://localhost:8080
 */
import { CdpClient } from "@coinbase/cdp-sdk";
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { createPublicClient, erc20Abi, getAddress, http, type Address, type Hex } from "viem";
import { base } from "viem/chains";
import { USDC } from "../src/addresses.js";
import { BASE_NETWORK, CHECK_PRICE, CHECK_PRICE_USDC6 } from "../src/guard/x402.js";

const guard = process.argv[2] ?? "http://localhost:8080";
const vault = getAddress(process.env.MAAT_VAULT ?? "");
const rpc = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
const buyerName = process.env.S4_BUYER_ACCOUNT ?? "maat-s4-buyer";
const url = `${guard}/check?token=NVDAc&side=BUY&sizeUSD=100`;

const pub = createPublicClient({ chain: base, transport: http(rpc) });
const usdcOf = (a: Address) => pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [a] });

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

const before = await usdcOf(vault);
const res = await wrapFetchWithPayment(fetch, client)(url);
console.log(`status ${res.status}: ${await res.text()}`);
const paid = res.headers.get("payment-response");
if (!paid) throw new Error("no PAYMENT-RESPONSE header: the payment did not settle");
const settle = decodePaymentResponseHeader(paid);
console.log(`settled: success=${settle.success} tx=${settle.transaction}`);
const r = await pub.waitForTransactionReceipt({ hash: settle.transaction as Hex });
const after = await usdcOf(vault);
console.log(`vault USDC ${before} -> ${after} (tx status ${r.status})`);
if (after - before !== CHECK_PRICE_USDC6) throw new Error("S4 FAIL: the vault did not receive exactly 0.01 USDC; use the GUARD_PAY_TO fallback");
console.log("S4 PASS: x402 paid straight into the vault. Next: the agent's notifyRevenue records it.");
