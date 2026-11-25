import skill from "@/content/generated/skill.json";

// out/skill.md: the market-guard skill's SKILL.md (skills/maat-market-guard), for agents that read the guard's
// instructions from the site. The build reads the copy `npm run docs:gen` writes, never skills/ itself.
export const dynamic = "force-static";

export function GET() {
  return new Response(skill.text, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
