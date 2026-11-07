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
const HINT = "set MAAT_ANVIL_BIN to the base-anvil binary (e.g. ~/.foundry/versions/base-v1.5.1/anvil.exe; install with `base-foundryup --install v1.5.1`)";

async function answers(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }) });
    return r.ok;
  } catch {
    return false;
  }
}

export async function startAnvil(o: { forkUrl: string; block: bigint; port: number }) {
  const url = `http://127.0.0.1:${o.port}`;
  // Never attach to a node someone else started: the test would deploy onto an unknown chain.
  if (await answers(url)) throw new Error(`port ${o.port} already answers JSON-RPC; stop that node first`);

  const proc = spawn(ANVIL_BIN, ["--fork-url", o.forkUrl, "--fork-block-number", o.block.toString(), "--port", String(o.port), "--silent", ...ANVIL_ARGS], {
    stdio: "ignore",
    env: { ...process.env, FOUNDRY_BASE: "true" },
  });
  let failure: Error | undefined;
  // A spawn error (e.g. ENOENT) may never emit "exit", so either event ends the process's life here.
  const exited = new Promise<void>((resolve) => {
    proc.once("exit", () => resolve());
    proc.once("error", () => resolve());
  });
  proc.once("error", (e) => (failure = new Error(`could not start ${ANVIL_BIN}: ${e.message}; ${HINT}`)));
  proc.once("exit", (code, signal) => (failure ??= new Error(`anvil exited early (code ${code}, signal ${signal}); ${HINT}`)));
  const stop = async () => {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill();
    await exited;
  };

  for (let i = 0; i < 240; i++) {
    if (failure) throw failure;
    if (await answers(url)) return { url, stop };
    await delay(500);
  }
  await stop();
  throw new Error("anvil did not start within 120 s");
}
