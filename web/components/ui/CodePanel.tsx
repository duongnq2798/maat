import { Fragment } from "react";
import { FACTS } from "@/content/facts";

/** event Decision as declared in IMandateVaultEvents.sol; FACTS.decisionEvent is parity-tested against that file. */
export function CodePanel() {
  const params = FACTS.decisionEvent.value;
  return (
    <div
      role="region"
      aria-label="Decision event in Solidity"
      tabIndex={0}
      data-scroll-x
      className="overflow-x-auto rounded-[20px] bg-ink p-7 text-line"
    >
      <div className="mb-[18px] flex justify-between gap-4 font-mono text-xs text-ink-3">
        <span>IMandateVaultEvents.sol</span>
        <span>solidity {FACTS.solidityVersion.value}</span>
      </div>
      <pre className="m-0 whitespace-pre font-mono text-sm leading-[1.75]">
        <span className="text-code-key">event</span> <span className="text-white">Decision</span>(
        {params.map((p, i) => (
          <Fragment key={p.name}>
            {"\n    "}
            <span className="text-code-type">{p.type}</span>
            {" ".repeat(Math.max(1, 8 - p.type.length))}
            {p.indexed ? (
              <>
                <span className="text-code-key">indexed</span>{" "}
              </>
            ) : null}
            {p.name}
            {i < params.length - 1 ? "," : ""}
          </Fragment>
        ))}
        {"\n);"}
      </pre>
    </div>
  );
}
