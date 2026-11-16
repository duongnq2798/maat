import { expect, type Page, test } from "@playwright/test";
import { collectErrors, measureFit } from "./helpers";

// The date field's segment order depends on the locale.
test.use({ locale: "en-US" });

function sim(page: Page) {
  const root = page.locator("#try");
  return {
    root,
    verdict: root.getByRole("status").locator("> div"),
    button: (name: string) => root.getByRole("button", { name, exact: true }),
    checks: root.getByRole("list", { name: "Simulated checks" }).getByRole("listitem"),
    tape: root.getByRole("list", { name: "Today's decisions" }).getByRole("listitem"),
    time: root.getByRole("slider", { name: "Time" }),
  };
}

test("a visitor makes it say no, by mouse and keyboard", async ({ page }) => {
  // 329 key presses, each one a render.
  test.slow();
  const errors = collectErrors(page);
  await page.goto("/#try");
  const ui = sim(page);
  await expect(ui.verdict).toHaveAttribute("data-verdict", "allowed");

  await ui.button("Sat 7 Nov").click();
  await expect(ui.verdict).toHaveAttribute("data-reason", "MARKET_CLOSED");
  await expect(ui.checks.nth(3)).toHaveAttribute("data-mark", "FAIL");

  await ui.button("Thu 5 Nov · 10:30").click();
  await ui.button("$50").click();
  await ui.button("Execute").click();
  await expect(ui.verdict).toHaveAttribute("data-reason", "CONCENTRATION");
  await ui.button("Execute").click();
  await expect(ui.tape).toHaveCount(2);
  await expect(ui.tape.nth(1)).toContainText("Refused · CONCENTRATION");

  // One minute per arrow key: 15:59 is in session, 16:00 is not.
  await ui.button("Reset day").click();
  await ui.time.focus();
  for (let minute = 630; minute < 959; minute++) await page.keyboard.press("ArrowRight");
  await expect(ui.time).toHaveAttribute("aria-valuetext", "15:59 ET");
  await expect(ui.verdict).toHaveAttribute("data-reason", "OK");
  await page.keyboard.press("ArrowRight");
  await expect(ui.time).toHaveAttribute("aria-valuetext", "16:00 ET");
  await expect(ui.verdict).toHaveAttribute("data-reason", "MARKET_CLOSED");

  expect(errors).toEqual([]);
});

test("a share link reproduces its refusal, and a broken one falls back", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/?day=2026-11-26&at=1030&buy=GOOGLc-10#try");
  const ui = sim(page);
  await expect(ui.verdict).toHaveAttribute("data-reason", "MARKET_CLOSED");
  await expect(ui.checks.nth(3)).toContainText("Thanksgiving · NYSE closed");
  const post = new URL((await ui.root.getByRole("link", { name: "Post on X" }).getAttribute("href")) ?? "");
  expect(post.searchParams.get("text")).toBe("I tried to buy $10 of GOOGLc on Thu 26 Nov at 10:30 ET. Maat said no: MARKET_CLOSED.");
  expect(post.searchParams.get("url")).toBe(`${new URL(page.url()).origin}/?day=2026-11-26&at=1030&buy=GOOGLc-10#try`);

  await page.goto("/?day=1999-01-01&at=9999&buy=TSLA-x&tape=junk#try");
  // The static HTML already says allowed. Only once hydrated does Post on X carry the share link, and by then the
  // broken query has been decoded, so the checks below test the fallback rather than the page before it.
  await expect(ui.root.getByRole("link", { name: "Post on X" })).toHaveAttribute("href", /&url=/);
  await expect(ui.verdict).toHaveAttribute("data-verdict", "allowed");
  await expect(ui.button("Thu 5 Nov · 10:30")).toHaveAttribute("aria-pressed", "true");
  await expect(ui.root.getByRole("list", { name: "Today's decisions" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a date typed on the keyboard lands on the day", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/#try");
  const ui = sim(page);
  const day = ui.root.locator("#sim-day");
  // Chromium's en-US date field has the segments month, day, year; every keystroke is a change event, and
  // typing "1" or "2" passes through dates outside the window that must not move the day.
  await day.focus();
  await page.keyboard.type("11262026");
  await expect(day).toHaveValue("2026-11-26");
  await expect(ui.verdict).toHaveAttribute("data-reason", "MARKET_CLOSED");
  await expect(ui.checks.nth(3)).toContainText("Thanksgiving · NYSE closed");
  expect(errors).toEqual([]);
});

for (const width of [360, 1024]) {
  test(`the longest simulator strings fit at ${width}px`, async ({ page }) => {
    // A clipboard that refuses, so the manual copy field shows.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("denied")) } });
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?day=2026-11-05&at=1030&buy=NVDAc-999999999.99#try");
    // Widths depend on the web fonts.
    await page.evaluate(() => document.fonts.ready);
    const ui = sim(page);
    await expect(ui.verdict).toHaveAttribute("data-reason", "INSUFFICIENT_BALANCE");
    await expect(ui.root.locator('[data-check="balance"]')).toContainText("$999,999,999.99 > $200 USDC");
    let fit = await measureFit(page);
    expect(fit.overflow).toBeLessThanOrEqual(0);
    expect(fit.clipped).toEqual([]);

    // The longest Execute notice: the longest token label, amount and reason that go together.
    await ui.button("Other token").click();
    await ui.button("Execute").click();
    await expect(ui.root.getByText("Executed 10:30 BUY Other token · $999,999,999.99: Refused · TOKEN_NOT_ALLOWED")).toBeVisible();
    fit = await measureFit(page);
    expect(fit.overflow).toBeLessThanOrEqual(0);
    expect(fit.clipped).toEqual([]);

    await ui.button("Copy link").click();
    await expect(ui.root.getByRole("textbox", { name: "Copy this link:" })).toBeVisible();
    await expect(ui.tape.first()).toContainText("Refused · TOKEN_NOT_ALLOWED");
    fit = await measureFit(page);
    expect(fit.overflow).toBeLessThanOrEqual(0);
    expect(fit.clipped).toEqual([]);
  });
}
