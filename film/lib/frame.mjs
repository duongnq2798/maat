// What the capture does to the live site's frame before it films a page: the style it adds, and what it measures in the
// page to keep text from being cut by the top edge. The functions marked "runs in the browser" go to page.evaluate.

/**
 * The style the capture adds to every page it films. It hides what means nothing to someone who watches the film days
 * later, or what competes with the caption: the landing's "Last Decision … ago" line in its announcement bar and the
 * hero's plate with the same age, /ledger's "since your last look" line and its "New" marks (they are per viewer), and
 * the phone layout's bottom bar ("Basket now … Try to make it say no"), which sits under the caption. Hidden elements
 * keep their place, so the layout does not move. It also wraps code blocks, so a cast command that scrolls sideways on
 * a phone is filmed whole instead of cut at the right edge.
 */
export const FRAME_CSS = `
[data-vault-bar],[data-vault-plate],[data-since-line],[data-since-new]{visibility:hidden !important}
[data-thumb-bar]{display:none !important}
pre,pre code{white-space:pre-wrap !important;overflow-wrap:anywhere !important}
`;

/** The selectors FRAME_CSS hides, for the tests. */
export const HIDDEN_IN_FILM = Object.freeze(["[data-vault-bar]", "[data-vault-plate]", "[data-since-line]", "[data-since-new]", "[data-thumb-bar]"]);

/**
 * Runs in the browser. Every line of visible text on the page, as its top and bottom in page px, and the height of the
 * site's nav bar while it stays at the top of the frame (0 when it scrolls away, as in the phone layout). Text inside a
 * fixed or sticky element, hidden text and screen-reader-only text are left out: they never sit under the top edge.
 */
export function textLinesInPage() {
  /** @type {Map<Element, boolean>} */
  const cache = new Map();
  /** @param {Element | null} el @returns {boolean} */
  const skip = (el) => {
    if (!el || el === document.body) return false;
    const known = cache.get(el);
    if (known !== undefined) return known;
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const v =
      cs.position === "fixed" ||
      cs.position === "sticky" ||
      cs.visibility === "hidden" ||
      cs.display === "none" ||
      (cs.position === "absolute" && (box.width <= 1 || box.height <= 1)) ||
      skip(el.parentElement);
    cache.set(el, v);
    return v;
  };
  const lines = [];
  const range = document.createRange();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent?.trim() || skip(n.parentElement)) continue;
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) lines.push({ top: r.top + window.scrollY, bottom: r.bottom + window.scrollY });
  }
  const nav = document.querySelector("[data-nav-bar]");
  const position = nav ? getComputedStyle(nav).position : "";
  const edge = nav && (position === "sticky" || position === "fixed") ? nav.getBoundingClientRect().height : 0;
  return { lines, edge };
}
