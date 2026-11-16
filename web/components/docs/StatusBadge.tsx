import { type DocStatus, STATUS_LABEL } from "@/lib/docs/frontmatter";

// The dot carries the hue; the label carries the meaning, so the badge reads the same without color.
const DOT: Record<DocStatus, string> = {
  "fork-tested": "bg-fd-warning",
  live: "bg-fd-success",
  planned: "bg-fd-muted-foreground",
};

/** Whether what a page describes is live on mainnet, tested on a fork only, or planned. */
export function StatusBadge({ status }: { status: DocStatus }) {
  return (
    <span
      data-status={status}
      className="not-prose inline-flex items-center gap-1.5 rounded-full border border-fd-border bg-fd-secondary px-2.5 py-0.5 text-xs font-medium text-fd-secondary-foreground"
    >
      <span aria-hidden className={`size-1.5 rounded-full ${DOT[status]}`} />
      {STATUS_LABEL[status]}
    </span>
  );
}
