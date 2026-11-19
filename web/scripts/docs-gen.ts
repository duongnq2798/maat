import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateAbis, generateDocsData, serialize } from "../lib/docs/docs-data";
import { hasAddress } from "../lib/docs/reference-labels";
import { collectTestLines } from "../lib/docs/remark-test-anchors";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OUT = fileURLToPath(new URL("../content/generated/", import.meta.url));

const data = generateDocsData(ROOT);
const tests = collectTestLines(ROOT);
const abis = generateAbis(ROOT);
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}contracts.json`, serialize(data.surface));
writeFileSync(`${OUT}base-addresses.json`, serialize(data.addresses));
writeFileSync(`${OUT}deployments.json`, serialize(data.deployments));
writeFileSync(`${OUT}agent.json`, serialize(data.agent));
writeFileSync(`${OUT}tests.json`, serialize(tests));
writeFileSync(`${OUT}abi.json`, serialize(abis));
const testCount = Object.values(tests).reduce((n, t) => n + Object.keys(t).length, 0);
console.log(
  `content/generated: ${data.surface.contracts.length} contracts, ${data.addresses.length} addresses, ${data.deployments.filter(hasAddress).length} of ${data.deployments.length} deployments recorded, ${data.agent.env.length} settings, ${testCount} tests in ${Object.keys(tests).length} files, ${Object.keys(abis).length} ABIs`,
);
