/**
 * The film on the landing (spec 2026-11-27, landing "explain in 10 seconds", sections 1 and 2). `onLanding` says whether
 * the landing has the film band, `#film`. The hero's first CTA reads "Watch the film (1:40)" and opens `#film` only
 * while it is true; until then it reads "How it works" and opens `#how`, so the hero never links a band that is not on
 * the page (test/page.test.tsx checks every in-page link has a target). The film band's pull request turns it on.
 */
export const FILM = {
  onLanding: false as boolean,
  /** The film's length, as the CTA writes it. */
  length: "1:40",
} as const;
