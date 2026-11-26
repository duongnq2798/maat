import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NowBoard } from "@/components/live/NowBoard";
import { Footer } from "@/components/sections/Footer";
import { Mark } from "@/components/ui/Mark";
import { ReasonTag } from "@/components/ui/ReasonTag";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { MULTICALL3, NAV_TOKENS } from "@/content/b20-nav";
import { CHECK_LABELS } from "@/content/engine";
import { FACTS, type MandateFacts } from "@/content/facts";
import { andList, formatInt } from "@/content/format";
import { pageOgImage } from "@/content/page-cards";
import type { RefusalCode } from "@/content/reasons";
import { SNAPSHOT_REORG_WINDOW } from "@/lib/chain/snapshot";
import { basescanAddress } from "@/lib/live/basescan";
import { formatAge } from "@/lib/live/format";
import { HEAD_MAX_LAG_SEC, LIVE_MAX_AGE_MS, REFRESH_MS } from "@/lib/live/freshness";
import { LIVE_RPCS } from "@/lib/live/rpc";
import { buildCalls, calendarAddress } from "@/lib/live/snapshot";
import { repoFileUrl, SITE } from "@/lib/site";

const TITLE = `Right now on Base · ${SITE.name}`;
const DESCRIPTION = `What an agent under ${SITE.name}'s default mandate would do right now with the ${NAV_TOKENS.length} B20 tokens that have a NAV, read from Base mainnet in your browser.`;

// Its own card (content/page-cards.ts), drawn at build time by app/og/now.png/route.ts; the landing's image stays the landing's.
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/now" },
  openGraph: {
    type: "website",
    url: "/now",
    siteName: SITE.name,
    title: TITLE,
    description: DESCRIPTION,
    locale: "en_US",
    images: [pageOgImage("/now")],
  },
  twitter: {
    card: "summary_large_image",
    site: SITE.xHandle,
    creator: SITE.xHandle,
    title: TITLE,
    description: DESCRIPTION,
    images: [pageOgImage("/now")],
  },
};

/** Links off the site (Basescan, GitHub) open in a new tab. */
const EXTERNAL = { target: "_blank", rel: "noopener noreferrer" } as const;

function Address({ address }: { address: string }) {
  return (
    <a href={basescanAddress(address)} {...EXTERNAL} className="font-mono text-[12px] [overflow-wrap:anywhere]">
      {address}
    </a>
  );
}

function Code({ children }: { children: ReactNode }) {
  return <code className="font-mono text-[0.9em] text-ink">{children}</code>;
}

function RepoFile({ path }: { path: string }) {
  return (
    <a href={repoFileUrl(path)} {...EXTERNAL} className="font-mono text-[0.9em] [overflow-wrap:anywhere]">
      {path}
    </a>
  );
}

/** Its own small header: the landing's Nav links anchors on the landing itself. */
function Header() {
  return (
    <header>
      <nav aria-label="Main" className="wrap flex flex-wrap items-center justify-between gap-3 py-[18px]">
        <a href="/" aria-label="Maat home" className="flex items-center gap-2.5 text-ink">
          <Mark />
          <span className="text-[21px] font-semibold tracking-[-0.03em]">maat</span>
        </a>
        <div className="flex flex-wrap items-center gap-1">
          <a href="/#how" className="navlink max-[720px]:hidden">
            How Maat decides
          </a>
          <a href={SITE.docsUrl} className="navlink">
            Docs
          </a>
          <a href={SITE.repoUrl} {...EXTERNAL} className="pill-dark ml-2 px-[18px] py-[11px]">
            View on GitHub
            <span aria-hidden="true"> ↗</span>
          </a>
        </div>
      </nav>
    </header>
  );
}

type Threshold = Extract<keyof MandateFacts, "maxStalenessSec" | "maxPremiumBps" | "twapWindowSec" | "multiplierCooldownSec">;

const THRESHOLDS: readonly { key: Threshold; unit: string }[] = [
  { key: "maxStalenessSec", unit: "s" },
  { key: "maxPremiumBps", unit: "bps" },
  { key: "twapWindowSec", unit: "s" },
  { key: "multiplierCooldownSec", unit: "s" },
];

/** How the page decides each check of MandateVault._check for a BUY (spec section 4), and the code it refuses with. */
const CHECKS: readonly { how: ReactNode; code: RefusalCode | null }[] = [
  { how: <>in the basket: {andList(FACTS.basket.value)}</>, code: "TOKEN_NOT_ALLOWED" },
  { how: <><Code>isPaused(0)</Code>; a failed call counts as paused</>, code: "TOKEN_PAUSED" },
  { how: <>not run: it needs a vault&apos;s address</>, code: null },
  { how: <>the NYSE session at the block&apos;s time (see The NYSE session); a failed calendar call counts as closed</>, code: "MARKET_CLOSED" },
  {
    how: (
      <>
        answer &gt; 0 and <Code>updatedAt</Code> ≠ 0 and ≤ the block time, else <Code>BAD_PRICE</Code>; refused when the
        answer is older than <Code>maxStalenessSec</Code>
      </>
    ),
    code: "FEED_STALE",
  },
  {
    how: (
      <>
        as for a vault whose record holds the current multiplier: <Code>effectiveAt</Code> in the future, or less than{" "}
        <Code>multiplierCooldownSec</Code> after it; a failed call counts as blocked
      </>
    ),
    code: "MULTIPLIER_COOLDOWN",
  },
  {
    how: (
      <>
        a pool TWAP over <Code>twapWindowSec</Code> that cannot be read is <Code>BAD_PRICE</Code>; refused when it is more
        than <Code>maxPremiumBps</Code> from the Chainlink answer
      </>
    ),
    code: "PREMIUM_TOO_HIGH",
  },
  { how: <>not run: it needs a vault&apos;s balances</>, code: null },
  { how: <>not run: it needs a vault&apos;s balances</>, code: null },
];

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-4 text-[15px] leading-relaxed text-ink-body">
      <h3 className="m-0 text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">{title}</h3>
      {children}
    </div>
  );
}

function Method() {
  const m = FACTS.mandate.value;
  const calendar = calendarAddress();
  return (
    <section id="method" aria-labelledby="method-title" className="border-t border-line bg-surface-soft">
      <div className="wrap flex flex-col gap-14 py-20 md:py-28">
        <SectionHeading
          eyebrow="Method"
          id="method-title"
          title="How this page reads Base"
          lead="Your browser asks a public Base RPC for one block's state with eth_call and judges it the way MandateVault would judge a BUY. For the week it reads the vault's Decisions as the ledger does, with eth_getCode, eth_getLogs and block, receipt and transaction reads, and the agent's journal from raw.githubusercontent.com. Every one is a read: nothing is signed or sent, and this site has no server."
        />

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] items-start gap-x-16 gap-y-14">
          <div className="flex min-w-0 flex-col gap-14">
            <Part title="One multicall at one block">
              <p className="m-0">
                Every refresh is one <Code>eth_call</Code> to Multicall3 (<Address address={MULTICALL3} />){" "}
                <Code>aggregate3</Code> at the latest block. Each call in it has <Code>allowFailure = true</Code>, so a call
                that fails comes back as a failure and is judged as the contract judges it, never dropped.
              </p>
              <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5">
                <li>
                  <Code>getBlockNumber()</Code> and <Code>getCurrentBlockTimestamp()</Code>, so the block and its time come
                  from the same state as every value
                </li>
                <li>
                  per token: <Code>isPaused(0)</Code> (the transfer feature), <Code>uiMultiplier()</Code>,{" "}
                  <Code>effectiveAt()</Code>
                </li>
                <li>
                  per feed: <Code>latestRoundData()</Code>
                </li>
                <li>
                  per pool: <Code>observe([{m.twapWindowSec}, 0])</Code>, the TWAP over <Code>twapWindowSec</Code>
                </li>
              </ul>
              <p className="m-0">That is {buildCalls(m.twapWindowSec).length} calls in one request.</p>
            </Part>

            <Part title="The checks, in order">
              <p className="m-0">
                In the order of <Code>MandateVault._check</Code> and <Code>GuardLib.checkMarket</Code> for a BUY; the first
                failure stops the run. The default mandate runs checks 1 to 7, the market checks 2 to 7.
              </p>
              <ol className="m-0 flex list-none flex-col p-0">
                {CHECK_LABELS.map((label, i) => {
                  const c = CHECKS[i]!;
                  return (
                    <li
                      key={label}
                      data-method-check={i + 1}
                      className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-3 gap-y-1 border-b border-line py-3 last:border-b-0"
                    >
                      <span aria-hidden="true" className="font-mono text-[11px] leading-6 text-ink-2">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                          <span className="font-medium text-ink">{label}</span>
                          {c.code ? (
                            <ReasonTag code={c.code} tone="neutral" layout="inline" className="text-[13px]" />
                          ) : (
                            <span className="font-mono text-[11px] text-ink-2">not run</span>
                          )}
                        </span>
                        <span className="text-[14px] text-ink-2">{c.how}</span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </Part>
          </div>

          <div className="flex min-w-0 flex-col gap-14">
            <Part title="The NYSE session">
              {calendar === null ? (
                <p className="m-0">
                  Until <RepoFile path="deployments/README.md" /> gives a Base mainnet MarketCalendar address, the session
                  comes from <RepoFile path="web/content/calendar.ts" />, the repo&apos;s tested port of{" "}
                  <RepoFile path="contracts/src/MarketCalendar.sol" />, at the block&apos;s timestamp. The status line then
                  says repo calendar. Once the address is there, a second <Code>eth_call</Code> at the same block reads{" "}
                  <Code>isOpen(blockTimestamp, REGULAR)</Code>, and a failed call counts as closed.
                </p>
              ) : (
                <p className="m-0">
                  A second <Code>eth_call</Code> at the same block asks MarketCalendar (<Address address={calendar} />){" "}
                  <Code>isOpen(blockTimestamp, REGULAR)</Code>. A failed call counts as closed.
                </p>
              )}
            </Part>

            <Part title="The week and the agent's note">
              <p className="m-0">
                The week is drawn from <RepoFile path="web/content/calendar.ts" /> at your clock: its sessions, holidays and
                early closes, in New York time. The large line under its heading comes from the reading above: while the
                reading&apos;s session is closed it names the next REGULAR open, as <Code>nextOpen</Code> counts it.
              </p>
              <p className="m-0">
                The ticks are the vault&apos;s <Code>Decision</Code> events on Base mainnet, read with the ledger&apos;s own
                loader over the same RPCs. The first read starts from the committed snapshot,{" "}
                <Code>/data/decisions-snapshot.json</Code>: once Base gives the same hash for its block and the same logs in
                their receipts, the logs up to {formatInt(Number(SNAPSHOT_REORG_WINDOW + 1n))} blocks before it come from the file, and{" "}
                <Code>eth_getLogs</Code> scans the rest to the head. Without it, the scan starts at the deploy block. Then each Decision&apos;s block, receipt and
                transaction are read, so each one has its time and its sender. The line under the week says which way the
                read went. Nothing is signed or sent.
              </p>
              <p className="m-0">
                The note is the newest round summary on the public agent-journal branch, fetched from raw.githubusercontent.com
                and shown only after your browser has checked the hash of every line, as the ledger&apos;s Rounds tab does.
                While the branch has no summary, the page shows no note.
              </p>
            </Part>

            <Part title="The limits">
              <p className="m-0">The default mandate&apos;s values, as the checks use them.</p>
              <dl className="m-0 flex flex-col">
                {THRESHOLDS.map((t) => (
                  <div
                    key={t.key}
                    data-threshold={t.key}
                    data-value={m[t.key]}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-line py-2.5"
                  >
                    <dt>
                      <Code>{t.key}</Code>
                    </dt>
                    <dd className="m-0 font-mono text-[14px] font-medium text-ink">
                      {formatInt(m[t.key])} {t.unit}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="m-0 text-[13px] text-ink-2">Source: {FACTS.mandate.source}</p>
            </Part>

            <Part title="The endpoints">
              <p className="m-0">
                The keyless public RPCs below, tried in order; the status line names the one that answered. No key and
                no environment variable is read, so nothing private can reach your browser.
              </p>
              <ol className="m-0 flex flex-col gap-1 pl-5">
                {LIVE_RPCS.map((url) => (
                  <li key={url} data-endpoint className="font-mono text-[13px] text-ink [overflow-wrap:anywhere]">
                    {url}
                  </li>
                ))}
              </ol>
              <p className="m-0">
                This tab reads again every {formatAge(REFRESH_MS / 1000)} while it is visible. A reading shows as live only
                while it is less than {formatAge(LIVE_MAX_AGE_MS / 1000)} old and its block was at most{" "}
                {formatAge(HEAD_MAX_LAG_SEC)} behind your clock when it was read; otherwise the status line says not live,
                and why.
              </p>
            </Part>
          </div>
        </div>

        <Part title={`The ${NAV_TOKENS.length} tokens`}>
          <p className="m-0 max-w-[820px]">
            Coinbase&apos;s keyless list of tokenized stocks gives a NAV for exactly these B20s, and the NAV is the answer
            of the token&apos;s Chainlink feed. Each pool is the token&apos;s Aerodrome Slipstream pool against USDC. The
            list, with the source of every address, is <RepoFile path="web/content/b20-nav.ts" />.
          </p>
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] gap-3 p-0">
            {NAV_TOKENS.map((t) => (
              <li key={t.symbol} data-method-token={t.symbol} className="card flex flex-col gap-2.5 p-4">
                <p className="m-0 flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold text-ink">{t.symbol}</span>
                  <span className="text-[13px] text-ink-2">{t.name}</span>
                </p>
                <dl className="m-0 flex flex-col gap-1.5">
                  {(
                    [
                      ["Token", t.token],
                      ["Chainlink feed", t.feed],
                      ["Pool", t.pool],
                    ] as const
                  ).map(([what, address]) => (
                    <div key={what} className="flex flex-col">
                      <dt className="font-mono text-[11px] text-ink-2">{what}</dt>
                      <dd className="m-0">
                        <Address address={address} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
          <p className="m-0 max-w-[820px]">
            How long the feeds hold their answer while NYSE is closed, per weekend:{" "}
            <a href="/gap-index" className="underline underline-offset-2">
              Weekend Gap Index
            </a>
            .
          </p>
        </Part>
      </div>
    </section>
  );
}

export default function NowPage() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Header />
      <main id="main" tabIndex={-1} className="outline-none">
        <div className="wrap flex flex-col gap-10 pb-20 pt-8 sm:pt-14 md:pb-28">
          <div className="flex max-w-[820px] flex-col gap-5">
            <h1 className="m-0 text-[clamp(40px,5.4vw,72px)] font-semibold leading-none tracking-[-0.045em]">
              Right now on Base
            </h1>
            <p className="lead">
              Read from Base mainnet in your browser, one block at a time. Nothing is signed, and this site has no server.
            </p>
          </div>
          <NowBoard />
        </div>
        <Method />
      </main>
      <Footer />
    </>
  );
}
