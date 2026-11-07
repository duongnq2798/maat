import { x402ResourceServer, type FacilitatorClient, type RoutesConfig } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { BUILDER_CODE, builderCodeResourceServerExtension, declareBuilderCodeExtension } from "@x402/extensions/builder-code";
import { paymentMiddleware } from "@x402/hono";
import type { MiddlewareHandler } from "hono";
import type { Address } from "viem";

/** CAIP-2 id of Base mainnet. The exact scheme turns a "$" price into USDC on this network. */
export const BASE_NETWORK = "eip155:8453" as const;
export const CHECK_PRICE = "$0.01";
/** CHECK_PRICE in USDC units: what a buyer signs for and what reaches payTo. */
export const CHECK_PRICE_USDC6 = 10_000n;

export function checkRoutes(payTo: Address, builderCode?: string): RoutesConfig {
  return {
    "GET /check": {
      accepts: { scheme: "exact", price: CHECK_PRICE, network: BASE_NETWORK, payTo, maxTimeoutSeconds: 120 },
      description: "Market-safety verdict for one B20 stock trade on Base (GuardLib.checkMarket off-chain)",
      mimeType: "application/json",
      ...(builderCode ? { extensions: { [BUILDER_CODE]: declareBuilderCodeExtension(builderCode) } } : {}),
    },
  };
}

/**
 * Charges CHECK_PRICE for GET /check and settles after the handler, only when it answers below 400. The facilitator
 * submits the EIP-3009 transfer and pays its gas; the guard never signs.
 */
export function checkPayment(facilitator: FacilitatorClient, payTo: Address, builderCode?: string): MiddlewareHandler {
  const server = new x402ResourceServer(facilitator).register(BASE_NETWORK, new ExactEvmScheme());
  if (builderCode) server.registerExtension(builderCodeResourceServerExtension);
  return paymentMiddleware(checkRoutes(payTo, builderCode), server);
}
