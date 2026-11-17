import { x402Facilitator } from "@x402/core/facilitator";
import type { FacilitatorClient } from "@x402/core/server";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { registerExactEvmScheme as registerClientScheme } from "@x402/evm/exact/client";
import { registerExactEvmScheme as registerFacilitatorScheme } from "@x402/evm/exact/facilitator";
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { createPublicClient, createTestClient, createWalletClient, erc20Abi, http, parseEther, parseEventLogs, type Address, type Hex, type PublicClient } from "viem";
import { base } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mandateVaultAbi } from "../../src/abi/index.js";
import { BASKET, USDC } from "../../src/addresses.js";
import { readMarketState } from "../../src/chain/market.js";
import { previewIntent } from "../../src/chain/preview.js";
import { builderSuffix } from "../../src/exec/builderCode.js";
import { encodeExecute, encodeNotifyRevenue, gasLimit, NOTIFY_GAS_FLOOR } from "../../src/exec/calls.js";
import { GuardedSender, RpcSender } from "../../src/exec/sender.js";
import { createGuardApp, type GuardClient } from "../../src/guard/app.js";
import { marketReason } from "../../src/guard/verdict.js";
import { BASE_NETWORK, CHECK_PRICE_USDC6 } from "../../src/guard/x402.js";
import { actionId } from "../../src/types.js";
import { startAnvil } from "./anvil.js";
import { deployStack } from "./deploy.js";

const RPC = process.env.BASE_RPC_URL;
const BLOCK_SESSION = 53_551_627n; // same block as agent.fork.test.ts: NYSE open, feeds fresh
const ZERO32 = `0x${"00".repeat(32)}` as const;

describe.skipIf(!RPC)("guard service on a Base fork", () => {
  let anvil: Awaited<ReturnType<typeof startAnvil>>;
  let stack: Awaited<ReturnType<typeof deployStack>>;
  let pub: PublicClient;
  const transport = () => http(anvil.url, { timeout: 600_000 });

  beforeAll(async () => {
    anvil = await startAnvil({ forkUrl: RPC!, block: BLOCK_SESSION, port: 8548 });
    stack = await deployStack(anvil.url);
    pub = createPublicClient({ chain: base, transport: transport() }) as PublicClient;
  });

  afterAll(async () => {
    await anvil?.stop();
  });

  it("matches previewIntent on the same block for every basket token (spec 6: preview parity)", async () => {
    for (const t of BASKET) {
      const s = await readMarketState(pub, stack.vault, t.address);
      const market = marketReason(s);
      const intent = (action: "BUY" | "SELL", amount: bigint) => ({
        id: ZERO32, action: actionId(action), token: t.address, amount, minOut: 0n, payee: stack.payee, rationaleHash: ZERO32,
      });
      const buy = await previewIntent(pub, stack.vault, stack.executor, intent("BUY", 1_000_000n), s.block);
      const sell = await previewIntent(pub, stack.vault, stack.executor, intent("SELL", 1n), s.block);
      // The vault checks the market first, then its own books: $1 of a $200 vault passes them; it holds no stock to sell.
      expect({ token: t.symbol, buy: buy.result }).toEqual({ token: t.symbol, buy: market });
      expect({ token: t.symbol, sell: sell.result }).toEqual({ token: t.symbol, sell: market === "OK" ? "INSUFFICIENT_BALANCE" : market });
    }
  });

  it("x402 pays straight into the vault, notifyRevenue records it, and PAY_EXPENSE spends it (S4, offline)", async () => {
    const wallet = createWalletClient({ chain: base, transport: transport() });
    const test = createTestClient({ chain: base, transport: transport(), mode: "anvil" });
    const accounts = (await wallet.getAddresses()) as Address[];
    const buyer = accounts[3]!;
    const relayer = accounts[4]!;
    const wait = (hash: Hex) => pub.waitForTransactionReceipt({ hash });

    // On Base mainnet the anvil dev accounts carry EIP-7702 delegations (code 0xef0100...), so the facilitator would
    // check the buyer's signature with ERC-1271 and answer invalid_exact_evm_signature. Make it a plain EOA, fork only.
    await test.setCode({ address: buyer, bytecode: "0x" });

    // EIP-3009 windows use the wall clock (validAfter = now - 600); bring the fork's clock to now.
    await test.setNextBlockTimestamp({ timestamp: BigInt(Math.floor(Date.now() / 1000)) });
    await test.mine({ blocks: 1 });

    // 1 USDC for the buyer from the NVDAc pool, impersonated on the fork only.
    const [, , pool] = await pub.readContract({ address: stack.vault, abi: mandateVaultAbi, functionName: "tokenConfig", args: [BASKET[0]!.address] });
    await test.impersonateAccount({ address: pool });
    await test.setBalance({ address: pool, value: parseEther("1") });
    await wait(await wallet.writeContract({ address: USDC, abi: erc20Abi, functionName: "transfer", args: [buyer, 1_000_000n], account: pool, chain: base }));
    await test.stopImpersonatingAccount({ address: pool });

    // An in-process facilitator: the same @x402/evm exact scheme CDP runs, submitting from an anvil dev account.
    const facilitatorSigner = toFacilitatorEvmSigner({
      address: relayer,
      readContract: (a) => pub.readContract(a as never),
      verifyTypedData: (a) => pub.verifyTypedData(a as never),
      writeContract: (a) => wallet.writeContract({ ...a, account: relayer, chain: base } as never),
      sendTransaction: (a) => wallet.sendTransaction({ ...a, account: relayer, chain: base }),
      waitForTransactionReceipt: (a) => pub.waitForTransactionReceipt(a),
      getCode: (a) => pub.getCode(a),
    });
    const local = registerFacilitatorScheme(new x402Facilitator(), { signer: facilitatorSigner, networks: BASE_NETWORK });
    const facilitator: FacilitatorClient = {
      verify: (p, r) => local.verify(p, r),
      settle: (p, r) => local.settle(p, r),
      getSupported: async () => local.getSupported() as never,
    };

    const app = createGuardApp({
      client: pub as GuardClient,
      vault: stack.vault,
      executor: stack.executor,
      payTo: stack.vault,
      facilitator,
      rateLimitPerMinute: 60,
      corsOrigins: [],
    });
    // The buyer signs through anvil's unlocked account (eth_signTypedData_v4): no private key in this test.
    const buyerClient = new x402Client();
    registerClientScheme(buyerClient, {
      signer: { address: buyer, signTypedData: (m) => wallet.signTypedData({ ...m, account: buyer } as never) },
    });
    const appFetch = (async (input: RequestInfo | URL, init?: RequestInit) => app.fetch(new Request(input, init))) as typeof fetch;
    const paidFetch = wrapFetchWithPayment(appFetch, buyerClient);

    const usdcOf = (a: Address) => pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [a] });
    const vaultBefore = await usdcOf(stack.vault);
    const res = await paidFetch("http://guard.test/check?token=NVDAc&side=BUY&sizeUSD=100");
    // On a 402 the PAYMENT-REQUIRED header carries the facilitator's reason: show it instead of a bare status.
    const why = res.status === 200 ? null : JSON.parse(Buffer.from(res.headers.get("payment-required") ?? "", "base64").toString("utf8") || "{}").error;
    expect({ status: res.status, why }).toEqual({ status: 200, why: null });
    const body = await res.json();
    // The clock jump left the feed hours old: the verdict is a refusal, and it is still a paid answer.
    expect(["FEED_STALE", "MARKET_CLOSED"]).toContain(body.reason);
    const receipt = decodePaymentResponseHeader(res.headers.get("payment-response")!);
    expect(receipt.success).toBe(true);
    expect((await wait(receipt.transaction as Hex)).status).toBe("success");
    expect(await usdcOf(stack.vault)).toBe(vaultBefore + CHECK_PRICE_USDC6);

    // The agent's keeper path: GuardedSender, Builder Code, gas floor.
    const sender = new GuardedSender(new RpcSender(wallet, stack.executor), { vault: stack.vault, suffix: builderSuffix("bc_maattest") });
    const notifyData = encodeNotifyRevenue();
    const notifyGas = gasLimit("notifyRevenue", await pub.estimateGas({ account: stack.executor, to: stack.vault, data: notifyData }));
    const notify = await wait(await sender.send({ to: stack.vault, data: notifyData, idempotencyKey: "fork-revenue", gas: notifyGas }));
    expect(notify.status).toBe("success");
    expect(notify.gasUsed).toBeLessThan(NOTIFY_GAS_FLOOR);
    const revenue = parseEventLogs({ abi: mandateVaultAbi, eventName: "RevenueReceived", logs: notify.logs });
    expect(revenue.map((l) => l.args.amount)).toEqual([CHECK_PRICE_USDC6]);

    const payeeBefore = await usdcOf(stack.payee);
    const pay = { id: `0x${"5e".repeat(32)}` as Hex, action: actionId("PAY_EXPENSE"), token: USDC, amount: CHECK_PRICE_USDC6, minOut: 0n, payee: stack.payee, rationaleHash: ZERO32 };
    const payData = encodeExecute(pay);
    const payGas = gasLimit("execute", await pub.estimateGas({ account: stack.executor, to: stack.vault, data: payData }));
    const paid = await wait(await sender.send({ to: stack.vault, data: payData, idempotencyKey: "fork-expense", gas: payGas }));
    const decision = parseEventLogs({ abi: mandateVaultAbi, eventName: "Decision", logs: paid.logs })[0]!;
    expect(decision.args.allowed).toBe(true);
    expect(await usdcOf(stack.payee)).toBe(payeeBefore + CHECK_PRICE_USDC6);
  });
});
