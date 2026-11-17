import { pageSchema } from "fumadocs-core/source/schema";
import { z } from "zod";

// Relative imports only: source.config.ts loads this file through the fumadocs-mdx bundler, outside Next.

export const DOC_TYPES = ["concept", "guide", "reference", "help", "overview"] as const;
export const AUDIENCES = ["newcomer", "watcher", "developer", "builder", "evaluator"] as const;
export const STATUSES = ["fork-tested", "live", "planned"] as const;

export type DocStatus = (typeof STATUSES)[number];
export type Audience = (typeof AUDIENCES)[number];

/** A docs page path below /docs, like concepts/nine-checks. */
const slug = z.string().regex(/^[a-z0-9-]+(\/[a-z0-9-]+)*$/, "use a docs path like concepts/nine-checks");

/** Docs frontmatter: the Fumadocs page fields plus what the docs center tracks per page. */
export const docsFrontmatter = pageSchema.extend({
  type: z.enum(DOC_TYPES),
  audience: z.array(z.enum(AUDIENCES)).min(1),
  status: z.enum(STATUSES),
  // YAML 1.2 keeps an unquoted 2026-11-07 a string, so quoted and unquoted dates both pass.
  lastReviewed: z.iso.date(),
  /** Repo paths the page is checked against, linked in its "Source of truth" box. */
  sources: z.array(z.string().min(1)).default([]),
  /** Pages to read next, in order. */
  next: z.array(slug).min(1).max(3).default([]),
});

export type DocsFrontmatter = z.infer<typeof docsFrontmatter>;

export const STATUS_LABEL: Record<DocStatus, string> = {
  "fork-tested": "Fork-tested",
  live: "Live on mainnet",
  planned: "Planned",
};

/**
 * Each label's meaning, word for word from the table on the status page (test/docs-page.test.tsx compares them). The
 * page header's label and the Status line of each Markdown copy both give it.
 */
export const STATUS_MEANING: Record<DocStatus, string> = {
  "fork-tested": "Built and tested; the contracts and the send path have run on a Base mainnet fork; not deployed.",
  live: "Deployed to Base mainnet by the owner, with the addresses recorded in deployments/README.md.",
  planned: "Designed but not built.",
};

/**
 * What a docs page's header shows of its frontmatter, by its slugs (fumadocs' page.slugs; [] is the docs home). The docs
 * home has no frame at all: it renders HomeHeader, with no label and no date. The Help pages show the date without a
 * label: they are aids around the docs, and the label states how far the project is built and tested (status.mdx says
 * the same). The page (app/(docs)/docs/[[...slug]]/page.tsx) and its Markdown copy (lib/docs-source.ts) both use it,
 * so a copy claims no more than its page.
 */
export function headerFrame(page: {
  slugs: readonly string[];
  data: { status: DocStatus; lastReviewed: string };
}): { status?: DocStatus; lastReviewed: string } | null {
  if (page.slugs.length === 0) return null;
  const { status, lastReviewed } = page.data;
  return page.slugs[0] === "help" ? { lastReviewed } : { status, lastReviewed };
}

export const AUDIENCE_LABEL: Record<Audience, string> = {
  newcomer: "Newcomer",
  watcher: "Watcher",
  developer: "Developer",
  builder: "Builder",
  evaluator: "Evaluator",
};
