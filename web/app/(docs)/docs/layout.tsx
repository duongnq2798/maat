import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";
import { Mark } from "@/components/ui/Mark";
import { source } from "@/lib/docs-source";
import { SITE } from "@/lib/site";

/** The docs header (logo, search, GitHub, X), the sidebar by section and the theme toggle in its footer. */
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
