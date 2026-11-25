// One-off setup, run by the vault owner (not by CI or an agent):
//   node --env-file=.env --import tsx scripts/cdp-setup.ts 0xVaultAddress
// Creates (or finds) the named executor account, attaches the vault-only policy, prints the address.
import { CdpClient } from "@coinbase/cdp-sdk";
import { getAddress, isAddress } from "viem";
import { executorPolicy } from "../src/exec/cdpPolicy.js";

const vaultArg = process.argv[2];
if (!vaultArg || !isAddress(vaultArg)) {
  console.error("usage: cdp-setup.ts <vault address>");
  process.exit(1);
}
const vault = getAddress(vaultArg);
const name = process.env.CDP_ACCOUNT_NAME ?? "maat-executor";
const cdp = new CdpClient();
// The policy first: if CDP refuses its body, no account has been created without one.
const policy = await cdp.policies.createPolicy({ policy: executorPolicy(vault) });
const account = await cdp.evm.getOrCreateAccount({ name });
await cdp.evm.updateAccount({ address: account.address, update: { accountPolicy: policy.id } });
console.log(`executor account "${name}": ${account.address}`);
console.log(`policy ${policy.id} attached (vault ${vault}, zero value, sends only on Base)`);
console.log("Next, from the owner wallet:");
console.log(`  1. send ~0.002 ETH on Base to ${account.address} for gas`);
console.log(`  2. at go-live only: MandateVault(${vault}).setExecutor(${account.address})`);
console.log(`  3. then set MAAT_EXECUTOR=${account.address} in agent/.env (until step 2, a run needs the current executor)`);
