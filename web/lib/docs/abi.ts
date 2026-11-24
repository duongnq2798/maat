import abis from "../../content/generated/abi.json";
import { SITE } from "../site";
import { AGENT_ABI_FILE, type AbiName, PUBLISHED_ABIS } from "./docs-data";

/** The contracts whose ABI the docs publish, in the order llms.txt lists them. */
export const ABI_NAMES = Object.keys(PUBLISHED_ABIS) as AbiName[];

/** Where a published ABI lives: /data/abi/MandateVault.json. */
export function abiUrl(name: AbiName): string {
  return `/data/abi/${name}.json`;
}

export const ABI_NOTE =
  "ABI of contracts that are built and fork-tested. The four Maat contracts are deployed to Base mainnet, at the addresses in deployments/README.md. The contracts are unaudited.";

/**
 * The file /data/abi/<name>.json serves: where the ABI comes from, what it is not, and the ABI itself. The build reads
 * the committed copy in content/generated/abi.json, which test/docs-gen.test.ts keeps equal to agent/src/abi/generated.ts.
 */
export function abiFile(name: AbiName): { source: string; note: string; abi: unknown[] } {
  return {
    source: `${PUBLISHED_ABIS[name]} in ${AGENT_ABI_FILE} (${SITE.repoUrl}/blob/main/${AGENT_ABI_FILE}), which npm run gen:abi in agent/ generates from the compiled contracts in contracts/out.`,
    note: ABI_NOTE,
    abi: (abis as Record<AbiName, unknown[]>)[name],
  };
}
