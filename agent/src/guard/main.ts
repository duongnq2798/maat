import { createCdpFacilitatorClient } from "@coinbase/cdp-sdk/x402";
import { serve } from "@hono/node-server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { createPublicClient, http, type PublicClient } from "viem";
import { base } from "viem/chains";
import { createGuardApp } from "./app.js";
import { loadGuardConfig } from "./config.js";

const cfg = loadGuardConfig();
// Same cast as runtime.ts: it only erases the OP-stack deposit-tx types the narrow client interfaces do not model.
const client = createPublicClient({ chain: base, transport: http(cfg.rpcUrl) }) as PublicClient;
const facilitator =
  cfg.facilitator.kind === "url"
    ? new HTTPFacilitatorClient({ url: cfg.facilitator.url })
    : createCdpFacilitatorClient({ apiKeyId: cfg.facilitator.apiKeyId, apiKeySecret: cfg.facilitator.apiKeySecret });

const app = createGuardApp({
  client,
  vault: cfg.vault,
  executor: cfg.executor,
  payTo: cfg.payTo,
  facilitator,
  rateLimitPerMinute: cfg.rateLimitPerMinute,
  corsOrigins: cfg.corsOrigins,
  ...(cfg.builderCode ? { builderCode: cfg.builderCode } : {}),
});

const server = serve({ fetch: app.fetch, port: cfg.port, hostname: "0.0.0.0" }, (info) => {
  // Never log cfg.rpcUrl: it carries the RPC provider's key.
  console.log(`maat guard: port=${info.port} vault=${cfg.vault} payTo=${cfg.payTo} facilitator=${cfg.facilitator.kind}`);
});
for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => server.close());
