/** A previous or next card at the foot of a docs page: the page's title, its URL and its frontmatter description. */
export interface FooterCard {
  readonly name: string;
  readonly url: string;
  readonly description?: string;
}

/**
 * The cards before and after a page, from the docs pages in sidebar order (pagesInSidebarOrder in lib/docs-source.ts).
 * That list holds each page once, in its own section. Fumadocs' own footer list also counts each meta.json link item,
 * such as Reference's "[Refusal codes](/docs/concepts/refusal-codes)": paging on from Types would leave Reference for
 * Concepts, and the card would say "Next Page" where the others give a description.
 */
export function footerItems(pages: readonly FooterCard[], url: string): { previous?: FooterCard; next?: FooterCard } {
  const at = pages.findIndex((p) => p.url === url);
  if (at === -1) return {};
  return { previous: pages[at - 1], next: pages[at + 1] };
}
