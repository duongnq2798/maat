import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderBrand } from "../brand/render";

const WEB = fileURLToPath(new URL("../", import.meta.url));

for (const f of await renderBrand()) {
  const out = join(WEB, f.path);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, f.data);
  console.log(`wrote ${f.path}`);
}
