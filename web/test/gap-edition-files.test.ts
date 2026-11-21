// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EDITIONS } from "@/content/gap-index/editions";
import { PUBLISHED } from "@/content/gap-index";
import { editionFileChecks } from "./helpers/gap-edition";

const DIR = fileURLToPath(new URL("../content/gap-index/", import.meta.url));
const listing = readdirSync(DIR);
const files = listing.filter((f) => /^edition-\d+\.json$/.test(f)).sort();

describe("committed gap-index editions", () => {
  it("looked in the content folder", () => {
    expect(listing).toContain("editions.ts");
    for (const f of files) expect(EDITIONS.some((e) => `edition-${e.edition}.json` === f)).toBe(true);
  });

  it("publishes every edition file in the folder, and only those: a new file is also imported in content/gap-index/index.ts", () => {
    expect(files.length).toBeGreaterThan(0);
    expect(PUBLISHED.map((e) => `edition-${e.edition}.json`).sort()).toEqual(files);
  });

  for (const name of files) editionFileChecks(name, JSON.parse(readFileSync(`${DIR}${name}`, "utf8")));
});
