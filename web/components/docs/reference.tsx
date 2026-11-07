import type { ReactNode } from "react";
import { type FactName, factFor } from "@/lib/docs/fact-text";
import { docsData } from "@/lib/docs/generated";
import { headingId } from "@/lib/docs/links";
import { accessLabel, errorSignature, eventSignature, findContract, findItem, functionSignature } from "@/lib/docs/signatures";
import type { Mutability, SolFunction, SolParam } from "@/lib/docs/sol-surface";
import { SITE } from "@/lib/site";

// Reference entries for the MDX pages under content/docs/reference. Each reads the committed output of
// `npm run docs:gen` and throws on an unknown name, so a typo in a page fails the build.

const surface = docsData.surface;

const MUTABILITY_LABEL: Readonly<Record<Mutability, string>> = {
  view: "Read only",
  pure: "Read only",
  nonpayable: "Changes state",
  payable: "Changes state, takes ETH",
};

/** What a function does to state, then "Public state" for a getter: the words <Fn> and <FunctionIndex> both use. */
function kindLabels(f: SolFunction): string[] {
  return f.kind === "getter" ? [MUTABILITY_LABEL[f.mutability], "Public state"] : [MUTABILITY_LABEL[f.mutability]];
}

function Signature({ children }: { children: string }) {
  return (
    // tabIndex: a scrollable region must be reachable by keyboard (axe rule scrollable-region-focusable).
    <pre
      className="not-prose my-3 overflow-x-auto rounded-lg border border-fd-border bg-fd-muted px-4 py-3 font-mono text-[13px] leading-6 text-fd-foreground"
      tabIndex={0}
    >
      <code>{children}</code>
    </pre>
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

/** A table that scrolls inside its own focusable region on small screens, never the page. */
function ScrollTable({ label, children }: { label: string; children: ReactNode }) {
  return (
    // tabIndex: a scrollable region must be reachable by keyboard (axe rule scrollable-region-focusable).
    <div className="relative my-6 overflow-x-auto" role="region" aria-label={label} tabIndex={0}>
      <table className="my-0">{children}</table>
    </div>
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

/** Summary table of a contract's functions, each linking to its entry. `qualify` when the page heads entries `name (Contract)`. */
export function FunctionIndex({ contract, qualify = false }: { contract: string; qualify?: boolean }) {
  const c = findContract(surface, contract);
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
              <a href={`#${headingId(qualify ? `${f.name} (${contract})` : f.name)}`}><code>{f.name}</code></a>
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
      <Signature>{functionSignature(f)}</Signature>
      <div className="not-prose flex flex-wrap gap-2">
        <Chip>{accessLabel(f.access)}</Chip>
        {kindLabels(f).map((label) => (
          <Chip key={label}>{label}</Chip>
        ))}
      </div>
      <Notice text={f.notice} />
    </div>
  );
}

export function EventEntry({ contract, name }: { contract: string; name: string }) {
  const e = findItem(surface, contract, "events", name);
  return (
    <div data-entry="event">
      <Signature>{eventSignature(e)}</Signature>
      <Notice text={e.notice} />
      <ParamTable label={`${name} parameters (${contract})`} params={e.params} indexed />
    </div>
  );
}

export function ErrorEntry({ contract, name }: { contract: string; name: string }) {
  const e = findItem(surface, contract, "errors", name);
  return (
    <div data-entry="error">
      <Signature>{errorSignature(e)}</Signature>
      <Notice text={e.notice} />
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
      <Notice text={st.notice} />
      <ParamTable label={`${name} fields`} params={st.fields} />
    </div>
  );
}

function envVar(name: string) {
  const v = docsData.agent.env.find((e) => e.name === name);
  if (!v) throw new Error(`${name} is not in agent/.env.example (content/generated/agent.json)`);
  return v;
}

const READ_BY = { agent: "Agent config", sdk: "SDK" } as const;

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
            <td>{v.required ? "Yes" : v.requiredInLive ? "In live mode" : "No"}</td>
            <td>{v.default === null ? "None" : <code>{v.default}</code>}</td>
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
        <dd>{v.readBy === "agent" ? "agent/src/config.ts" : "the SDK that uses it, not agent/src/config.ts"}</dd>
        <dt className="text-fd-muted-foreground">Required</dt>
        <dd>{v.required ? "Yes, in every mode" : v.requiredInLive ? "In live mode" : "No"}</dd>
        <dt className="text-fd-muted-foreground">Default</dt>
        <dd>{v.default === null ? "None" : <code>{v.default}</code>}</dd>
        <dt className="text-fd-muted-foreground">In .env.example</dt>
        <dd>{v.example ? <code>{v.example}</code> : "Empty: set your own"}</dd>
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
      <Signature>{`npm run ${s.name}`}</Signature>
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

/** Every constant in contracts/script/BaseAddresses.sol; addresses link to Basescan. */
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
      <tbody>
        {docsData.addresses.map((a) => (
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
    </ScrollTable>
  );
}

/** Facts with their value and the source that proves it, for the default parameters page. */
export function FactTable({ names }: { names: readonly FactName[] }) {
  return (
    <ScrollTable label="Defaults">
      <thead>
        <tr>
          <th>Parameter</th>
          <th>Value</th>
          <th>Source</th>
        </tr>
      </thead>
      <tbody>
        {names.map((n) => {
          const f = factFor(n);
          return (
            <tr key={n}>
              <td><code>{n}</code></td>
              <td>{f.text}</td>
              <td>{f.source}</td>
            </tr>
          );
        })}
      </tbody>
    </ScrollTable>
  );
}
