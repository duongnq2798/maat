// @vitest-environment node
// npm run card -- --gap-edition N --window ID [--token SYM] [--out DIR]: a Gap Index window's card, read from the
// committed edition file, never from Base.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pngSize } from "@/brand/render";
import edition0 from "@/content/gap-index/edition-0.json";
import { DEFAULT_GAP_DIR, runCardCommand, runGapCard, UsageError, type CardDeps } from "@/lib/card/cli";
import type { CardClient } from "@/lib/card/read";
import { EditionFileSchema } from "@/lib/gap/schema";
import { syntheticEdition1 } from "./helpers/gap-edition";

const TX1 = "0xdfdb6739912a73542d90129bd7269a939dc8b2d47a869f56d9ab5e3a02e86c3b";
const e0 = EditionFileSchema.parse(edition0);

const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "gap-card-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A Base client that fails the test if anything reads it: a Gap Index card reads only the edition file. */
const noBase: CardClient = new Proxy({} as CardClient, {
  get: () => {
    throw new Error("a Gap Index card read Base");
  },
});
const deps = (over: Partial<CardDeps> = {}): CardDeps => ({ client: () => noBase, sources: null, defaultOut: tempDir(), log: () => {}, ...over });

/** A folder holding `files`, as content/gap-index holds the committed editions. */
function gapDir(files: Record<string, unknown>): string {
  const dir = tempDir();
  for (const [name, json] of Object.entries(files)) writeFileSync(join(dir, name), typeof json === "string" ? json : JSON.stringify(json));
  return dir;
}

describe("npm run card -- --gap-edition N --window ID", () => {
  it("reads the committed edition file and writes both sizes to --out, for the token the page shows first", async () => {
    const out = tempDir();
    const lines: string[] = [];
    const result = await runGapCard(["--gap-edition", "0", "--window", "2026-11-13", "--out", out], deps({ log: (l) => lines.push(l) }));
    expect(result.files).toEqual([join(out, "gap-index-0-2026-11-13-NVDAc-1600x900.png"), join(out, "gap-index-0-2026-11-13-NVDAc-1080x1350.png")]);
    expect(result.files.map((f) => pngSize(readFileSync(f)))).toEqual([
      { width: 1600, height: 900 },
      { width: 1080, height: 1350 },
    ]);
    expect(lines[0]).toBe("Gap Index · edition 0 · window 2026-11-13 · Fri 13 Nov 16:00 ET → Mon 16 Nov 09:30 ET · NVDAc · Largest gap +356 bps");
    expect(lines.slice(1)).toEqual(result.files);
  }, 60_000);

  it("reads web/content/gap-index by default", () => {
    expect(relative(resolve(process.cwd(), "content/gap-index"), DEFAULT_GAP_DIR)).toBe("");
  });

  it("draws the token --token names", async () => {
    const result = await runGapCard(["--gap-edition", "0", "--window", "2026-11-20", "--token", "MSTRc", "--out", tempDir()], deps());
    expect(result.files.map((f) => f.split(/[\\/]/).at(-1))).toEqual(["gap-index-0-2026-11-20-MSTRc-1600x900.png", "gap-index-0-2026-11-20-MSTRc-1080x1350.png"]);
  }, 60_000);

  it("reads an edition with Decisions from its file in the folder it is given", async () => {
    const dir = gapDir({ "edition-1.json": syntheticEdition1(e0) });
    const out = tempDir();
    const lines: string[] = [];
    const result = await runGapCard(["--gap-edition", "1", "--window", "2026-11-27", "--out", out], deps({ gapDir: dir, log: (l) => lines.push(l) }));
    expect(result.model.decisions.rows).toHaveLength(3);
    expect(result.model.source).toBe("web/content/gap-index/edition-1.json · head block " + result.model.source.split("head block ")[1]);
    expect(lines[0]).toMatch(/^Gap Index · edition 1 · window 2026-11-27 · Fri 27 Nov 13:00 ET → Mon 30 Nov 09:30 ET · NVDAc · /);
  }, 60_000);

  it("writes to the default folder when no --out is given", async () => {
    const defaultOut = join(tempDir(), "img");
    const result = await runGapCard(["--gap-edition", "0", "--window", "2026-11-06"], deps({ defaultOut }));
    expect(result.files.map((f) => relative(defaultOut, f))).toEqual(["gap-index-0-2026-11-06-NVDAc-1600x900.png", "gap-index-0-2026-11-06-NVDAc-1080x1350.png"]);
  }, 60_000);
});

describe("npm run card -- --gap-edition refuses", () => {
  it.each([
    [["--gap-edition", "0"], "--gap-edition needs --window ID"],
    [["--gap-edition", "x", "--window", "2026-11-13"], "--gap-edition takes an edition number"],
    [["--window", "2026-11-13"], "--window and --token draw a Gap Index card: they need --gap-edition N"],
    [["--token", "NVDAc"], "--window and --token draw a Gap Index card: they need --gap-edition N"],
    [[TX1, "--gap-edition", "0", "--window", "2026-11-13"], "give a transaction hash, --fixture or --gap-edition, not two of them"],
    [["--fixture", "x.json", "--gap-edition", "0", "--window", "2026-11-13"], "give a transaction hash, --fixture or --gap-edition, not two of them"],
    [["--gap-edition", "0", "--window", "2026-11-13", "--window", "2026-11-20"], "--window takes one window"],
  ])("%j", async (argv, message) => {
    await expect(runCardCommand(argv as string[], deps())).rejects.toThrow(UsageError);
    await expect(runCardCommand(argv as string[], deps())).rejects.toThrow(message);
  });

  it("an edition with no committed file", async () => {
    const run = () => runCardCommand(["--gap-edition", "7", "--window", "2026-11-13"], deps({ gapDir: gapDir({}) }));
    await expect(run()).rejects.toThrow(UsageError);
    await expect(run()).rejects.toThrow("edition 7 has no file web/content/gap-index/edition-7.json");
  });

  it("a file the edition schema refuses", async () => {
    const dir = gapDir({ "edition-0.json": { ...e0, rpc: "https://example.invalid" } });
    await expect(runCardCommand(["--gap-edition", "0", "--window", "2026-11-13"], deps({ gapDir: dir }))).rejects.toThrow("web/content/gap-index/edition-0.json does not parse");
  });

  it("a file that holds another edition", async () => {
    const dir = gapDir({ "edition-2.json": e0 });
    await expect(runCardCommand(["--gap-edition", "2", "--window", "2026-11-13"], deps({ gapDir: dir }))).rejects.toThrow("web/content/gap-index/edition-2.json holds edition 0");
  });

  it("a window or a token the edition does not hold", async () => {
    await expect(runCardCommand(["--gap-edition", "0", "--window", "2026-11-27"], deps())).rejects.toThrow("edition 0 has no window 2026-11-27");
    await expect(runCardCommand(["--gap-edition", "0", "--window", "2026-11-13", "--token", "XYZc"], deps())).rejects.toThrow("has no token XYZc");
  });
});

describe("npm run card -- <txhash> still draws a Decision", () => {
  it("passes a transaction hash to the Weighing card, which needs the deployments table", async () => {
    await expect(runCardCommand([TX1], deps())).rejects.toThrow("deployments/README.md records no Base mainnet MandateVault");
  });
});
