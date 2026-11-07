import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateDocsData, serialize } from "../lib/docs/docs-data";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OUT = fileURLToPath(new URL("../content/generated/", import.meta.url));

const data = generateDocsData(ROOT);
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}contracts.json`, serialize(data.surface));
writeFileSync(`${OUT}base-addresses.json`, serialize(data.addresses));
writeFileSync(`${OUT}agent.json`, serialize(data.agent));
console.log(
  `content/generated: ${data.surface.contracts.length} contracts, ${data.addresses.length} addresses, ${data.agent.env.length} settings`,
);
