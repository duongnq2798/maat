import { Fragment, type ReactNode } from "react";
import type { BaseConstant } from "@/lib/docs/docs-data";
import { codeParts, FACT_TABLE_HEAD, type FactCode, type FactName, factTable } from "@/lib/docs/fact-text";
import { docsData } from "@/lib/docs/generated";
import { headingId } from "@/lib/docs/links";
import {
  kindLabels,
  NO_DEFAULT,
  NO_EXAMPLE,
  READ_BY,
  readByDetail,
  requiredDetail,
  requiredLabel,
  SELECTOR,
  SOURCE_COMMENT,
  stateLabel,
  TOPIC0,
} from "@/lib/docs/reference-labels";
import {
  accessLabel,
  errorSignatureParts,
  eventSignatureParts,
  findContract,
  findItem,
  type FunctionGroup,
  functionGroups,
  functionSignatureParts,
  type SignaturePart,
  typeHref,
} from "@/lib/docs/signatures";
import type { SolParam } from "@/lib/docs/sol-surface";
import { SITE } from "@/lib/site";
import { ScrollPre, ScrollRegion } from "./ScrollRegion";

// Reference entries for the MDX pages under content/docs/reference. Each reads the committed output of
// `npm run docs:gen` and throws on an unknown name, so a typo in a page fails the build. The words they share
// with the Markdown copies of the pages (lib/docs/component-text.ts) live in lib/docs/reference-labels.ts.

const surface = docsData.surface;

/** A one-line block that scrolls sideways when it is wider than the column; a tab stop only then (ScrollRegion.tsx). */
function Signature({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ScrollPre
      label={label}
      className="not-prose my-3 overflow-x-auto rounded-lg border border-fd-border bg-fd-muted px-4 py-3 font-mono text-[13px] leading-6 text-fd-foreground"
    >
      <code>{children}</code>
    </ScrollPre>
  );
}

/** A signature whose struct and enum types link to their entries on the Types page. */
function Linked({ parts }: { parts: readonly SignaturePart[] }) {
  return (
    <>
      {parts.map((p, i) => {
        const href = p.type ? typeHref(surface, p.text) : null;
        return href ? (
          <a key={i} href={href} className="underline decoration-fd-muted-foreground underline-offset-4 hover:decoration-fd-foreground">
            {p.text}
          </a>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        );
      })}
    </>
  );
}

/** A function's or an error's selector, or an event's topic 0, which a raw call, revert or log carries. */
function Hash({ label, value }: { label: string; value: string }) {
  return (
    <p className="not-prose mt-3 text-sm text-fd-muted-foreground">
      {label}: <code className="font-mono break-all text-fd-foreground">{value}</code>
    </p>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-fd-border px-2.5 py-0.5 text-xs font-medium text-fd-muted-foreground">
      {children}
    </span>
  );
}

function Notice({ text }: { text: string }) {
  return text ? <p className="mt-3 text-fd-muted-foreground">{text}</p> : null;
}

/** A NatSpec comment, labelled as the source's words so it does not read as the docs' own. */
function SourceComment({ text }: { text: string }) {
  return text ? (
    <p className="mt-3 text-fd-muted-foreground">
      <span className="font-medium text-fd-foreground">{SOURCE_COMMENT}</span> {text}
    </p>
  ) : null;
}

/**
 * A table that scrolls inside its own region on small screens, never the page; the region is a tab stop only while it
 * scrolls (ScrollRegion.tsx). A caption goes below it.
 */
function ScrollTable({ label, caption, children }: { label: string; caption?: string; children: ReactNode }) {
  const region = (
    <ScrollRegion label={label} className={caption ? "relative overflow-x-auto" : "relative my-6 overflow-x-auto"}>
      <table className="my-0">{children}</table>
    </ScrollRegion>
  );
  if (!caption) return region;
  return (
    <figure className="my-6">
      {region}
      <figcaption className="mt-2 text-sm text-fd-muted-foreground">{caption}</figcaption>
    </figure>
  );
}

function ParamTable({ label, params, indexed = false }: { label: string; params: readonly SolParam[]; indexed?: boolean }) {
  if (params.length === 0) return null;
  return (
    <ScrollTable label={label}>
      <thead>
        <tr>
          <th>Name</th>
          <th>Type</th>
          {indexed ? <th>Indexed</th> : null}
        </tr>
      </thead>
      <tbody>
        {params.map((p, i) => (
          <tr key={`${i}-${p.name}`}>
            <td><code>{p.name}</code></td>
            <td><code>{p.type}</code></td>
            {indexed ? <td>{p.indexed ? "Yes" : "No"}</td> : null}
          </tr>
        ))}
      </tbody>
    </ScrollTable>
  );
}

/**
 * Summary table of a contract's functions, each linking to its entry. `qualify` when the page heads entries
 * `name (Contract)`. `groups` when the page sorts its entries into sections: the table then follows those sections,
 * each heading its own row group and linking to its section, and must list every function exactly once.
 */
export function FunctionIndex({ contract, qualify = false, groups }: { contract: string; qualify?: boolean; groups?: readonly FunctionGroup[] }) {
  const c = findContract(surface, contract);
  const entry = (name: string) => `#${headingId(qualify ? `${name} (${contract})` : name)}`;
  if (groups) {
    return (
      <ScrollTable label={`${contract} functions`}>
        <thead>
          <tr>
            <th>Function</th>
            <th>Kind</th>
          </tr>
        </thead>
        {functionGroups(surface, contract, groups).map((g) => (
          <tbody key={g.name}>
            <tr>
              <th colSpan={2} scope="rowgroup">
                <a href={`#${headingId(g.name)}`}>{g.name}</a>
              </th>
            </tr>
            {g.functions.map((f) => (
              <tr key={f.name}>
                <td>
                  <a href={entry(f.name)}><code>{f.name}</code></a>
                </td>
                <td>{stateLabel(f)}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </ScrollTable>
    );
  }
  return (
    <ScrollTable label={`${contract} functions`}>
      <thead>
        <tr>
          <th>Function</th>
          <th>Who may call</th>
          <th>Kind</th>
        </tr>
      </thead>
      <tbody>
        {c.functions.map((f, i) => (
          <tr key={`${i}-${f.name}`}>
            <td>
              <a href={entry(f.name)}><code>{f.name}</code></a>
            </td>
            <td>{accessLabel(f.access)}</td>
            <td>{kindLabels(f).join(", ")}</td>
          </tr>
        ))}
      </tbody>
    </ScrollTable>
  );
}

export function Fn({ contract, name }: { contract: string; name: string }) {
  const f = findItem(surface, contract, "functions", name);
  return (
    <div data-entry="function">
      <Signature label={`${name} signature (${contract})`}>
        <Linked parts={functionSignatureParts(f)} />
      </Signature>
      <div className="not-prose flex flex-wrap gap-2">
        <Chip>{accessLabel(f.access)}</Chip>
        {kindLabels(f).map((label) => (
          <Chip key={label}>{label}</Chip>
        ))}
      </div>
      <Hash label={SELECTOR} value={f.selector} />
      <SourceComment text={f.notice} />
    </div>
  );
}

export function EventEntry({ contract, name }: { contract: string; name: string }) {
  const e = findItem(surface, contract, "events", name);
  return (
    <div data-entry="event">
      <Signature label={`${name} signature (${contract})`}>
        <Linked parts={eventSignatureParts(e)} />
      </Signature>
      <Hash label={TOPIC0} value={e.topic0} />
      <SourceComment text={e.notice} />
      <ParamTable label={`${name} parameters (${contract})`} params={e.params} indexed />
    </div>
  );
}

export function ErrorEntry({ contract, name }: { contract: string; name: string }) {
  const e = findItem(surface, contract, "errors", name);
  return (
    <div data-entry="error">
      <Signature label={`${name} signature (${contract})`}>
        <Linked parts={errorSignatureParts(e)} />
      </Signature>
      <Hash label={SELECTOR} value={e.selector} />
      <SourceComment text={e.notice} />
      <ParamTable label={`${name} parameters (${contract})`} params={e.params} />
    </div>
  );
}

/** An enum's members with their ids, or a struct's fields, from contracts/src/Types.sol. */
export function TypeEntry({ name }: { name: string }) {
  const en = surface.enums.find((e) => e.name === name);
  if (en) {
    return (
      <ScrollTable label={`${name} members`}>
        <thead>
          <tr>
            <th>Id</th>
            <th>Member</th>
          </tr>
        </thead>
        <tbody>
          {en.members.map((m, id) => (
            <tr key={m}>
              <td>{id}</td>
              <td><code>{m}</code></td>
            </tr>
          ))}
        </tbody>
      </ScrollTable>
    );
  }
  const st = surface.structs.find((s) => s.name === name);
  if (!st) throw new Error(`type ${name} is not in content/generated/contracts.json (run npm run docs:gen)`);
  return (
    <div data-entry="struct">
      <SourceComment text={st.notice} />
      <ParamTable label={`${name} fields`} params={st.fields} />
    </div>
  );
}

function envVar(name: string) {
  const v = docsData.agent.env.find((e) => e.name === name);
  if (!v) throw new Error(`${name} is not in agent/.env.example (content/generated/agent.json)`);
  return v;
}

/** Every setting in agent/.env.example, each linking to its entry. */
export function EnvTable() {
  return (
    <ScrollTable label="Agent settings">
      <thead>
        <tr>
          <th>Setting</th>
          <th>Read by</th>
          <th>Required</th>
          <th>Default</th>
        </tr>
      </thead>
      <tbody>
        {docsData.agent.env.map((v) => (
          <tr key={v.name}>
            <td><a href={`#${headingId(v.name)}`}><code>{v.name}</code></a></td>
            <td>{READ_BY[v.readBy]}</td>
            <td>{requiredLabel(v)}</td>
            <td>{v.default === null ? NO_DEFAULT : <code>{v.default}</code>}</td>
          </tr>
        ))}
      </tbody>
    </ScrollTable>
  );
}

export function EnvVar({ name }: { name: string }) {
  const v = envVar(name);
  return (
    <div data-entry="env">
      <dl className="not-prose grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-fd-muted-foreground">Read by</dt>
        <dd>{readByDetail(v)}</dd>
        <dt className="text-fd-muted-foreground">Required</dt>
        <dd>{requiredDetail(v)}</dd>
        <dt className="text-fd-muted-foreground">Default</dt>
        <dd>{v.default === null ? NO_DEFAULT : <code>{v.default}</code>}</dd>
        <dt className="text-fd-muted-foreground">In .env.example</dt>
        <dd>{v.example ? <code>{v.example}</code> : NO_EXAMPLE}</dd>
      </dl>
      <Notice text={v.note} />
    </div>
  );
}

export function ScriptEntry({ name }: { name: string }) {
  const s = docsData.agent.scripts.find((x) => x.name === name);
  if (!s) throw new Error(`npm run ${name} is not in agent/package.json (content/generated/agent.json)`);
  return (
    <div data-entry="script">
      <Signature label={`npm run ${s.name}`}>{`npm run ${s.name}`}</Signature>
      <p className="text-fd-muted-foreground">
        Runs <code>{s.command}</code> in <code>agent/</code>.
      </p>
    </div>
  );
}

export function ScriptFile({ name }: { name: string }) {
  if (!docsData.agent.scriptFiles.includes(name)) {
    throw new Error(`agent/scripts/${name} does not exist (content/generated/agent.json)`);
  }
  return (
    <p data-entry="script-file">
      <a href={`${SITE.repoUrl}/blob/main/agent/scripts/${name}`}><code>agent/scripts/{name}</code></a>
    </p>
  );
}

/** Runs of constants that share a group comment, or have none, in file order. */
function addressGroups(list: readonly BaseConstant[]): { group: string; rows: BaseConstant[] }[] {
  const out: { group: string; rows: BaseConstant[] }[] = [];
  for (const a of list) {
    const last = out.at(-1);
    if (last?.group === a.group) last.rows.push(a);
    else out.push({ group: a.group, rows: [a] });
  }
  return out;
}

/**
 * Every constant in contracts/script/BaseAddresses.sol; addresses link to Basescan. A group comment heads its rows
 * once, in a row group of its own, and a row's Note is only the constant's own comment.
 */
export function AddressTable() {
  return (
    <ScrollTable label="Base addresses">
      <thead>
        <tr>
          <th>Name</th>
          <th>Value</th>
          <th>Note</th>
        </tr>
      </thead>
      {addressGroups(docsData.addresses).map((g) => (
        <tbody key={g.rows[0]?.name}>
          {g.group ? (
            <tr>
              <th colSpan={3} scope="rowgroup">
                {g.group}
              </th>
            </tr>
          ) : null}
          {g.rows.map((a) => (
            <tr key={a.name}>
              <td><code>{a.name}</code></td>
              <td>
                {a.type === "address" ? (
                  <a href={`https://basescan.org/address/${a.value}`}><code>{a.value}</code></a>
                ) : (
                  <code>{a.value}</code>
                )}
              </td>
              <td>{a.note}</td>
            </tr>
          ))}
        </tbody>
      ))}
    </ScrollTable>
  );
}

function InCode({ code }: { code: FactCode }) {
  return (
    <>
      {codeParts(code).map((p, i) => (p.code ? <code key={i}>{p.text}</code> : <Fragment key={i}>{p.text}</Fragment>))}
    </>
  );
}

/**
 * Facts for the default parameters page. A table of settings gives each one's plain name, its name in the code,
 * its value and the file that sets it; a table of figures gives the source that proves each one. `label` names the
 * region, so give each table on a page its own; `caption` goes below the table.
 */
export function FactTable({ names, label = "Defaults", caption }: { names: readonly FactName[]; label?: string; caption?: string }) {
  const { settings, rows } = factTable(names);
  return (
    <ScrollTable label={label} caption={caption}>
      <thead>
        <tr>
          {(settings ? FACT_TABLE_HEAD.settings : FACT_TABLE_HEAD.figures).map((h) => (
            <th key={h}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name}>
            <td>{r.label}</td>
            {r.code ? (
              <td>
                <InCode code={r.code} />
              </td>
            ) : null}
            <td>{r.text}</td>
            <td>{r.code ? <code>{r.code.file}</code> : r.source}</td>
          </tr>
        ))}
      </tbody>
    </ScrollTable>
  );
}
