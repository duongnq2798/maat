import type { Locator, Page } from "@playwright/test";

export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

/** Horizontal overflow of the page, and the `.card`s whose content is wider than the card (deliberate scroll regions excluded). */
export async function measureFit(page: Page) {
  return page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    clipped: [...document.querySelectorAll<HTMLElement>(".card")]
      .filter((el) => !el.hasAttribute("data-scroll-x") && el.scrollWidth > el.clientWidth + 1)
      .map((el) => (el.textContent ?? "").trim().slice(0, 60)),
  }));
}

/**
 * How many lines an element's text takes: the distinct tops of a Range over its contents. The element's own
 * getClientRects() cannot count them: a flex item is blockified, so it has one box however many lines it holds.
 */
export function lineCount(el: Locator): Promise<number> {
  return el.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
  });
}

/** The x of an element's right edge. */
export function rightEdge(el: Locator): Promise<number> {
  return el.evaluate((node) => node.getBoundingClientRect().right);
}

/** The x of the right edge of an element's content box: its border box less its right border and padding. */
export function contentRight(el: Locator): Promise<number> {
  return el.evaluate((node) => {
    const s = getComputedStyle(node);
    return node.getBoundingClientRect().right - parseFloat(s.borderRightWidth) - parseFloat(s.paddingRight);
  });
}
