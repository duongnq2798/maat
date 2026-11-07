import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getMDXComponents } from "@/components/docs/mdx";
import { source } from "@/lib/docs-source";
import { SITE } from "@/lib/site";

// Static export: every docs URL comes from generateStaticParams, nothing is rendered on request.
export const dynamicParams = false;

export default async function Page({ params }: PageProps<"/docs/[[...slug]]">) {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();

  const { body: MDX, toc, full, title, description } = page.data;
  return (
    <DocsPage toc={toc} full={full}>
      <DocsTitle>{title}</DocsTitle>
      <DocsDescription>{description}</DocsDescription>
      <DocsBody>
        <MDX components={getMDXComponents()} />
      </DocsBody>
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
