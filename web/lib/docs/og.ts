import type { Root } from "fumadocs-core/page-tree";
import { SITE } from "../site";
import { type DocStatus, headerFrame, STATUS_LABEL } from "./frontmatter";
import { sectionIndex, sectionUrl } from "./sections";

// A docs page's link preview: the image X and other sites show for a shared link. app/og/[...slug]/route.ts draws one
// per page at build time (brand/render.tsx), and the page's metadata names it (app/(docs)/docs/[[...slug]]/page.tsx).

/** The size of every docs link preview image, the same as the landing's (app/opengraph-image.png). */
export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;

/** A docs page's link preview image: /og/docs.png for the docs home, /og/docs/concepts/nine-checks.png for a page. */
export function ogImageUrl(pageUrl: string): string {
  return `/og${pageUrl}.png`;
}

/** The docs slugs behind an /og/[...slug] path, or null when the path is not a docs page's image. */
export function slugsFromOgPath(segments: readonly string[]): string[] | null {
  const path = segments.join("/");
  if (!path.endsWith(".png")) return null;
  const [root, ...slugs] = path.slice(0, -".png".length).split("/");
  return root === "docs" ? slugs : null;
}

/** What a docs page's link preview says, in reading order after the lockup. */
export interface OgCard {
  /** The section's title in the sidebar, on a page below a section. */
  readonly section?: string;
  readonly title: string;
  /** The status label the page's header shows, if it shows one (headerFrame). */
  readonly status?: string;
}

/**
 * A docs page's link preview, by its slugs (fumadocs' page.slugs; [] is the docs home). The section comes from the page
 * tree, as the sidebar names it; a section's own page and the docs home name none, since their title says where they
 * are. The label is the one the page's header shows, so a shared link claims no more than its page.
 */
export function ogCard(page: { slugs: readonly string[]; data: { title: string; status: DocStatus; lastReviewed: string } }, tree: Root): OgCard {
  const status = headerFrame(page)?.status;
  const [dir] = page.slugs;
  let section: string | undefined;
  if (dir !== undefined && page.slugs.length > 1) {
    section = sectionIndex(tree, "")
      .flatMap((group) => group.cards)
      .find((card) => card.url === sectionUrl(dir))?.title;
    if (section === undefined) throw new Error(`the docs page ${page.slugs.join("/")} is in no section: ${sectionUrl(dir)} has no page`);
  }
  return {
    ...(section === undefined ? {} : { section }),
    title: page.data.title,
    ...(status === undefined ? {} : { status: STATUS_LABEL[status] }),
  };
}

/** The image's alt text: what it shows, in the order it shows it. */
export function ogAlt(card: OgCard): string {
  const where = card.section === undefined ? `${SITE.name} Docs` : `${SITE.name} Docs, ${card.section}`;
  return `${where}: ${card.title}.${card.status === undefined ? "" : ` Status: ${card.status}.`}`;
}
