import { Fragment } from "react";
import { inlines, parseRule, PROOF_RULE } from "./rule";

function Line({ text }: { text: string }) {
  return (
    <>
      {inlines(text).map((piece, i) =>
        piece.kind === "code" ? (
          <code key={i} className="rounded-sm bg-surface-soft px-1 py-px font-mono text-[0.9em] text-ink [overflow-wrap:anywhere]">
            {piece.text}
          </code>
        ) : piece.kind === "strong" ? (
          <strong key={i} className="font-semibold text-ink">
            {piece.text}
          </strong>
        ) : (
          <Fragment key={i}>{piece.text}</Fragment>
        ),
      )}
    </>
  );
}

/** The counting rule as the spec writes it: every paragraph, the table of lines and the team list, with no link. */
export function RuleText() {
  return (
    <div data-proof-rule="" className="flex max-w-[820px] flex-col gap-4 text-[15px] leading-relaxed text-ink-body">
      {parseRule(PROOF_RULE).map((block, i) => {
        if (block.kind === "p") {
          return (
            <p key={i} className="m-0">
              <Line text={block.text} />
            </p>
          );
        }
        if (block.kind === "list") {
          return (
            <ul key={i} className="m-0 flex list-disc flex-col gap-2 pl-5">
              {block.items.map((item, j) => (
                <li key={j}>
                  <Line text={item} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <div key={i} className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-[14px]">
              <thead>
                <tr>
                  {block.head.map((h, j) => (
                    <th key={j} scope="col" className="border-b border-line py-2 pr-4 font-semibold text-ink">
                      <Line text={h} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, j) => (
                  <tr key={j}>
                    {row.map((cell, k) =>
                      k === 0 ? (
                        <th key={k} scope="row" className="border-b border-line py-2 pr-4 align-top font-medium whitespace-nowrap text-ink">
                          <Line text={cell} />
                        </th>
                      ) : (
                        <td key={k} className="border-b border-line py-2 pr-4 align-top">
                          <Line text={cell} />
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
