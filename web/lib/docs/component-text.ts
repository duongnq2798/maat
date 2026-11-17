import type { Root } from "fumadocs-core/page-tree";
import { REASON_MEANING_DOCS, REASONS } from "../../content/reasons";
import { SITE } from "../site";
import { forkLedger, GROUP_OF, decisionEventSource, mandateTable } from "./content-data";
import { DATA_COMPONENTS, type DataComponent } from "./data-components";
import type { Deployment } from "./docs-data";
import { codeParts, FACT_TABLE_HEAD, type FactCode, factTable } from "./fact-text";
import {
  type FlowData,
  type ScaleData,
  ARCHITECTURE,
  DECISION_LOOP,
  HEALTH_FACTOR_SCALE,
  MARKET_WEEK_CAPTION,
  MARKET_WEEK_MODES,
  MULTIPLIER_FLOW,
  TIMELOCK_FLOW,
  TREASURY_LOOP,
} from "./flows";
import { STATUS_LABEL, STATUSES, type DocStatus } from "./frontmatter";
import { docsData } from "./generated";
import { headingId } from "./links";
import { READER_PATHS } from "./reader-paths";
import {
  DEPLOYMENT_HEAD,
  deploymentHref,
  DEPLOYMENTS_CAPTION,
  DEPLOYMENTS_FILE,
  ENV_COMMENT,
  hasAddress,
  kindLabels,
  NO_DEFAULT,
  NO_DEPLOYMENT,
  NO_EXAMPLE,
  READ_BY,
  readByDetail,
  requiredDetail,
  requiredLabel,
  SELECTOR,
  SOURCE_COMMENT,
  stateLabel,
  TOPIC0,
} from "./reference-labels";
import { sectionIndex } from "./sections";
import { accessLabel, errorSignature, eventSignature, findContract, findItem, type FunctionGroup, functionGroups, functionSignature } from "./signatures";
import type { SolParam } from "./sol-surface";

// Relative imports only: source.config.ts loads this file through the fumadocs-mdx bundler, outside Next.

// The text of each data component in the Markdown copies of the docs (/md/*.md, llms-full.txt). The HTML pages draw
// the real components from the same data; lib/docs/remark-component-text.ts prints these in their place. Plain
// Markdown, no HTML, so a reader or a model gets the signatures, the tables and the steps, not a raw tag.

/** A list written as an expression: of strings, or of lists, as a grouped <FunctionIndex> writes its groups. */
export type PropList = readonly (string | PropList)[];

/** The literal attributes of a tag: a string, a bare flag, or a list. */
export type Props = Readonly<Record<string, string | boolean | PropList>>;

export interface TextContext {
  /** Whether a docs page has shipped, by slug ("get-started/quickstart"). */
  readonly exists: (slug: string) => boolean;
  /** The docs page tree, as Fumadocs builds the sidebar from content/docs: what a section index lists. */
  readonly tree?: () => Root;
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

const isStrings = (v: unknown): v is readonly string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

function strings(name: string, props: Props, key: string): readonly string[] {
  const v = props[key];
  if (!isStrings(v)) throw new Error(`<${name} /> needs a list of strings for "${key}"`);
  return v;
}

/** The groups of a <FunctionIndex>: each a section name, then the names of its functions. */
function groupList(name: string, props: Props, key: string): readonly FunctionGroup[] | undefined {
  const v = props[key];
  if (v === undefined) return undefined;
  const isGroup = (g: unknown): g is FunctionGroup => Array.isArray(g) && g.length === 2 && typeof g[0] === "string" && isStrings(g[1]);
  if (!Array.isArray(v) || !v.every(isGroup)) throw new Error(`<${name} /> needs a list of ["group", ["function", ...]] for "${key}"`);
  return v;
}

// Reference entries

const hash = (label: string, value: string) => `${label}: ${code(value)}`;
const sourceComment = (notice: string) => notice && `${SOURCE_COMMENT} ${notice}`;

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
    hash(SELECTOR, f.selector),
    sourceComment(f.notice),
  );
};

/**
 * Each function links its entry, as on the page (`name (Contract)` with `qualify`). Grouped, a group's name heads its
 * rows as a one-cell row linking its section, and a row says only what the function does to state.
 */
const functionIndex: Render = (props) => {
  const contract = str("FunctionIndex", props, "contract");
  const qualify = props.qualify === true;
  const groups = groupList("FunctionIndex", props, "groups");
  const entry = (name: string) => link(code(name), `#${headingId(qualify ? `${name} (${contract})` : name)}`);
  if (groups) {
    return mdTable(
      ["Function", "Kind"],
      functionGroups(surface, contract, groups).flatMap((g) => [
        [link(g.name, `#${headingId(g.name)}`)],
        ...g.functions.map((f) => [entry(f.name), stateLabel(f)]),
      ]),
    );
  }
  return mdTable(
    ["Function", "Who may call", "Kind"],
    findContract(surface, contract).functions.map((f) => [entry(f.name), accessLabel(f.access), kindLabels(f).join(", ")]),
  );
};

const eventEntry: Render = (props) => {
  const e = findItem(surface, str("EventEntry", props, "contract"), "events", str("EventEntry", props, "name"));
  return blocks(fence("solidity", eventSignature(e)), hash(TOPIC0, e.topic0), sourceComment(e.notice), paramRows(e.params, true));
};

const errorEntry: Render = (props) => {
  const e = findItem(surface, str("ErrorEntry", props, "contract"), "errors", str("ErrorEntry", props, "name"));
  return blocks(fence("solidity", errorSignature(e)), hash(SELECTOR, e.selector), sourceComment(e.notice), paramRows(e.params, false));
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
  return blocks(sourceComment(st.notice), paramRows(st.fields, false));
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
  return blocks(fields.join("\n"), v.note && `${ENV_COMMENT} ${v.note}`);
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

/**
 * The table of deployments/README.md: while no row has an address, one sentence that says so; once one has, every row,
 * with a Base mainnet address and transaction linked to Basescan, then the file it comes from.
 */
export function deploymentText(rows: readonly Deployment[]): string {
  const file = link(code(DEPLOYMENTS_FILE), `${SITE.repoUrl}/blob/main/${DEPLOYMENTS_FILE}`);
  if (!rows.some(hasAddress)) return `${NO_DEPLOYMENT[0]}${file}${NO_DEPLOYMENT[1]}`;
  const cell = (d: Deployment, key: "address" | "tx") => {
    const href = deploymentHref(d, key);
    return d[key] === "" ? "" : href ? link(code(d[key]), href) : code(d[key]);
  };
  return blocks(
    mdTable(
      DEPLOYMENT_HEAD,
      rows.map((d) => [d.network, code(d.contract), cell(d, "address"), cell(d, "tx"), d.date]),
    ),
    `${DEPLOYMENTS_CAPTION[0]}${file}${DEPLOYMENTS_CAPTION[1]}`,
  );
}

const deploymentTable: Render = () => deploymentText(docsData.deployments);

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

/** Each group's cards as a list of links with their descriptions; a named group under its name, in bold, not a heading. */
const sectionIndexText: Render = (props, ctx) => {
  if (!ctx.tree) throw new Error("<SectionIndex /> needs the docs page tree (TextContext.tree)");
  return sectionIndex(ctx.tree(), optionalStr("SectionIndex", props, "section") ?? "")
    .map((g) => blocks(g.name && `**${g.name}**`, g.cards.map((c) => `- ${link(c.title, c.url)}${c.description ? `: ${c.description}` : ""}`).join("\n")))
    .join("\n\n");
};

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

/** A scale's ranges as a list, highest first, each led by its bounds; the colour of its edge is left out, as its title says it. */
const scale =
  (data: ScaleData): Render =>
  () =>
    blocks(`**${data.label}**`, data.bands.map((b) => `- **${b.range}**: ${b.title}. ${b.detail}`).join("\n"), data.caption);

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
  DeploymentTable: deploymentTable,
  FactTable: factTableText,
  ReasonTable: reasonTable,
  MandateTable: mandateTableText,
  EventSignature: eventSignatureText,
  ForkLedger: forkLedgerText,
  RouterCards: routerCards,
  SectionIndex: sectionIndexText,
  StatusBadge: statusBadge,
  DecisionLoop: flow(DECISION_LOOP),
  Architecture: flow(ARCHITECTURE),
  TimelockFlow: flow(TIMELOCK_FLOW),
  TreasuryLoop: flow(TREASURY_LOOP),
  MultiplierFlow: flow(MULTIPLIER_FLOW),
  HealthFactorScale: scale(HEALTH_FACTOR_SCALE),
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
