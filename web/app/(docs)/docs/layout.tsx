import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";
import { Mark } from "@/components/ui/Mark";
import { source } from "@/lib/docs-source";
import { SITE } from "@/lib/site";

/**
 * The docs header (logo, search, GitHub, X), the sidebar by section, and in its footer the theme toggle, then the license
 * and the disclaimer, as the landing page's footer has them.
 */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.getPageTree()}
      nav={{
        title: (
          <>
            <Mark size={24} />
            <span>{SITE.name} Docs</span>
          </>
        ),
        url: "/docs",
      }}
      sidebar={{
        prefetch: false,
        footer: (
          <div className="mt-3 flex flex-col items-start gap-1 text-xs text-fd-muted-foreground">
            <a href={SITE.licenseUrl} className="inline-flex min-h-11 items-center font-medium text-fd-foreground hover:text-fd-primary md:min-h-0">
              MIT License
            </a>
            <p>{SITE.disclaimer}</p>
          </div>
        ),
      }}
      githubUrl={SITE.repoUrl}
      links={[
        { text: "Home", url: "/" },
        { text: SITE.xHandle, url: SITE.xUrl, external: true },
      ]}
    >
      {children}
    </DocsLayout>
  );
}
