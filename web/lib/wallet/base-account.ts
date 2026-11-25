import { BASE_CHAIN_ID } from "@/lib/chain/config";
import { SITE } from "@/lib/site";
import type { Eip1193Provider } from "./eip6963";

let provider: Promise<Eip1193Provider> | null = null;

/**
 * The Base Account (smart wallet) provider of @base-org/account, created on first use: the SDK is loaded only when a
 * visitor picks Base Account, so the page does not download it otherwise. Base mainnet only; the SDK's telemetry is off.
 */
export function baseAccountProvider(): Promise<Eip1193Provider> {
  provider ??= import("@base-org/account")
    .then(({ createBaseAccountSDK }) =>
      createBaseAccountSDK({ appName: SITE.name, appLogoUrl: null, appChainIds: [BASE_CHAIN_ID], preference: { telemetry: false } }).getProvider() as Eip1193Provider,
    )
    .catch((e: unknown) => {
      provider = null;
      throw e;
    });
  return provider;
}

/** Forgets the provider, for tests. */
export function resetBaseAccountProvider(): void {
  provider = null;
}
