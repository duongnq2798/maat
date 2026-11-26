import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * app/opengraph-image.png, named by every page under (site): Next applies a file-based OG image only at its own segment,
 * and a page's openGraph object replaces it. (A metadata image inside a route group gets a hashed URL, so the file
 * stays at the app root.) Build-time only: it reads the alt text from disk.
 */
export const OG_IMAGE = {
  url: "/opengraph-image.png",
  type: "image/png",
  width: 1200,
  height: 630,
  alt: readFileSync(join(process.cwd(), "app/opengraph-image.alt.txt"), "utf8"),
};
