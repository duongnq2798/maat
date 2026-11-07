// Fixes the segment prefetch files of a static export built on Windows. A no-op anywhere else.
//
// Why: in Next 16.4.5, export/index.js collects each page's segment files with collectSegmentPaths(), which names
// them with path.relative(). On Windows that returns backslashes ("!KGRvY3Mp\docs\$oc$slug\__PAGE__"), and
// convertSegmentPathToStaticExportFilename() only turns "/" into ".". The file lands in nested folders,
// out/docs/__next.!KGRvY3Mp/docs/$oc$slug/__PAGE__.txt, while the client prefetches the dot-joined name,
// out/docs/__next.!KGRvY3Mp.docs.$oc$slug.__PAGE__.txt, gets a 404 and logs an error. Builds on Linux (Vercel)
// write the dot-joined names directly, so there is nothing to fix there.
//
// What: every folder named __next.* holds misnamed files; copy each one to its dot-joined name next to the folder.
// Running it again finds the copies in place and changes nothing.
//
// Usage: node scripts/fix-export-segments.mjs <outDir>
import { copyFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

const out = process.argv[2];
if (!out || !existsSync(out)) {
  console.error("usage: node scripts/fix-export-segments.mjs <outDir>");
  process.exit(1);
}

const files = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));

let copied = 0;
let present = 0;

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "_next") continue;
    const path = join(dir, entry.name);
    if (!entry.name.startsWith("__next.")) {
      walk(path);
      continue;
    }
    for (const file of files(path)) {
      const flat = join(dir, relative(dir, file).split(sep).join("."));
      if (existsSync(flat) && readFileSync(flat).equals(readFileSync(file))) {
        present++;
        continue;
      }
      copyFileSync(file, flat);
      copied++;
      console.log(`fix-export-segments: ${relative(out, file)} -> ${relative(out, flat)}`);
    }
  }
}

walk(out);
console.log(
  copied + present === 0
    ? "fix-export-segments: no misnamed segment files, nothing to do"
    : `fix-export-segments: copied ${copied}, already in place ${present}`,
);
