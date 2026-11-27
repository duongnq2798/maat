import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { FILM } from "../content/film";
import { HERO_CTAS } from "../content/hero";
import { LIVE_RPCS } from "../lib/live/rpc";
import { routeLiveRpc } from "./fake-live-rpc";
import { collectErrors, expectTapTargets, JOURNAL_RAW_URL, serveEmptyJournal } from "./helpers";

// The film band, #film, directly under the hero (spec 2026-11-27, landing "explain in 10 seconds", section 2). The site
// serves the cut, its poster and its captions itself; the browser fetches no byte of the cut before the visitor presses
// play, and the band adds no host to the ones the landing already reads, Base's two RPCs. The live strip reads the
// recorded weekend of e2e/fake-live-rpc.ts, so no test here touches the network.

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

test.beforeEach(async ({ page }) => {
  await routeLiveRpc(page, "weekend");
  await serveEmptyJournal(page);
});

/** Every URL the page asks for, in order, from now on. */
function requests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (r) => urls.push(r.url()));
  return urls;
}

/** The site's own origin, then the hosts the landing reads Base and the agent's journal from. */
const allowedOrigins = (site: string) => [new URL(site).origin, ...LIVE_RPCS, new URL(JOURNAL_RAW_URL).origin];

test("the hero's first CTA opens the band, which loads no byte of the cut before play, and the cut plays from the site", async ({
  page,
  baseURL,
}) => {
  const errors = collectErrors(page);
  const urls = requests(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/", { waitUntil: "networkidle" });

  // A real click: it opens the band, and it is the visitor's gesture that lets the page start the cut below.
  const cta = page.locator("[data-hero-cta]").first();
  await expect(cta).toHaveText(HERO_CTAS[0].label);
  await cta.click();
  await expect(page).toHaveURL(/#film$/);
  const video = page.locator("#film video");
  await expect(video).toBeInViewport();
  await page.waitForLoadState("networkidle");

  // In view, the player shows its poster, and the cut is not touched: no request, nothing buffered, nothing ready.
  const poster = `${baseURL}${FILM.poster}`;
  await expect.poll(() => urls.includes(poster)).toBe(true);
  expect(urls.filter((u) => u.includes(FILM.video))).toEqual([]);
  expect(await video.evaluate((v: HTMLVideoElement) => ({ ready: v.readyState, buffered: v.buffered.length, paused: v.paused }))).toEqual({
    ready: 0, // HAVE_NOTHING
    buffered: 0,
    paused: true,
  });
  // Both text tracks are off by default, so their files wait too.
  expect(urls.filter((u) => u.includes(FILM.captions) || u.includes(FILM.onScreenText))).toEqual([]);
  expect(urls.map((u) => new URL(u).origin).filter((o) => !allowedOrigins(baseURL!).includes(o))).toEqual([]);

  // Play: the first request for the cut, from the site itself.
  await video.evaluate((v: HTMLVideoElement) => v.play().catch(() => undefined));
  await expect.poll(() => urls.filter((u) => u.includes(FILM.video)).length).toBeGreaterThan(0);
  expect(urls.filter((u) => u.includes(FILM.video)).every((u) => u === `${baseURL}${FILM.video}`)).toBe(true);
  expect(urls.map((u) => new URL(u).origin).filter((o) => !allowedOrigins(baseURL!).includes(o))).toEqual([]);
  expect(errors).toEqual([]);
});

test("the captions track loads the voice-over, and the descriptions track the on-screen text, once turned on", async ({ page }) => {
  await page.goto("/");
  const video = page.locator("#film video");
  expect(await video.evaluate((v: HTMLVideoElement) => [...v.textTracks].map((t) => [t.kind, t.label, t.mode]))).toEqual([
    ["captions", "English", "disabled"],
    ["descriptions", "English, on-screen text", "disabled"],
  ]);
  // "hidden" loads the cues as a viewer's "showing" would, without drawing them.
  await video.evaluate((v: HTMLVideoElement) => {
    v.textTracks[0]!.mode = "hidden";
    v.textTracks[1]!.mode = "hidden";
  });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => [v.textTracks[0]!.cues?.length ?? 0, v.textTracks[1]!.cues?.length ?? 0])).toEqual([19, 18]);

  // The captions say what the voice says, on the top line of the picture, clear of the captions burned in below.
  const said = await video.evaluate((v: HTMLVideoElement) => {
    const cue = [...v.textTracks[0]!.cues!].find((c) => (c as VTTCue).text.startsWith("On a market holiday")) as VTTCue;
    return { start: cue.startTime, end: cue.endTime, text: cue.text, line: cue.line };
  });
  expect(said).toEqual({ start: 51.4, end: 55.5, text: "On a market holiday, the vault refuses every trade.", line: 0 });

  const thanksgiving = await video.evaluate((v: HTMLVideoElement) => {
    const cue = v.textTracks[1]!.cues!.getCueById("thanksgiving-tx") as VTTCue;
    return { start: cue.startTime, end: cue.endTime, text: cue.text };
  });
  expect(thanksgiving).toEqual({
    start: 51,
    end: 56,
    text: "On Base: Maat's agent's own intent on Thanksgiving. Refused · Market closed (MARKET_CLOSED), and recorded.",
  });
});

for (const vp of VIEWPORTS) {
  test(`at ${vp.width}x${vp.height} the band shows its title, a 16:9 player with the poster, its caption and the disclosure, and passes axe`, async ({
    page,
    baseURL,
  }) => {
    const errors = collectErrors(page);
    await page.setViewportSize(vp);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const poster = page.waitForResponse(`${baseURL}${FILM.poster}`);
    await page.goto("/");
    const band = page.locator("#film");
    await band.scrollIntoViewIfNeeded();
    const res = await poster;
    expect([res.status(), res.headers()["content-type"]]).toEqual([200, "image/webp"]);

    await expect(band.getByRole("heading", { level: 2 })).toHaveText(`${FILM.title} · ${FILM.length}`);
    const video = band.locator("video");
    await expect(video).toBeVisible();
    const box = (await video.boundingBox())!;
    expect(Math.abs(box.width / box.height - 16 / 9)).toBeLessThan(0.02);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    await expect(band.locator("[data-film-caption]")).toHaveText(FILM.caption);
    await expect(band.locator("[data-film-disclosure]")).toHaveText("Voice and music: AI-generated with ElevenLabs");
    // The caption reads under the player on a phone, and beside it, in the title's column, on a desktop.
    const caption = (await band.locator("[data-film-caption]").boundingBox())!;
    if (vp.width < 1024) expect(caption.y).toBeGreaterThanOrEqual(box.y + box.height);
    else expect(caption.x + caption.width).toBeLessThanOrEqual(box.x);
    // FILM.youtubeUrl is null until the owner uploads the film, so the band links nothing.
    await expect(band.getByRole("link")).toHaveCount(0);

    // The footer's way back to the band.
    const footerLink = page.locator("footer").getByRole("link", { name: "Watch the film" });
    await expect(footerLink).toHaveAttribute("href", "#film");
    await expectTapTargets([footerLink]);

    const { violations } = await new AxeBuilder({ page }).include("#film").analyze();
    expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
}

test("nothing scrolls sideways at 360 px with the band in view", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/#film");
  await expect(page.locator("#film video")).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const box = (await page.locator("#film video").boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(16);
  expect(box.x + box.width).toBeLessThanOrEqual(360 - 16);
});
