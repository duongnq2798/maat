import { loader } from "fumadocs-core/source";
import { docs } from "@/.source/server";

/** The docs page tree and page lookup, built from content/docs by fumadocs-mdx. */
export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
});

export type DocsPage = NonNullable<ReturnType<typeof source.getPage>>;
