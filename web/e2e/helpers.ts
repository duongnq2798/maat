import type { Locator, Page } from "@playwright/test";

/** The raw files of the public agent-journal branch, which /now reads for the agent's latest note (lib/chain/ledger.ts). */
export const JOURNAL_RAW_URL = "https://raw.githubusercontent.com/duongnq2798/maat/agent-journal/journal/";

/**
 * Answers every read of the agent-journal branch with a journal that lists no day yet, so a spec that opens /now sends
 * nothing to GitHub, logs no error for it, and the page shows no note.
 */
export async function serveEmptyJournal(page: Page) {
  await page.route(`${JOURNAL_RAW_URL}**`, (route) =>
    route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, contentType: "application/json", body: '{"days":[],"v":1}' }),
  );
}

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

/**
 * The size a finger can hit: the element's own box, or its ::after when that is larger, as the .tap class in
 * app/globals.css draws a 44 x 44 px target around a small link without moving anything.
 */
export function tapSize(el: Locator): Promise<{ width: number; height: number }> {
  return el.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const after = getComputedStyle(node, "::after");
    const extra = after.content !== "none" && after.position === "absolute";
    return {
      width: Math.max(box.width, extra ? parseFloat(after.width) || 0 : 0),
      height: Math.max(box.height, extra ? parseFloat(after.height) || 0 : 0),
    };
  });
}
