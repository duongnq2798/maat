import { createFromSource } from "fumadocs-core/search/server";
import { source } from "@/lib/docs-source";

// Exported once at build time to out/api/search; the docs search dialog downloads it and searches in the browser.
export const revalidate = false;
export const { staticGET: GET } = createFromSource(source);
