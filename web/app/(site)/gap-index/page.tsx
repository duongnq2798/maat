import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Command, commandParts } from "@/components/gap/Command";
import { GapWindow } from "@/components/gap/GapWindow";
import { BlockLink, INLINE_LINK } from "@/components/gap/WindowTable";
import { DockedPlate } from "@/components/instrument/DockedPlate";
import { Footer } from "@/components/sections/Footer";
import { Mark } from "@/components/ui/Mark";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { B20_DECIMALS, NAV_TOKENS } from "@/content/b20-nav";
import { formatInt } from "@/content/format";
import { etDateTime, PUBLISHED, SPOT_NOT_TWAP } from "@/content/gap-index";
import { ANSWER_UPDATED_TOPIC, SWAP_TOPIC } from "@/lib/gap/decode";
import { BUCKET_SEC, LOOKBACK_SEC } from "@/lib/gap/measure";
import { GAP_RPC, GAP_RPC_FIRST_BLOCK, GAP_RPC_FIRST_BLOCK_TS, SPAN } from "@/lib/gap/rpc";
import type { EditionFile } from "@/lib/gap/schema";
import { repoFileUrl, SITE } from "@/lib/site";

// A page's openGraph replaces the layout's whole object, so /gap-index names the landing's link preview image again: the
// same object as app/(site)/layout.tsx.
const ogImage = {
  url: "/opengraph-image.png",
  type: "image/png",
  width: 1200,
  height: 630,
  alt: readFileSync(join(process.cwd(), "app/opengraph-image.alt.txt"), "utf8"),
};

const HEADING = "Weekend Gap Index";
const TITLE = `${HEADING} · ${SITE.name}`;
const DESCRIPTION = `For each closed NYSE window: how long the Chainlink feeds of the ${NAV_TOKENS.length} B20 stocks on Base went without an update, and the Aerodrome swaps and gaps meanwhile.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/gap-index" },
  openGraph: {
    type: "website",
    url: "/gap-index",
    siteName: SITE.name,
    title: TITLE,
    description: DESCRIPTION,
    locale: "en_US",
    images: [ogImage],
  },
  twitter: {
    card: "summary_large_image",
    site: SITE.xHandle,
    creator: SITE.xHandle,
    title: TITLE,
    description: DESCRIPTION,
    images: [ogImage],
  },
};

/** Links off the site (Basescan, GitHub) open in a new tab. */
const EXTERNAL = { target: "_blank", rel: "noopener noreferrer" } as const;

/**
 * The edition the method's example names: the latest with a measured window, else the latest. The command's edition
 * and the example window both come from it, so they always name a row that exists.
 */
const EXAMPLE_EDITION = PUBLISHED.find((e) => e.windows.some((w) => w.status === "complete")) ?? PUBLISHED[0]!;

/** The exact command that reproduces one row of an edition, in the parts a narrow screen may wrap between. */
const COMMAND = commandParts(EXAMPLE_EDITION.edition);

/** The day of the first block the keyless endpoint serves, as the ISO date of its timestamp. */
const ENDPOINT_FROM = new Date(GAP_RPC_FIRST_BLOCK_TS * 1000).toISOString().slice(0, 10);

/**
 * Without JavaScript, every token's panel shows, one after another, and the preview of the tab row does not: undoes
 * the rule in globals.css that keeps the first panel only until the tabs mount.
 */
const NO_SCRIPT_TABS = '[data-token-tabs="all"]>[data-panel]~[data-panel]{display:block}[data-tabs-preview]{display:none}';

function Code({ children }: { children: ReactNode }) {
  return <code className="font-mono text-[0.9em] text-ink [overflow-wrap:anywhere]">{children}</code>;
}

function RepoFile({ path }: { path: string }) {
  return (
    <a href={repoFileUrl(path)} {...EXTERNAL} className="font-mono text-[0.9em] [overflow-wrap:anywhere]">
      {path}
    </a>
  );
}

/** Its own small header, as on /now: the landing's Nav links anchors on the landing itself. */
function Header() {
  return (
    <header>
      <nav aria-label="Main" className="wrap flex flex-wrap items-center justify-between gap-3 py-[18px]">
        <a href="/" aria-label="Maat home" className="flex items-center gap-2.5 text-ink">
          <Mark />
          <span className="text-[21px] font-semibold tracking-[-0.03em]">maat</span>
        </a>
        <div className="flex flex-wrap items-center gap-1">
          <DockedPlate className="mr-2 hidden md:inline-flex" />
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

function Edition({ e }: { e: EditionFile }) {
  const headingId = `edition-${e.edition}`;
  const measured = e.windows.filter((w) => w.status === "complete").length;
  return (
    <section aria-labelledby={headingId} data-edition={e.edition} className="border-t border-line">
      <div className="wrap flex flex-col gap-14 py-16 md:py-20">
        <div className="flex max-w-[820px] flex-col gap-3">
          <span className="eyebrow">Edition {e.edition}</span>
          <h2 id={headingId} className="m-0 text-[clamp(28px,3.6vw,44px)] font-semibold leading-[1.08] tracking-[-0.035em]">
            {e.title}
          </h2>
          <p className="m-0 text-[15px] leading-relaxed text-ink-2">
            Read from Base mainnet through block <BlockLink block={e.head.block} />, {etDateTime(e.head.ts)}.{" "}
            {measured} of {e.windows.length} windows measured.
          </p>
        </div>
        {e.windows.map((w) => (
          <GapWindow key={w.id} w={w} edition={e.edition} />
        ))}
      </div>
    </section>
  );
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-4 text-[15px] leading-relaxed text-ink-body">
      <h3 className="m-0 text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">{title}</h3>
      {children}
    </div>
  );
}

function Term({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-line py-3 last:border-b-0">
      <dt className="font-medium text-ink">{name}</dt>
      <dd className="m-0">{children}</dd>
    </div>
  );
}

function Method() {
  const example = EXAMPLE_EDITION.windows.find((w) => w.status === "complete")?.id;
  const lookbackDays = LOOKBACK_SEC / 86_400;
  return (
    <section id="method" aria-labelledby="method-title" className="border-t border-line bg-surface-soft">
      <div className="wrap flex flex-col gap-14 py-20 md:py-28">
        <SectionHeading
          eyebrow="Method"
          id="method-title"
          title="How these numbers are read"
          lead="From Base logs alone, by a script anyone can run. Every figure carries the blocks it was read over."
        />

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] items-start gap-x-16 gap-y-14">
          <div className="flex min-w-0 flex-col gap-14">
            <Part title="Closed windows">
              <p className="m-0">
                A closed window runs from one NYSE regular-session close to the next regular-session open, when at least
                one full calendar day without a session lies between them: a weekend or a holiday. An overnight gap
                between two session days is not a window. Session times come from{" "}
                <RepoFile path="web/content/calendar.ts" />, the repository&apos;s tested port of{" "}
                <RepoFile path="contracts/src/MarketCalendar.sol" />, with its holidays, its early closes and New York
                daylight saving time.
              </p>
              <p className="m-0">
                A window&apos;s blocks run from the first block at or after the close to the last block before the open,
                found by binary search over block headers. An edition is a date range in{" "}
                <RepoFile path="web/content/gap-index/editions.ts" />, and its windows are the ones whose close falls in
                it. A window that has not ended when the script runs is pending: its figures are added after it ends.
              </p>
            </Part>

            <Part title="What is read">
              <p className="m-0">
                Everything comes from Base mainnet over <Code>{GAP_RPC}</Code>, which is free and keyless, with{" "}
                <Code>eth_getLogs</Code>, <Code>eth_getBlockByNumber</Code>, <Code>eth_blockNumber</Code>, and{" "}
                <Code>eth_call</Code> at <Code>latest</Code> only. The endpoint serves blocks from{" "}
                {formatInt(GAP_RPC_FIRST_BLOCK)} ({ENDPOINT_FROM}), so it reproduces every window since then; older blocks
                need an archive node. The tokens, their feeds and their pools are the{" "}
                {NAV_TOKENS.length} of <RepoFile path="web/content/b20-nav.ts" />, the same list as{" "}
                <a href="/now" className={INLINE_LINK}>
                  /now
                </a>
                .
              </p>
              <ul className="m-0 flex list-disc flex-col gap-3 pl-5">
                <li>
                  <span className="font-medium text-ink">Feed updates.</span> The proxy&apos;s <Code>phaseId()</Code> and{" "}
                  <Code>phaseAggregators(uint16)</Code>, read at <Code>latest</Code>, list the aggregator of each phase.
                  Their <Code>AnswerUpdated</Code> logs, topic <Code>{ANSWER_UPDATED_TOPIC}</Code>, are read over the
                  window; backwards from its start, {formatInt(SPAN)} blocks at a time, until the last update before it,
                  stopping once a span starts more than {lookbackDays} days before the close; and forwards from its
                  end, at most {lookbackDays} days, until the first update at or after the open. Each row records the
                  aggregator and phase of the logs it used; logs from two aggregators in one token&apos;s ranges fail the
                  run, and a token with no update records the latest phase.
                </li>
                <li>
                  <span className="font-medium text-ink">Swaps.</span> The pool&apos;s <Code>Swap</Code> logs, topic{" "}
                  <Code>{SWAP_TOPIC}</Code>, are read over the window and over the interval without a feed update,
                  whichever reaches further. In every pool, token0 is USDC and token1 is the stock.
                </li>
              </ul>
            </Part>
          </div>

          <div className="flex min-w-0 flex-col gap-14">
            <Part title="The measures">
              <p className="m-0">
                Prices use {B20_DECIMALS} decimals, like the feeds, and logs are ordered by block, then log index.
              </p>
              <dl className="m-0 flex flex-col">
                <Term name="Pool price after a swap">
                  <Code>sqrtPriceX96</Code> from the Swap log, converted by <Code>priceFromSqrt</Code> in{" "}
                  <RepoFile path="web/lib/live/price.ts" />. A gap compares {SPOT_NOT_TWAP}, with the answer the feed
                  held.
                </Term>
                <Term name="Answer held">
                  The <Code>current</Code> of the last <Code>AnswerUpdated</Code> at or before that swap.
                </Term>
                <Term name="Frozen">
                  The longest interval between two consecutive feed updates that overlaps the window, from the update
                  whose answer held to the next one, in hours, with both blocks and times. It can start before the close
                  and end after the open. These feeds update on a price move or on a heartbeat; frozen here says only
                  that no update was logged.
                </Term>
                <Term name="Swaps meanwhile, swaps in window">
                  Swap logs strictly after the update that starts the interval and strictly before the one that ends
                  it; and Swap logs in the window&apos;s blocks.
                </Term>
                <Term name="Largest gap">
                  The largest |pool − held| ÷ held over the swaps meanwhile, in basis points, rounded down as{" "}
                  <Code>premiumBps</Code> rounds; the first swap wins a tie. Its sign says whether the pool was above or
                  below the held answer, and it links to its transaction.
                </Term>
                <Term name="Feed came back">
                  The signed change (next − held) ÷ held, in basis points, truncated toward zero, at the update that
                  ended the interval.
                </Term>
                <Term name="The chart">
                  The window is cut into {BUCKET_SEC / 60}-minute buckets from its close. Each bucket with a swap gives
                  the price after its last swap; each feed update in the window gives a point, and so does the answer
                  in force at the close. The line joins only the points it has.
                </Term>
                <Term name="Feed not live in this window">
                  No update in the window and none in the {lookbackDays} days before it. Such a token has no interval,
                  gap or move, and its swaps are still counted.
                </Term>
              </dl>
            </Part>
          </div>
        </div>

        <Part title="Run it yourself">
          <p className="m-0 max-w-[820px]">
            The script is deterministic: run again over the same blocks, it writes the same figures. To reproduce one
            row, run this from <Code>web/</Code>, where <Code>&lt;id&gt;</Code> is a window&apos;s close date
            {example ? (
              <>
                {" "}
                such as <Code>{example}</Code>
              </>
            ) : null}{" "}
            and <Code>&lt;SYM&gt;</Code> a token as written onchain, such as NVDAc:
          </p>
          <pre className="m-0 max-w-[820px] whitespace-pre-wrap rounded-xl bg-ink px-5 py-4 font-mono text-[13px] leading-6 text-bg">
            <code>
              <Command parts={COMMAND} />
            </code>
          </pre>
          <p className="m-0 max-w-[820px]">
            The edition files are in <RepoFile path="web/content/gap-index" />, and{" "}
            <RepoFile path="web/scripts/gap-index.ts" /> writes them. Nothing here is signed, and the site has no server.
            For the same {NAV_TOKENS.length} tokens read live from Base in your browser, see{" "}
            <a href="/now" className={INLINE_LINK}>
              Right now on Base
            </a>
            .
          </p>
        </Part>
      </div>
    </section>
  );
}

export default function GapIndexPage() {
  return (
    <>
      <noscript>
        <style>{NO_SCRIPT_TABS}</style>
      </noscript>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Header />
      <main id="main" tabIndex={-1} className="outline-none">
        <div className="wrap flex flex-col gap-6 pb-16 pt-8 sm:pt-14 md:pb-20">
          <h1 className="m-0 text-[clamp(40px,5.4vw,72px)] font-semibold leading-none tracking-[-0.045em]">{HEADING}</h1>
          <div className="flex max-w-[820px] flex-col gap-5">
            <p className="lead">
              When NYSE is closed, the Chainlink feeds that price B20 stocks on Base hold their last answer, while the
              Aerodrome pools that trade those tokens keep running. Maat&apos;s vault refuses <Code>MARKET_CLOSED</Code>{" "}
              in those hours. This index measures that stretch from Base logs, for each closed window and each of the{" "}
              {NAV_TOKENS.length} B20 tokens with a NAV:
            </p>
            <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-[17px] leading-relaxed text-ink-body">
              <li>how long the feed went without an update, with the two blocks that bound it;</li>
              <li>the swaps on the token&apos;s Aerodrome pool meanwhile;</li>
              <li>the largest gap, in basis points, between the pool&apos;s price after a swap and the answer the feed held;</li>
              <li>how far the feed&apos;s answer moved when it came back.</li>
            </ul>
            <p className="m-0 text-[15px] leading-relaxed text-ink-2">
              Every figure carries its blocks, so anyone can rerun one command over them and get the same number. See{" "}
              <a href="#method" className={INLINE_LINK}>
                how these numbers are read
              </a>
              .
            </p>
          </div>
        </div>
        {PUBLISHED.map((e) => (
          <Edition key={e.edition} e={e} />
        ))}
        <Method />
      </main>
      <Footer />
    </>
  );
}
