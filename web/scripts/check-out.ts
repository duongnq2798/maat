import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkExport } from "../lib/check-out";

const OUT = fileURLToPath(new URL("../out/", import.meta.url));
const REQUIRED = [
  "index.html",
  "404.html",
  "robots.txt",
  "sitemap.xml",
  "favicon.ico",
  "icon.png",
  "apple-icon.png",
  "opengraph-image.png",
];

const problems = REQUIRED.filter((f) => !existsSync(join(OUT, f))).map((f) => `missing out/${f}`);
const index = join(OUT, "index.html");
if (existsSync(index)) problems.push(...checkExport(readFileSync(index, "utf8")));

if (problems.length > 0) {
  console.error(problems.map((p) => `✗ ${p}`).join("\n"));
  process.exit(1);
}
console.log("out/ is ready to deploy");
