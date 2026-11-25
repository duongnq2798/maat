import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { replaceSpringsBlock } from "../lib/motion/springs-css";

// Rewrites the springs block of app/globals.css from lib/motion/spring.ts: `npx tsx scripts/springs.ts` from web/.
// test/springs.test.ts fails while the block and the model disagree. Its package.json entry waits for PR #15.
const CSS = fileURLToPath(new URL("../app/globals.css", import.meta.url));

const before = readFileSync(CSS, "utf8");
const after = replaceSpringsBlock(before);
if (after === before) {
  console.log("app/globals.css: the springs block is up to date");
} else {
  writeFileSync(CSS, after);
  console.log("app/globals.css: wrote the springs block");
}
