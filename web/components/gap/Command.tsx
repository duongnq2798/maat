import { Fragment } from "react";

/**
 * The command that reproduces one row of an edition, in the parts a narrow screen may wrap between. `-s` keeps npm's
 * banner out of stdout, so the JSON can be piped to a file or to jq.
 */
export function commandParts(edition: number, windowId = "<id>", token = "<SYM>"): string[] {
  return ["npm run -s gap-index --", `--edition ${edition}`, `--window ${windowId}`, `--token ${token}`, "--stdout"];
}

/** The command's parts as nowrap runs, so a line only breaks between them. */
export function Command({ parts }: { parts: readonly string[] }) {
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={part}>
          {i > 0 ? " " : null}
          <span className="whitespace-nowrap">{part}</span>
        </Fragment>
      ))}
    </>
  );
}
