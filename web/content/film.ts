/**
 * The film on the landing (spec 2026-11-27, landing "explain in 10 seconds", section 2, amended by spec 2026-11-28
 * section 2): the band `#film`, which follows "On the record" under the hero, and which the hero's first CTA and the
 * footer open. The site serves the 16:9 cut itself, re-encoded to
 * 720p, with its poster and its two text tracks, from web/public/film/; film/README.md says how each file was made. The
 * player loads nothing of the cut before the visitor presses play (preload="none"), and nothing on the band loads from
 * a third party.
 */
export const FILM = {
  /** The film's length, as the hero's CTA and the band's title write it. */
  length: "1:40",
  title: "One trade, weighed",
  caption: "Thanksgiving night, Maat's agent proposed BUY GOOGLc. The vault refused it, on the record.",
  /** Word for word the line the cut's end card draws under its disclaimer. */
  disclosure: "Voice and music: AI-generated with ElevenLabs",
  /** The cut: H.264 High at 1280x720 with AAC sound, its index at the front of the file so it starts at once. */
  video: "/film/maat-film-720p.mp4",
  /**
   * A frame of the Thanksgiving refusal, 1280x720 WebP: the 9:16 cut's tx card, its heading and its verdict large and
   * clear of the player's controls, with no burned-in caption.
   */
  poster: "/film/maat-film-poster.webp",
  /**
   * The captions of the sound as WebVTT: the voice-over of film/narration.json, at the top of the picture so they never
   * cover the burned-in captions. Off by default; written by film/vtt.mjs.
   */
  captions: "/film/maat-film.en.vtt",
  /**
   * The cut's on-screen text as WebVTT: the captions it burns in, at the same times, for screen readers and search, as
   * a descriptions track. Off by default; written by film/vtt.mjs.
   */
  onScreenText: "/film/maat-film.on-screen.en.vtt",
  /**
   * The film on YouTube once the owner has uploaded it. Until then it is null and the band shows no link. The band only
   * ever links it as plain text, so nothing loads from YouTube before a click.
   */
  youtubeUrl: null as string | null,
} as const;

export type Film = typeof FILM;
