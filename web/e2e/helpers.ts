import { expect, type Locator, type Page } from "@playwright/test";

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

/**
 * Where a finger lands on `el` (judge rehearsal 2026-11-27, m4): the control is scrolled to the middle of the screen,
 * then document.elementFromPoint is asked at a 9 x 9 grid over the 44 x 44 px square centred on it (its own box, where
 * that is larger) and at a 5 x 5 grid over its own box, each 1.5 px inside the edge, since the engine rounds a point
 * and two controls may abut. A point the control itself, or its ::after, does not answer is
 * a miss, named by what answered it: a neighbour whose target overlaps, or a bar painted over it. An ancestor answers
 * only past a rounded corner, where a tap reaches no other control, so it is not a miss. Points off the screen, at the
 * page's own edge, are skipped.
 */
export function tapMisses(el: Locator): Promise<string[]> {
  return el.evaluate((node) => {
    node.scrollIntoView({ block: "center", inline: "nearest" });
    const box = node.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const grid = (left: number, top: number, w: number, h: number, n: number) =>
      Array.from({ length: n * n }, (_, i) => [left + 1.5 + ((w - 3) * (i % n)) / (n - 1), top + 1.5 + ((h - 3) * Math.floor(i / n)) / (n - 1)] as const);
    const w = Math.max(box.width, 44);
    const h = Math.max(box.height, 44);
    const points = [...grid(cx - w / 2, cy - h / 2, w, h, 9), ...grid(box.left, box.top, box.width, box.height, 5)];
    const misses = new Set<string>();
    for (const [x, y] of points) {
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
      const hit = document.elementFromPoint(x, y);
      if (hit !== null && (hit === node || node.contains(hit) || hit.contains(node))) continue;
      const control = hit?.closest("a, button, summary, input, select, textarea, [role=button]");
      const who = control ?? hit;
      misses.add(who === null ? "nothing" : `${who.tagName.toLowerCase()} "${(who.textContent ?? "").trim().slice(0, 40)}"`);
    }
    return [...misses];
  });
}

/** Each of `targets` is at least 44 x 44 px, and every point of that area and of its own box reaches it, not a neighbour. */
export async function expectTapTargets(targets: readonly Locator[]) {
  for (const t of targets) {
    const name = ((await t.getAttribute("aria-label")) ?? (await t.textContent()) ?? "").trim();
    const size = await tapSize(t);
    expect(size.width, name).toBeGreaterThanOrEqual(44);
    expect(size.height, name).toBeGreaterThanOrEqual(44);
    expect(await tapMisses(t), `taps on ${name} that reach something else`).toEqual([]);
  }
}
