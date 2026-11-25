// @vitest-environment node
import { describe, expect, it } from "vitest";
import { dynamic, GET } from "@/app/skill.md/route";
import { readRepo } from "./helpers/solidity";

// /skill.md is the market-guard skill's SKILL.md, for agents that read the guard's instructions from the site. The
// static export writes it once at build time to out/skill.md; check:out compares that file with the source.

describe("GET /skill.md", () => {
  it("serves skills/maat-market-guard/SKILL.md as Markdown, exported once at build time", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(await res.text()).toBe(readRepo("skills/maat-market-guard/SKILL.md").replace(/\r\n/g, "\n"));
    expect(dynamic).toBe("force-static");
  });
});
