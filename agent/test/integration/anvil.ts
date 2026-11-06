import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

/**
 * Stock anvil (--network base) serves B20 decimals() but reverts on uiMultiplier(), so the vault cannot be deployed.
 * Base's Foundry fork (`base-foundryup` installs `base-anvil`) runs the full B20 precompile: it is plain anvil with
 * `--base` and FOUNDRY_BASE=true. `base-anvil` is a shell wrapper, which Node cannot spawn on Windows without a shell,
 * so set MAAT_ANVIL_BIN to the real binary there (e.g. ~/.foundry/versions/base-v1.5.1/anvil.exe). macOS/Linux can
 * leave it unset. Keep ANVIL_ARGS in sync with what made NVDAc.uiMultiplier() return 1000537939576369481 at block 53551627.
 */
const ANVIL_BIN = process.env.MAAT_ANVIL_BIN ?? "base-anvil";
const ANVIL_ARGS = ["--base"];

export async function startAnvil(o: { forkUrl: string; block: bigint; port: number }) {
  const proc = spawn(ANVIL_BIN, ["--fork-url", o.forkUrl, "--fork-block-number", o.block.toString(), "--port", String(o.port), "--silent", ...ANVIL_ARGS], {
    stdio: "ignore",
    env: { ...process.env, FOUNDRY_BASE: "true" },
  });
  const url = `http://127.0.0.1:${o.port}`;
  for (let i = 0; i < 240; i++) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }) });
      if (r.ok) return { url, stop: async () => void proc.kill() };
    } catch {
      // not up yet
    }
    await delay(500);
  }
  proc.kill();
  throw new Error("anvil did not start");
}
