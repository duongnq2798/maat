import { DocsBody, DocsPage } from "fumadocs-ui/layouts/docs/page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getMDXComponents } from "@/components/docs/mdx";
import { NextLinks } from "@/components/docs/NextLinks";
import { PageFooter } from "@/components/docs/PageFooter";
import { PageHeader } from "@/components/docs/PageHeader";
import { SourceOfTruth } from "@/components/docs/SourceOfTruth";
import { pagesInSidebarOrder, source } from "@/lib/docs-source";
import { footerItems } from "@/lib/docs/footer-items";
import { markdownUrl, readingMinutes } from "@/lib/docs/markdown";
import { SITE, siteUrl } from "@/lib/site";

// Static export: every docs URL comes from generateStaticParams, nothing is rendered on request.
export const dynamicParams = false;

export default async function Page({ params }: PageProps<"/docs/[[...slug]]">) {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();

  const { body: MDX, toc, full, title, description, status, audience, lastReviewed, sources, next } = page.data;
  const markdown = await page.data.getText("processed");
  return (
    <DocsPage
      toc={toc}
      full={full}
      // PageHeader renders the breadcrumb with a Docs root and nav semantics.
      breadcrumb={{ enabled: false }}
      // The previous and next pages in sidebar order, each page once (lib/docs/footer-items.ts), then the feedback, edit
      // and copy row.
      footer={{
        items: footerItems(
          pagesInSidebarOrder().map((p) => ({ name: p.data.title, url: p.url, description: p.data.description })),
          page.url,
        ),
        children: (
          <PageFooter
            title={title}
            pageUrl={new URL(page.url, siteUrl()).href}
            filePath={page.path}
            markdownHref={markdownUrl(page.url)}
          />
        ),
      }}
    >
      <PageHeader
        url={page.url}
        title={title}
        description={description}
        status={status}
        audience={audience}
        readingMinutes={readingMinutes(markdown)}
        lastReviewed={lastReviewed}
      />
      <DocsBody>
        <MDX components={getMDXComponents()} />
      </DocsBody>
      <SourceOfTruth sources={sources} />
      <NextLinks slugs={next} />
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
  const images = { url: "/opengraph-image.png", width: 1200, height: 630 };
  return {
    title,
    description,
    alternates: { canonical: page.url },
    openGraph: { type: "article", url: page.url, siteName: SITE.name, title, description, images },
    twitter: { card: "summary_large_image", site: SITE.xHandle, title, description, images },
  };
}
