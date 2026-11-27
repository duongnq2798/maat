import { type Film as FilmContent, FILM } from "@/content/film";

/**
 * The film band, `#film`, directly under the hero (spec 2026-11-27, landing "explain in 10 seconds", section 2). The site
 * serves the cut itself: the player has controls, no autoplay, and preload="none", so the browser fetches no byte of the
 * cut, and plays no sound, until the visitor presses play. Before that it shows the poster, a frame of the Thanksgiving
 * refusal; a video poster is not an <img>, so the landing still uses no raster image. Two WebVTT tracks, both off by
 * default: the captions track captions the sound, the voice-over, at the top of the picture, clear of the captions
 * burned in at the bottom; the descriptions track repeats that on-screen text for screen readers and search. A YouTube
 * link shows only once `youtubeUrl` is set, as plain text: no iframe and no click-to-load facade, so nothing loads from
 * Google before a click.
 *
 * On phones the title, the player and its caption stack; from lg the title and the caption share the left column and the
 * player takes the right.
 */
export function Film({ film = FILM }: { film?: FilmContent }) {
  return (
    <section id="film" aria-labelledby="film-title" className="border-t border-line bg-surface-soft">
      <div className="wrap grid grid-cols-1 gap-x-12 gap-y-6 py-16 md:py-24 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] lg:grid-rows-[auto_1fr]">
        <div className="flex flex-col gap-[18px]">
          <span className="eyebrow">The film</span>
          <h2 id="film-title" className="h2">
            {film.title} · {film.length}
          </h2>
        </div>
        <video
          data-film-video=""
          controls
          preload="none"
          playsInline
          poster={film.poster}
          src={film.video}
          width={1280}
          height={720}
          aria-labelledby="film-title"
          aria-describedby="film-caption"
          className="block aspect-video h-auto w-full rounded-[20px] border border-line bg-bg lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-center"
        >
          <track kind="captions" src={film.captions} srcLang="en" label="English" />
          <track kind="descriptions" src={film.onScreenText} srcLang="en" label="English, on-screen text" />
        </video>
        <div className="flex flex-col gap-3 lg:col-start-1 lg:row-start-2">
          <p id="film-caption" data-film-caption="" className="m-0 text-[17px] leading-[1.55] text-ink-body">
            {film.caption}
          </p>
          <p data-film-disclosure="" className="m-0 text-[13px] leading-[1.5] text-ink-2">
            {film.disclosure}
          </p>
          {film.youtubeUrl ? (
            <a data-film-youtube="" href={film.youtubeUrl} className="tap self-start text-[15px] font-medium">
              Watch on YouTube
              <span aria-hidden="true"> →</span>
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}
