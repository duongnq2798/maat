// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const sources = (dir: string) =>
  readdirSync(new URL(`../${dir}/`, import.meta.url))
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => ({ file: `${dir}/${f}`, text: read(`${dir}/${f}`) }));

// Every module of the two folders, so the rules below also hold for the parts later phases add.
const MODULES = [...sources("components/instrument"), ...sources("lib/motion")];
const isClient = (text: string) => text.startsWith('"use client";\n');

// The P0 units of spec 2026-11-23 section 5.1. Digits is the one client module among them.
const P0_SERVER_SAFE = [
  "components/instrument/Balance.tsx",
  "components/instrument/Fig.tsx",
  "components/instrument/Ghost.tsx",
  "components/instrument/Lamp.tsx",
  "components/instrument/Live.tsx",
  "components/instrument/Meter.tsx",
  "components/instrument/Readout.tsx",
  "components/instrument/Ruler.tsx",
  "components/instrument/SourcePlate.tsx",
  "components/instrument/Tape.tsx",
  "components/instrument/types.ts",
  "lib/motion/once-in-view.ts",
  "lib/motion/reduced-motion.ts",
  "lib/motion/roll-digits.ts",
  "lib/motion/spring.ts",
  "lib/motion/springs-css.ts",
];
const P0_CLIENT = ["components/instrument/Digits.tsx"];

describe("instrument modules (spec 2026-11-23 sections 3.11, 3.12 and 5.1)", () => {
  it("has every P0 part and helper", () => {
    const missing = [...P0_SERVER_SAFE, ...P0_CLIENT].filter((file) => !existsSync(new URL(`../${file}`, import.meta.url)));
    expect(missing).toEqual([]);
  });

  it("keeps the P0 parts server-safe, except Digits, which is a client module", () => {
    for (const file of P0_SERVER_SAFE) expect(read(file), file).not.toContain("use client");
    for (const file of P0_CLIENT) expect(isClient(read(file)), file).toBe(true);
  });

  it("makes every module that calls a React hook a client module", () => {
    for (const { file, text } of MODULES) {
      if (/\buse(State|Effect|LayoutEffect|Ref|Context|SyncExternalStore|Reducer|Transition)\s*\(/.test(text)) {
        expect(isClient(text), file).toBe(true);
      }
    }
  });

  it("never imports the edition data, the scope or the gap schema into a client module or a motion helper", () => {
    for (const { file, text } of MODULES) {
      if (!isClient(text) && !file.startsWith("lib/motion/")) continue;
      expect(text, file).not.toMatch(/from "[^"]*(content\/gap-index|content\/scope|lib\/gap\/schema)/);
    }
  });

  it("adds no animation library and no scroll-driven animation", () => {
    for (const { file, text } of MODULES) {
      for (const [, spec] of text.matchAll(/from "([^"]+)"/g)) {
        const local = spec === "react" || spec!.startsWith("@/") || spec!.startsWith("./") || spec!.startsWith("node:");
        expect(local, `${file}: ${spec}`).toBe(true);
      }
    }
    expect(read("app/globals.css")).not.toContain("animation-timeline");
  });
});
