import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { ReactNode } from "react";
import { SITE, siteUrl } from "@/lib/site";
import "../globals.css";

// app/opengraph-image.png sits above both root layouts. Next applies a file-based OG image only at its own
// segment, and the openGraph object below would replace it, so the landing names the image itself.
// (A metadata image inside a route group gets a hashed URL, so the file stays at the app root.)
const ogImage = {
  url: "/opengraph-image.png",
  type: "image/png",
  width: 1200,
  height: 630,
  alt: readFileSync(join(process.cwd(), "app/opengraph-image.alt.txt"), "utf8"),
};

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: SITE.title,
  description: SITE.description,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE.name,
    title: SITE.title,
    description: SITE.description,
    locale: "en_US",
    images: [ogImage],
  },
  twitter: {
    card: "summary_large_image",
    site: SITE.xHandle,
    creator: SITE.xHandle,
    title: SITE.title,
    description: SITE.description,
    images: [ogImage],
  },
};

export const viewport: Viewport = { themeColor: "white" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
