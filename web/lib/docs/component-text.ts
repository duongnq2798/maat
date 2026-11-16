import { REASON_MEANING_DOCS, REASONS } from "../../content/reasons";
import { SITE } from "../site";
import { forkLedger, GROUP_OF, decisionEventSource, mandateTable } from "./content-data";
import { DATA_COMPONENTS, type DataComponent } from "./data-components";
import { codeParts, FACT_TABLE_HEAD, type FactCode, factTable } from "./fact-text";
import { type FlowData, ARCHITECTURE, DECISION_LOOP, MARKET_WEEK_CAPTION, MARKET_WEEK_MODES, TIMELOCK_FLOW, TREASURY_LOOP } from "./flows";
import { STATUS_LABEL, STATUSES, type DocStatus } from "./frontmatter";
import { docsData } from "./generated";
import { READER_PATHS } from "./reader-paths";
import { kindLabels, NO_DEFAULT, NO_EXAMPLE, READ_BY, readByDetail, requiredDetail, requiredLabel } from "./reference-labels";
import { accessLabel, errorSignature, eventSignature, findContract, findItem, functionSignature } from "./signatures";
import type { SolParam } from "./sol-surface";

// Relative imports only: source.config.ts loads this file through the fumadocs-mdx bundler, outside Next.

// The text of each data component in the Markdown copies of the docs (/md/*.md, llms-full.txt). The HTML pages draw
// the real components from the same data; lib/docs/remark-component-text.ts prints these in their place. Plain
// Markdown, no HTML, so a reader or a model gets the signatures, the tables and the steps, not a raw tag.

/** The literal attributes of a tag: a string, a bare flag, or a list of strings. */
export type Props = Readonly<Record<string, string | boolean | readonly string[]>>;

export interface TextContext {
  /** Whether a docs page has shipped, by slug ("get-started/quickstart"). */
  readonly exists: (slug: string) => boolean;
}

type Render = (props: Props, ctx: TextContext) => string;

const surface = docsData.surface;

// Markdown pieces

const code = (s: string) => `\`${s}\``;
const fence = (lang: string, source: string) => `\`\`\`${lang}\n${source}\n\`\`\``;
const link = (text: string, href: string) => `[${text}](${href})`;

/** A Markdown table; a `|` in a cell is escaped and a line break joined, so a row never loses its columns. */
export function mdTable(head: readonly string[], rows: readonly (readonly string[])[]): string {
  const cell = (s: string) => s.replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|");
  const row = (cells: readonly string[]) => `| ${cells.map(cell).join(" | ")} |`;
  return [row(head), row(head.map(() => "---")), ...rows.map(row)].join("\n");
}

/** The parts of an entry that exist, as paragraphs. */
const blocks = (...parts: (string | false | undefined)[]) => parts.filter((p): p is string => typeof p === "string" && p !== "").join("\n\n");

// Props

function str(name: string, props: Props, key: string): string {
  const v = props[key];
  if (typeof v !== "string") throw new Error(`<${name} /> needs a plain-string "${key}"`);
  return v;
}

function optionalStr(name: string, props: Props, key: string): string | undefined {
  return props[key] === undefined ? undefined : str(name, props, key);
}

function strings(name: string, props: Props, key: string): readonly string[] {
  const v = props[key];
  if (!Array.isArray(v)) throw new Error(`<${name} /> needs a list of strings for "${key}"`);
  return v;
}

// Reference entries

function paramRows(params: readonly SolParam[], indexed: boolean): string | undefined {
  if (params.length === 0) return undefined;
  const head = indexed ? ["Name", "Type", "Indexed"] : ["Name", "Type"];
  return mdTable(
    head,
    params.map((p) => (indexed ? [code(p.name), code(p.type), p.indexed ? "Yes" : "No"] : [code(p.name), code(p.type)])),
  );
}

const fn: Render = (props) => {
  const f = findItem(surface, str("Fn", props, "contract"), "functions", str("Fn", props, "name"));
  return blocks(
    fence("solidity", functionSignature(f)),
    `Who may call: ${accessLabel(f.access)}. Kind: ${kindLabels(f).join(", ")}.`,
    f.notice,
  );
};

const functionIndex: Render = (props) => {
  const c = findContract(surface, str("FunctionIndex", props, "contract"));
  return mdTable(
    ["Function", "Who may call", "Kind"],
    c.functions.map((f) => [code(f.name), accessLabel(f.access), kindLabels(f).join(", ")]),
  );
};

const eventEntry: Render = (props) => {
  const e = findItem(surface, str("EventEntry", props, "contract"), "events", str("EventEntry", props, "name"));
  return blocks(fence("solidity", eventSignature(e)), e.notice, paramRows(e.params, true));
};

const errorEntry: Render = (props) => {
  const e = findItem(surface, str("ErrorEntry", props, "contract"), "errors", str("ErrorEntry", props, "name"));
  return blocks(fence("solidity", errorSignature(e)), e.notice, paramRows(e.params, false));
};

const typeEntry: Render = (props) => {
  const name = str("TypeEntry", props, "name");
  const en = surface.enums.find((e) => e.name === name);
  if (en) {
    return mdTable(
      ["Id", "Member"],
      en.members.map((m, id) => [String(id), code(m)]),
    );
  }
  const st = surface.structs.find((s) => s.name === name);
  if (!st) throw new Error(`type ${name} is not in content/generated/contracts.json (run npm run docs:gen)`);
  return blocks(st.notice, paramRows(st.fields, false));
};

const envVars = docsData.agent.env;

const envTable: Render = () =>
  mdTable(
    ["Setting", "Read by", "Required", "Default"],
    envVars.map((v) => [code(v.name), READ_BY[v.readBy], requiredLabel(v), v.default === null ? NO_DEFAULT : code(v.default)]),
  );

const envVar: Render = (props) => {
  const name = str("EnvVar", props, "name");
  const v = envVars.find((e) => e.name === name);
  if (!v) throw new Error(`${name} is not in agent/.env.example (content/generated/agent.json)`);
  const fields = [
    `- Read by: ${readByDetail(v)}`,
    `- Required: ${requiredDetail(v)}`,
    `- Default: ${v.default === null ? NO_DEFAULT : code(v.default)}`,
    `- In .env.example: ${v.example ? code(v.example) : NO_EXAMPLE}`,
  ];
  return blocks(fields.join("\n"), v.note);
};

const scriptEntry: Render = (props) => {
  const name = str("ScriptEntry", props, "name");
  const s = docsData.agent.scripts.find((x) => x.name === name);
  if (!s) throw new Error(`npm run ${name} is not in agent/package.json (content/generated/agent.json)`);
  return blocks(fence("bash", `npm run ${s.name}`), `Runs ${code(s.command)} in ${code("agent/")}.`);
};

const scriptFile: Render = (props) => {
  const name = str("ScriptFile", props, "name");
  if (!docsData.agent.scriptFiles.includes(name)) throw new Error(`agent/scripts/${name} does not exist (content/generated/agent.json)`);
  return link(code(`agent/scripts/${name}`), `${SITE.repoUrl}/blob/main/agent/scripts/${name}`);
};

/** A group comment heads its rows once, as a one-cell row; a row's Note is only the constant's own comment. */
const addressTable: Render = () =>
  mdTable(
    ["Name", "Value", "Note"],
    docsData.addresses.flatMap((a, i) => {
      const row = [
        code(a.name),
        a.type === "address" ? link(code(a.value), `https://basescan.org/address/${a.value}`) : code(a.value),
        a.note,
      ];
      return a.group !== "" && a.group !== docsData.addresses[i - 1]?.group ? [[a.group], row] : [row];
    }),
  );

const inCode = (c: FactCode) => codeParts(c).map((p) => (p.code ? code(p.text) : p.text)).join("");

const factTableText: Render = (props) => {
  const { settings, rows } = factTable(strings("FactTable", props, "names"));
  return blocks(
    mdTable(
      settings ? FACT_TABLE_HEAD.settings : FACT_TABLE_HEAD.figures,
      rows.map((r) => (r.code ? [r.label, inCode(r.code), r.text, code(r.code.file)] : [r.label, r.text, r.source])),
    ),
    optionalStr("FactTable", props, "caption"),
  );
};

// Tables of shared data

const reasonTable: Render = () =>
  mdTable(
    ["Code", "Id", "Group", "Meaning"],
    REASONS.map((c, i) => [link(code(c), `/docs/concepts/refusal-codes#${c.toLowerCase()}`), String(i + 1), GROUP_OF.get(c) ?? "", REASON_MEANING_DOCS[c]]),
  );

const mandateTableText: Render = () => {
  const t = mandateTable();
  return blocks(
    mdTable(
      ["Setting", "Field", "Default"],
      t.rows.map((r) => [r.label, code(r.field), r.value]),
    ),
    t.caption,
  );
};

const forkLedgerText: Render = () => {
  const t = forkLedger();
  return blocks(
    mdTable(
      ["Time (ET)", "Intent", "Decision", "Gas", "Note"],
      t.rows.map((r) => [r.time, r.intent, code(r.decision), r.gas, r.note ?? ""]),
    ),
    t.caption,
  );
};

const eventSignatureText: Render = (props) => fence("solidity", decisionEventSource(str("EventSignature", props, "name")));

const routerCards: Render = (_props, ctx) =>
  READER_PATHS.map((p) => {
    const cta = ctx.exists(p.slug) ? link(`${p.cta} →`, `/docs/${p.slug}`) : `${p.cta} (coming soon)`;
    return `- **${p.reader}**: ${p.want} ${cta}`;
  }).join("\n");

const statusBadge: Render = (props) => {
  const status = str("StatusBadge", props, "status");
  if (!(STATUSES as readonly string[]).includes(status)) throw new Error(`<StatusBadge status="${status}" /> is not a status (${STATUSES.join(", ")})`);
  return STATUS_LABEL[status as DocStatus];
};

// Diagrams

const flow =
  (data: FlowData): Render =>
  () =>
    blocks(`**${data.label}**`, data.steps.map((s, i) => `${i + 1}. **${s.title}**: ${s.detail}`).join("\n"), data.caption);

const marketWeek: Render = () =>
  blocks(MARKET_WEEK_MODES.map((m) => `- ${code(m.mode)} is open ${m.text}`).join("\n"), MARKET_WEEK_CAPTION);

/** The renderer of every data component, by tag name. */
export const COMPONENT_TEXT: Readonly<Record<DataComponent, Render>> = {
  Fn: fn,
  FunctionIndex: functionIndex,
  EventEntry: eventEntry,
  ErrorEntry: errorEntry,
  TypeEntry: typeEntry,
  EnvTable: envTable,
  EnvVar: envVar,
  ScriptEntry: scriptEntry,
  ScriptFile: scriptFile,
  AddressTable: addressTable,
  FactTable: factTableText,
  ReasonTable: reasonTable,
  MandateTable: mandateTableText,
  EventSignature: eventSignatureText,
  ForkLedger: forkLedgerText,
  RouterCards: routerCards,
  StatusBadge: statusBadge,
  DecisionLoop: flow(DECISION_LOOP),
  Architecture: flow(ARCHITECTURE),
  TimelockFlow: flow(TIMELOCK_FLOW),
  TreasuryLoop: flow(TREASURY_LOOP),
  MarketWeek: marketWeek,
};

/** Whether a tag name is a data component that has text in the Markdown copies. */
export function isDataComponent(name: string): name is DataComponent {
  return (DATA_COMPONENTS as readonly string[]).includes(name);
}

/** The Markdown for one data component, from the literal props of its tag. Throws on an unknown name, like the component. */
export function componentText(name: DataComponent, props: Props, ctx: TextContext): string {
  return COMPONENT_TEXT[name](props, ctx);
}
