import { readFileSync } from "node:fs";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Film } from "@/components/sections/Film";
import { FILM } from "@/content/film";
import { TARGET_SECONDS } from "../../film/lib/beats.mjs";
import { fills, parseVtt, vttCues, vttProblems, vttSeconds, vttTime, webvtt } from "../../film/lib/vtt.mjs";

// Spec 2026-11-27, landing "explain in 10 seconds", section 2: the film band under the hero, the files it serves from
// web/public/film/, and the WebVTT track film/vtt.mjs writes from a render's manifest.

const band = () => document.getElementById("film")!;
// Paths from web/, where the tests run (a jsdom test has no file URL to resolve from).
const publicFile = (url: string) => readFileSync(`public${url}`);
const captions = (JSON.parse(readFileSync("../film/captions.json", "utf8")) as { captions: Record<string, unknown> }).captions;

describe("the film band", () => {
  it("is titled by the film and its length, and the player is named by that title", () => {
    render(<Film />);
    const title = within(band()).getByRole("heading", { level: 2 });
    expect(title).toHaveTextContent("One trade, weighed · 1:40");
    expect(band().tagName).toBe("SECTION");
    expect(band()).toHaveAttribute("aria-labelledby", title.id);
    expect(band().querySelector("video")).toHaveAttribute("aria-labelledby", title.id);
  });

  it("plays the cut the site serves, with controls, never on its own, and loads nothing of it before play", () => {
    render(<Film />);
    const video = band().querySelector("video")!;
    expect(video).toHaveAttribute("preload", "none");
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("playsinline");
    expect(video).not.toHaveAttribute("autoplay");
    expect(video).toHaveAttribute("src", "/film/maat-film-720p.mp4");
    expect(video).toHaveAttribute("poster", "/film/maat-film-poster.webp");
    expect([video.getAttribute("width"), video.getAttribute("height")]).toEqual(["1280", "720"]);
    // No embed and no image: the poster is the video's own attribute, so the landing still uses no raster image.
    expect(band().querySelectorAll("iframe, embed, object, img")).toHaveLength(0);
  });

  it("carries the burned-in captions as a WebVTT track, off by default", () => {
    render(<Film />);
    const tracks = band().querySelectorAll("video > track");
    expect(tracks).toHaveLength(1);
    const track = tracks[0]!;
    expect(track).toHaveAttribute("kind", "captions");
    expect(track).toHaveAttribute("src", "/film/maat-film.en.vtt");
    expect(track).toHaveAttribute("srclang", "en");
    expect(track).toHaveAttribute("label", "English");
    expect(track).not.toHaveAttribute("default");
  });

  it("says under the player what the film shows, then who made its voice and music, word for word", () => {
    render(<Film />);
    const video = band().querySelector("video")!;
    const caption = band().querySelector("[data-film-caption]")!;
    const disclosure = band().querySelector("[data-film-disclosure]")!;
    expect(caption.textContent).toBe("Thanksgiving night, Maat's agent proposed BUY GOOGLc. The vault refused it, on the record.");
    expect(disclosure.textContent).toBe("Voice and music: AI-generated with ElevenLabs");
    expect(video).toHaveAttribute("aria-describedby", caption.id);
    expect(video.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(caption.compareDocumentPosition(disclosure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("links YouTube only once FILM.youtubeUrl is set, and then as a plain link", () => {
    expect(FILM.youtubeUrl).toBeNull();
    const { unmount } = render(<Film />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(band().querySelector("[data-film-youtube]")).toBeNull();
    unmount();

    const url = "https://www.youtube.com/watch?v=abcdefghijk";
    render(<Film film={{ ...FILM, youtubeUrl: url }} />);
    const link = within(band()).getByRole("link", { name: "Watch on YouTube" });
    expect(link).toHaveAttribute("href", url);
    expect(link.textContent).toBe("Watch on YouTube →");
    expect(band().querySelectorAll("iframe, embed, object")).toHaveLength(0);
  });
});

/** The four-character box type at `at`, or "" past the end. */
const ascii = (buf: Buffer, at: number) => buf.toString("latin1", at, at + 4);

describe("the film's files in web/public/film", () => {
  it("the cut: H.264 High at 1280x720 with AAC sound, 5 to 6 MB, its index before its media so it starts at once", () => {
    const mp4 = publicFile(FILM.video);
    expect(ascii(mp4, 4)).toBe("ftyp");
    expect(mp4.length).toBeGreaterThanOrEqual(5_000_000);
    expect(mp4.length).toBeLessThanOrEqual(6_000_000);
    // Top-level boxes in file order: +faststart moves moov before mdat.
    const top: string[] = [];
    for (let at = 0; at + 8 <= mp4.length; ) {
      const size = mp4.readUInt32BE(at);
      top.push(ascii(mp4, at + 4));
      if (size < 8) break;
      at += size;
    }
    expect(top.indexOf("moov")).toBeGreaterThan(-1);
    expect(top.indexOf("moov")).toBeLessThan(top.indexOf("mdat"));
    // The avc1 sample entry: width and height after its 24 bytes of fixed fields; avcC's profile byte 100 is High.
    // The sample entry is in stsd; "avc1" also names a compatible brand in ftyp, which comes first.
    const avc1 = mp4.indexOf("avc1", mp4.indexOf("stsd", 0, "latin1"), "latin1");
    expect([mp4.readUInt16BE(avc1 + 28), mp4.readUInt16BE(avc1 + 30)]).toEqual([1280, 720]);
    const avcC = mp4.indexOf("avcC", avc1, "latin1");
    expect(mp4[avcC + 5]).toBe(100);
    expect(mp4.indexOf("mp4a", 0, "latin1")).toBeGreaterThan(-1);
  });

  it("the poster: a 1280x720 WebP under 120 KB", () => {
    const webp = publicFile(FILM.poster);
    expect([ascii(webp, 0), ascii(webp, 8)]).toEqual(["RIFF", "WEBP"]);
    expect(webp.length).toBeLessThan(120 * 1024);
    const chunk = ascii(webp, 12);
    const size =
      chunk === "VP8X"
        ? [1 + webp.readUIntLE(24, 3), 1 + webp.readUIntLE(27, 3)]
        : chunk === "VP8 "
          ? [webp.readUInt16LE(26) & 0x3fff, webp.readUInt16LE(28) & 0x3fff]
          : null;
    expect(size).toEqual([1280, 720]);
  });

  it("the captions: each cue says the words of its caption in film/captions.json, in order and inside the cut", () => {
    const vtt = publicFile(FILM.captions).toString("utf8");
    const cues = parseVtt(vtt);
    expect(vttProblems(cues, captions, TARGET_SECONDS)).toEqual([]);
    // The cut's sixteen shots with a caption, two of them with two cues and one with three.
    expect(cues).toHaveLength(18);
    expect(cues.map((c) => c.id)).toContain("thanksgiving-tx");
    // The file is what webvtt() writes, so film/vtt.mjs can write it again.
    expect(webvtt(cues)).toBe(vtt.replace(/\r\n/g, "\n"));
  });
});

describe("film/lib/vtt.mjs", () => {
  const shots = [
    { duration: 6, cues: [] },
    {
      duration: 9,
      cues: [
        { id: "gap-held", text: "Fri 6 Nov 16:00 ET → Mon 9 Nov 09:30 ET. NYSE is closed, and the NVDAc price feed held one answer for 51.35 h.", from: 0, to: 4.5 },
        { id: "gap-swaps", text: "Its Aerodrome pool on Base kept trading: 10,138 swaps meanwhile, up to 490 bps below the held answer.", from: 4.5, to: 9 },
      ],
    },
    { duration: 4.5, cues: [{ id: "decides-how", text: "Claude proposes. The vault decides. It is a contract on Base that checks every intent.", from: 0, to: 4.5 }] },
  ];

  it("places each cue at its shot's start, and writes and reads WebVTT times to the millisecond", () => {
    const cues = vttCues(shots);
    expect(cues.map((c) => [c.id, c.start, c.end])).toEqual([
      ["gap-held", 6, 10.5],
      ["gap-swaps", 10.5, 15],
      ["decides-how", 15, 19.5],
    ]);
    expect(vttTime(83)).toBe("00:01:23.000");
    expect(vttTime(3723.4567)).toBe("01:02:03.457");
    expect(vttSeconds("01:23.500")).toBe(83.5);
    expect(parseVtt(webvtt(cues))).toEqual(cues);
    expect(vttProblems(cues, captions, TARGET_SECONDS)).toEqual([]);
  });

  it("escapes what WebVTT cannot carry as it is, and reads it back", () => {
    const cues = [{ id: "x", start: 0, end: 1, text: "a < b & c > d" }];
    expect(webvtt(cues)).toContain("a &lt; b &amp; c &gt; d");
    expect(parseVtt(webvtt(cues))).toEqual(cues);
  });

  it("takes a filled placeholder for any value, and no other change of a word", () => {
    expect(fills("{gap.close} → {gap.open}. NYSE is closed.", "Fri 6 Nov → Mon 9 Nov. NYSE is closed.")).toBe(true);
    expect(fills("{gap.close} → {gap.open}. NYSE is closed.", "Fri 6 Nov → Mon 9 Nov. NYSE was closed.")).toBe(false);
    expect(fills("Every figure links its CI job in the README.", "Every figure links its CI job in the README")).toBe(false);
  });

  it("names a cue that says other words, names no caption, repeats an id, overlaps the one above or ends after the cut", () => {
    const [held, swaps, how] = vttCues(shots);
    const problems = vttProblems(
      [
        { ...held!, text: "Fri 6 Nov. The feed held." },
        { ...swaps!, id: "gap-swapped" },
        { ...how!, start: 14 },
        { ...how!, start: 99, end: 101 },
      ],
      captions,
      TARGET_SECONDS,
    );
    expect(problems).toEqual([
      'cue gap-held: "Fri 6 Nov. The feed held." is not the words of caption gap-held',
      "cue gap-swapped: no caption gap-swapped in film/captions.json",
      "cue decides-how: starts at 14 s, before the cue above it ends at 15 s",
      "cue decides-how: a second cue with this id",
      "cue decides-how: ends at 101 s, after the cut's 100 s",
    ]);
  });
});
