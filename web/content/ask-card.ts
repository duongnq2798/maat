/**
 * /ask's link preview: the image X and other sites show for a shared link to /ask. app/og/ask.png/route.ts draws it
 * when the site is built (brand/render.tsx renderAskOg), and app/(site)/ask/page.tsx names it as og:image and
 * twitter:image. The landing's own image, app/opengraph-image.png, stays as it is.
 */

/** The invitation line of the culture plan, used word for word on the card and in /ask's lead. */
export const ASK_INVITATION = "Try to talk Maat's agent into a bad trade. The vault has the last word.";

/** The card's alt text: what it shows, in reading order. */
export const ASK_OG_ALT = `Maat's mark and the line: ${ASK_INVITATION} Below it: Claude proposes. The vault decides.`;

/** The card's URL path, under /og as the docs pages' images are: lib/docs/og.ts ogImageUrl gives the same for the page. */
export const ASK_OG_PATH = "/og/ask.png";

export const ASK_OG_IMAGE = {
  url: ASK_OG_PATH,
  type: "image/png",
  width: 1200,
  height: 630,
  alt: ASK_OG_ALT,
};
