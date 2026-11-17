import { DocsBody, DocsPage } from "fumadocs-ui/layouts/docs/page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getMDXComponents } from "@/components/docs/mdx";
import { listsNextInBody, NextLinks } from "@/components/docs/NextLinks";
import { PageFooter } from "@/components/docs/PageFooter";
import { HomeHeader, PageHeader } from "@/components/docs/PageHeader";
import { SourceOfTruth } from "@/components/docs/SourceOfTruth";
import { pagesInSidebarOrder, source } from "@/lib/docs-source";
import { footerItems } from "@/lib/docs/footer-items";
import { headerFrame } from "@/lib/docs/frontmatter";
import { markdownUrl, readingMinutes } from "@/lib/docs/markdown";
import { SITE, siteUrl } from "@/lib/site";

// Static export: every docs URL comes from generateStaticParams, nothing is rendered on request.
export const dynamicParams = false;

export default async function Page({ params }: PageProps<"/docs/[[...slug]]">) {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();

  const { body: MDX, toc, full, title, description, audience, sources, next } = page.data;
  const markdown = await page.data.getText("processed");
  // The docs home keeps its H1 and lede only, with no Read next block or previous and next cards: its router cards and
  // section map are the ways on.
  const home = page.url === "/docs";
  // The label and the date the header shows, the same ones the page's Markdown copy gives (lib/docs/frontmatter.ts).
  const frame = headerFrame(page);
  return (
    <DocsPage
      // A one-letter heading, such as the glossary's A to X, only groups the entries under it: the TOC lists the entries.
      toc={toc.filter((item) => !(item.depth === 2 && /^#[a-z]$/.test(item.url)))}
      full={full}
      // PageHeader renders the breadcrumb with a Docs root and nav semantics.
      breadcrumb={{ enabled: false }}
      // The previous and next pages in sidebar order, each page once (lib/docs/footer-items.ts), then the feedback, edit
      // and copy row, then the license and the disclaimer, as the landing page's footer has them. In the page, not the
      // sidebar, they show on a phone without opening the drawer, and in a printout.
      footer={{
        items: home
          ? {}
          : footerItems(
              pagesInSidebarOrder().map((p) => ({ name: p.data.title, url: p.url, description: p.data.description })),
              page.url,
            ),
        children: (
          <>
            <PageFooter
              title={title}
              pageUrl={new URL(page.url, siteUrl()).href}
              filePath={page.path}
              markdownHref={markdownUrl(page.url)}
            />
            <footer className="not-prose flex flex-col items-start gap-1 text-xs text-fd-muted-foreground">
              <a href={SITE.licenseUrl} className="inline-flex min-h-11 items-center font-medium text-fd-foreground hover:text-fd-primary md:min-h-0">
                MIT License
              </a>
              <p>{SITE.disclaimer}</p>
            </footer>
          </>
        ),
      }}
    >
      {frame === null ? (
        <HomeHeader title={title} description={description} />
      ) : (
        <PageHeader
          url={page.url}
          title={title}
          description={description}
          status={frame.status}
          audience={audience}
          readingMinutes={readingMinutes(markdown)}
          lastReviewed={frame.lastReviewed}
        />
      )}
      <DocsBody>
        <MDX components={getMDXComponents()} />
      </DocsBody>
      {/* A page whose body has its own Next steps or Related list gets no second one. */}
      {!home && !listsNextInBody(toc) && <NextLinks slugs={next} />}
      <SourceOfTruth sources={sources} />
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata({ params }: PageProps<"/docs/[[...slug]]">): Promise<Metadata> {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();
  const { title, description } = page.data;
  // This openGraph object replaces the file-based image from app/opengraph-image.png, so name it here.
  const images = { url: "/opengraph-image.png", width: 1200, height: 630, alt: SITE.name };
  return {
    // The docs home is the docs center itself: "Maat Docs", not "Maat docs · Maat Docs".
    title: page.url === "/docs" ? { absolute: `${SITE.name} Docs` } : title,
    description,
    alternates: { canonical: page.url, types: { "text/markdown": markdownUrl(page.url) } },
    openGraph: { type: "article", url: page.url, siteName: SITE.name, title, description, images },
    twitter: { card: "summary_large_image", site: SITE.xHandle, title, description, images },
  };
}
