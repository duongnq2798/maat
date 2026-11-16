import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, createTestClient, createWalletClient, erc20Abi, getContractAddress, http, parseEther, type Abi, type Address, type Hex } from "viem";
import { base } from "viem/chains";
import { BASKET, USDC } from "../../src/addresses.js";

const OUT = join(import.meta.dirname, "..", "..", "..", "contracts", "out");
const artifact = (file: string, name: string) => {
  const j = JSON.parse(readFileSync(join(OUT, file, `${name}.json`), "utf8"));
  return { abi: j.abi as Abi, bytecode: j.bytecode.object as Hex };
};

// contracts/script/BaseAddresses.sol + MaatConfig.sol
const POLICY_REGISTRY: Address = "0x8453000000000000000000000000000000000002";
const SPOKE: Address = "0x17905Db0e4A3514467539956c084180616AE7B8D";
const USDC_RESERVE = 7n;
const FEEDS: Address[] = ["0x04689a41629776563E6822F76f2e57D148d28513", "0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2", "0x787f13dEa48Db0897CbCDD985de77809D837F988"];
const POOLS: Address[] = ["0xF668e21993f0ACd7ab00BB1cFbAeD0df28A3C8EC", "0x16c70F04C3080a127486Cdf5a4C33c066bBF47C3", "0xF5FCB9CDAFcE67d50AfEf298F88E709d2B946BA6"];
const RESERVE_IDS = [5n, 2n, 0n]; // NVDAc, GOOGLc, AAPLc (basket order)

export async function deployStack(url: string) {
  // This deploys with unlocked dev accounts and impersonation: it must only ever talk to a local node.
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`deployStack only runs against a local anvil, not ${host}`);
  const transport = http(url, { timeout: 600_000 });
  const pub = createPublicClient({ chain: base, transport });
  const wallet = createWalletClient({ chain: base, transport });
  const test = createTestClient({ chain: base, transport, mode: "anvil" });
  const [owner, executor, payee] = (await wallet.getAddresses()) as [Address, Address, Address];
  const wait = (hash: Hex) => pub.waitForTransactionReceipt({ hash });

  const nonce = BigInt(await pub.getTransactionCount({ address: owner }));
  const predictedVault = getContractAddress({ from: owner, nonce: nonce + 3n });
  const deploy = async (file: string, name: string, args: unknown[]) => {
    const a = artifact(file, name);
    const r = await wait(await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode, args, account: owner, chain: base }));
    if (r.status !== "success") throw new Error(`deploy of ${name} reverted (tx ${r.transactionHash})`);
    return r.contractAddress!;
  };
  const calendar = await deploy("MarketCalendar.sol", "MarketCalendar", [owner]);
  const swap = await deploy("AerodromeSwapAdapter.sol", "AerodromeSwapAdapter", []);
  const credit = await deploy("AaveV4CreditAdapter.sol", "AaveV4CreditAdapter", [predictedVault, USDC, SPOKE, USDC_RESERVE, BASKET.map((t) => t.address), RESERVE_IDS]);
  const mandate = {
    sessionMode: 0, maxPremiumBps: 100, maxSlippageBps: 150, maxStaleness: 90000, multiplierCooldown: 86400, twapWindow: 1800,
    perTradeCapUsd: 50_000_000n, dailyCapUsd: 100_000_000n, calendar, swapAdapter: swap, creditAdapter: credit,
    minHealthFactor: 1_500_000_000_000_000_000n, targetHealthFactor: 2_000_000_000_000_000_000n, deriskWindow: 28800,
  };
  const configs = BASKET.map((_, i) => ({ allowed: true, feed: FEEDS[i]!, pool: POOLS[i]!, maxWeightBps: 4000 }));
  const vault = await deploy("MandateVault.sol", "MandateVault", [owner, executor, USDC, POLICY_REGISTRY, mandate, BASKET.map((t) => t.address), configs, [payee]]);
  if (vault.toLowerCase() !== predictedVault.toLowerCase()) throw new Error(`vault ${vault} != predicted ${predictedVault}`);

  // $200 of real USDC from the NVDAc/USDC pool (impersonated on the fork only), then owner.fund().
  const source = POOLS[0]!;
  await test.impersonateAccount({ address: source });
  await test.setBalance({ address: source, value: parseEther("1") });
  await wait(await wallet.writeContract({ address: USDC, abi: erc20Abi, functionName: "transfer", args: [owner, 200_000_000n], account: source, chain: base }));
  await test.stopImpersonatingAccount({ address: source });
  const vaultAbi = artifact("MandateVault.sol", "MandateVault").abi;
  await wait(await wallet.writeContract({ address: USDC, abi: erc20Abi, functionName: "approve", args: [vault, 200_000_000n], account: owner, chain: base }));
  await wait(await wallet.writeContract({ address: vault, abi: vaultAbi, functionName: "fund", args: [200_000_000n], account: owner, chain: base }));
  return { vault, creditAdapter: credit, owner, executor, payee };
}
