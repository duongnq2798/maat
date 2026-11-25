import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type Route, test } from "@playwright/test";
import { getAddress } from "viem";
import addresses from "../content/generated/base-addresses.json" with { type: "json" };
import deployments from "../content/generated/deployments.json" with { type: "json" };
import { REASON_LABEL, REASONS } from "../content/reasons";
import { deploymentConfig } from "../lib/chain/config";
import { type AskChain, installAskChain } from "./fake-ask-rpc";
import { routeLiveRpc } from "./fake-live-rpc";
import { RPC_HOSTS } from "./fake-rpc";
import { collectErrors, measureFit } from "./helpers";

// The date field's segment order depends on the locale.
test.use({ locale: "en-US" });

// The live strip on the same page reads Base mainnet from the browser. Both RPC hosts answer from the recorded weekend
// reading of e2e/fake-live-rpc.ts, so no test here touches the network; e2e/live.spec.ts tests the strip itself.
test.beforeEach(async ({ page }) => {
  await routeLiveRpc(page, "weekend");
});

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
  await expect(ui.verdict.locator('[data-reason-tag="MARKET_CLOSED"]')).toContainText("Market closed");
  await expect(ui.checks.nth(3)).toHaveAttribute("data-mark", "FAIL");

  await ui.button("Thu 5 Nov · 10:30").click();
  await ui.button("$50").click();
  await ui.button("Execute").click();
  await expect(ui.verdict).toHaveAttribute("data-reason", "CONCENTRATION");
  await ui.button("Execute").click();
  await expect(ui.tape).toHaveCount(2);
  await expect(ui.tape.nth(1)).toContainText("Refused · Too much in one stock");
  await expect(ui.tape.nth(1).locator('[data-reason-tag="CONCENTRATION"]')).toContainText("CONCENTRATION");
  // The label and the code are separate boxes, so the rendered text breaks between them; textContent has no break.
  expect(await ui.tape.nth(1).locator('[data-reason-tag="CONCENTRATION"]').innerText()).toMatch(
    /^Too much in one stock\s+CONCENTRATION$/,
  );

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

const VAULT = deploymentConfig(deployments)!.vault;
const NVDAC = getAddress(addresses.find((a) => a.name === "NVDAC")!.value);
const HEAD = 61_964_493n;
// The refusal with the longest label, so the vault's side of the answer is at its longest.
const LONGEST = [...REASONS].sort((a, b) => REASON_LABEL[b].length - REASON_LABEL[a].length)[0]!;

/**
 * "Ask the real vault" on a fake Base. viem's batched http posts an array: those requests go to the vault of
 * e2e/fake-ask-rpc.ts, whose previewIntent answers `preview`, or get HTTP 503 with `down`. Every other request goes on
 * to the strip's fake. Routed after that fake, so this handler runs first. The landing's own vault read is batched too
 * and meets the same fake, which has no contract code to give it, so the landing keeps its recorded Decisions.
 */
async function routeVault(page: Page, opts: { preview: AskChain["preview"] } | { down: true }) {
  let answer: ((route: Route) => Promise<void>) | undefined;
  const capture = { route: async (_match: unknown, handler: (route: Route) => Promise<void>) => void (answer = handler) };
  const preview = "preview" in opts ? opts.preview : 0;
  const seen = await installAskChain(capture as unknown as Page, { head: HEAD, vault: VAULT, owner: VAULT, vaultLogs: [], receipts: {}, txs: {}, preview, decimals: {} });
  await page.route(
    (url) => RPC_HOSTS.includes(url.host),
    async (route) => {
      const request = route.request();
      if (request.method() !== "POST" || !Array.isArray(request.postDataJSON())) return route.fallback();
      if ("down" in opts) return route.fulfill({ status: 503, headers: { "access-control-allow-origin": "*" }, contentType: "text/plain", body: "Service Unavailable" });
      return answer!(route);
    },
  );
  return seen;
}

test("asking the real vault shows its typed reason beside the simulation's, from one free previewIntent", async ({ page }) => {
  const errors = collectErrors(page);
  const seen = await routeVault(page, { preview: 6 }); // MARKET_CLOSED
  await page.goto("/#try");
  const ui = sim(page);
  // Hydrated: Post on X carries the absolute share link only once the simulator runs, so the click below lands.
  await expect(ui.root.getByRole("link", { name: "Post on X" })).toHaveAttribute("href", /&url=/);
  const panel = ui.root.locator("[data-real-vault]");
  await expect(panel).toHaveAttribute("data-real-vault", "idle");
  await expect(panel).toContainText("No wallet: nothing is signed or sent.");

  await ui.button("Ask the real vault").click();
  await expect(panel).toHaveAttribute("data-real-vault", "answer");
  const vault = panel.locator('[data-answer="vault"]');
  await expect(vault.locator('[data-reason-tag="MARKET_CLOSED"]')).toContainText("Market closed");
  await expect(vault).toContainText("REAL VAULT · BLOCK 61,964,493");
  await expect(panel.locator('[data-answer="simulation"] [data-reason-tag="OK"]')).toBeVisible();
  await expect(panel.locator("[data-vault-match]")).toHaveAttribute("data-vault-match", "differ");
  await expect(panel.locator("[data-vault-match]")).toContainText("They differ. The simulation is a model");
  // The simulation's own answer does not move.
  await expect(ui.verdict).toHaveAttribute("data-reason", "OK");
  // The answer adds a refusal in red on white beside the simulation's yes: the same axe check as the landing's.
  const { violations } = await new AxeBuilder({ page }).include("#try [data-real-vault]").analyze();
  expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);

  // One previewIntent of the simulated BUY, to the vault deployments/README.md records; nothing is sent.
  expect(seen.previews).toEqual([{ action: 0, token: NVDAC, amount: 20_000_000n }]);
  expect(seen.methods.filter((m) => /^eth_send|^wallet_|^eth_sign/.test(m))).toEqual([]);
  expect(errors).toEqual([]);
});

test("asking the real vault fails closed with a clear line when the RPCs are down", async ({ page }) => {
  const errors = collectErrors(page);
  await routeVault(page, { down: true });
  await page.goto("/#try");
  const ui = sim(page);
  await expect(ui.root.getByRole("link", { name: "Post on X" })).toHaveAttribute("href", /&url=/);
  const panel = ui.root.locator("[data-real-vault]");
  await ui.button("Ask the real vault").click();
  await expect(panel).toHaveAttribute("data-real-vault", "error");
  await expect(panel).toContainText("The real vault could not be asked, so there is no answer from it.");
  await expect(panel.locator('[data-answer="vault"]')).toHaveCount(0);
  await expect(ui.button("Ask the real vault")).toBeEnabled();
  await expect(ui.verdict).toHaveAttribute("data-reason", "OK");
  // The only errors are the browser's lines for the 503s.
  expect(errors.filter((e) => !/status of 503\b/.test(e))).toEqual([]);
});

test("a share link reproduces its refusal, and a broken one falls back", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/?day=2026-11-26&at=1030&buy=GOOGLc-10#try");
  const ui = sim(page);
  await expect(ui.verdict).toHaveAttribute("data-reason", "MARKET_CLOSED");
  await expect(ui.checks.nth(3)).toContainText("Thanksgiving · NYSE closed");
  const post = new URL((await ui.root.getByRole("link", { name: "Post on X" }).getAttribute("href")) ?? "");
  expect(post.searchParams.get("text")).toBe(
    "I tried to buy $10 of GOOGLc on Thu 26 Nov at 10:30 ET. Maat's simulator said no: Market closed (MARKET_CLOSED).",
  );
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
    await routeVault(page, { preview: REASONS.indexOf(LONGEST) + 1 });
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
    await expect(
      ui.root.getByText("Executed 10:30 BUY Other token · $999,999,999.99: Refused · Token not allowed (TOKEN_NOT_ALLOWED)"),
    ).toBeVisible();
    fit = await measureFit(page);
    expect(fit.overflow).toBeLessThanOrEqual(0);
    expect(fit.clipped).toEqual([]);

    await ui.button("Copy link").click();
    await expect(ui.root.getByRole("textbox", { name: "Copy this link:" })).toBeVisible();
    await expect(ui.tape.first()).toContainText("Refused · Token not allowed");
    // "Refused ·" stays whole on the label's line: when the row runs out of room, the code wraps under the label. Line
    // tops come from a Range over the text: "Refused · " can be a bare text node, which has no box of its own.
    const prefix = await ui.tape
      .first()
      .locator("> span:last-child")
      .evaluate((el) => {
        const tops = (node: Node) => {
          const range = document.createRange();
          range.selectNodeContents(node);
          return [...range.getClientRects()].map((r) => Math.round(r.top));
        };
        const own = tops(el.firstChild!);
        const label = tops(el.querySelector("[data-reason-tag] > :first-child")!);
        return { lines: new Set(own).size, offset: Math.abs(own[0]! - label[0]!) };
      });
    expect(prefix.lines).toBe(1);
    expect(prefix.offset).toBeLessThanOrEqual(1);
    await expect(ui.tape.first().locator('[data-reason-tag="TOKEN_NOT_ALLOWED"]')).toContainText("TOKEN_NOT_ALLOWED");
    fit = await measureFit(page);
    expect(fit.overflow).toBeLessThanOrEqual(0);
    expect(fit.clipped).toEqual([]);

    // The real vault's longest answer: the refusal with the longest label, beside the simulation's, and the text on
    // why the two differ.
    await ui.button("Ask the real vault").click();
    await expect(ui.root.locator(`[data-answer="vault"] [data-reason-tag="${LONGEST}"]`)).toBeVisible();
    await expect(ui.root.locator('[data-vault-match="differ"]')).toBeVisible();
    fit = await measureFit(page);
    expect(fit.overflow).toBeLessThanOrEqual(0);
    expect(fit.clipped).toEqual([]);
  });
}
