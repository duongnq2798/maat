import type { ReactNode } from "react";

interface Props {
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  /** "split": eyebrow and title left, lead right (stacks when narrow). "stack": all in one column. */
  layout?: "split" | "stack";
  id?: string;
}

export function SectionHeading({ eyebrow, title, lead, layout = "stack", id }: Props) {
  const head = (
    <>
      <span className="eyebrow">{eyebrow}</span>
      <h2 id={id} className="h2">
        {title}
      </h2>
    </>
  );
  if (layout === "split") {
    return (
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] items-end gap-x-16 gap-y-6">
        <div className="flex flex-col gap-[18px]">{head}</div>
        {lead ? <p className="lead">{lead}</p> : null}
      </div>
    );
  }
  return (
    <div className="flex max-w-[820px] flex-col gap-[18px]">
      {head}
      {lead ? <p className="lead">{lead}</p> : null}
    </div>
  );
}
